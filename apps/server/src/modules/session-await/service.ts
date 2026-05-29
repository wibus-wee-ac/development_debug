import { randomUUID } from 'node:crypto'

import { awaitBypassRules, sessionAwaits, sessions, workspaces } from '@cradle/db'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { enqueueSessionQueueItem } from '../chat-runtime/service'
import { fetchBranchHead, fetchBranchProtection, fetchCheckRuns, fetchCombinedStatus, fetchRepo, GitHubTargetValidationError } from './sources/github-api'
import { GitHubCIFilterJsonSchema, validateGitHubCITarget } from './sources/github-ci'
import { GitHubReviewFilterJsonSchema, validateGitHubReviewTarget } from './sources/github-review'
import type {
  RegisterAwaitInput,
  SessionAwait,
  SessionAwaitSummary,
  TriggerAwaitInput,
} from './types'

const SessionAwaitFilterJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))

const RegisterAwaitInputSchema = z.object({
  chatSessionId: z.string(),
  workspaceId: z.string(),
  source: z.string(),
  filterJson: z.string(),
  reason: z.string().nullable().default(null),
  expiresAt: z.number().nullable().default(null),
  fireAt: z.number().nullable().default(null),
})

const TriggerAwaitInputSchema = z.object({
  awaitId: z.string(),
  resumeText: z.string(),
  resumePayloadJson: z.string().nullable().default(null),
})

const LastCheckedInputSchema = z.object({
  errorText: z.string().nullable().default(null),
})

// ── write operations ──

async function validateGitHubAwaitSource(source: string, filterJson: string): Promise<void> {
  try {
    if (source === 'github-ci') {
      await validateGitHubCITarget(filterJson)
    }
    else if (source === 'github-review') {
      await validateGitHubReviewTarget(filterJson)
    }
  }
  catch (err) {
    if (err instanceof GitHubTargetValidationError) {
      throw new AppError({
        code: err.category === 'invalid' ? 'github_await_target_invalid' : 'github_await_validation_unavailable',
        status: err.category === 'invalid' ? 400 : 503,
        message: err.message,
      })
    }
    throw new AppError({
      code: 'github_await_validation_unavailable',
      status: 503,
      message: 'Unable to validate GitHub await target right now.',
    })
  }
}

export async function register(rawInput: RegisterAwaitInput): Promise<SessionAwait> {
  const input = RegisterAwaitInputSchema.parse(rawInput)
  if (input.source === 'github-ci') {
    GitHubCIFilterJsonSchema.parse(input.filterJson)
  }
  else if (input.source === 'github-review') {
    GitHubReviewFilterJsonSchema.parse(input.filterJson)
  }
  else {
    SessionAwaitFilterJsonSchema.parse(input.filterJson)
  }

  // Validate referenced session exists
  const sessionExists = db().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, input.chatSessionId)).get()
  if (!sessionExists) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Chat session not found' })
  }

  // Validate referenced workspace exists
  const workspaceExists = db().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).get()
  if (!workspaceExists) {
    throw new AppError({ code: 'workspace_not_found', status: 404, message: 'Workspace not found' })
  }

  await validateGitHubAwaitSource(input.source, input.filterJson)

  const id = randomUUID()
  return db()
    .insert(sessionAwaits)
    .values({
      id,
      chatSessionId: input.chatSessionId,
      workspaceId: input.workspaceId,
      source: input.source,
      filterJson: input.filterJson,
      reason: input.reason,
      expiresAt: input.expiresAt,
      fireAt: input.fireAt,
    })
    .returning()
    .get()
}

export function cancel(awaitId: string): SessionAwait | null {
  return db()
    .update(sessionAwaits)
    .set({ status: 'cancelled' })
    .where(and(
      eq(sessionAwaits.id, awaitId),
      eq(sessionAwaits.status, 'pending'),
    ))
    .returning()
    .get() ?? null
}

export function expire(awaitId: string): SessionAwait | null {
  return db()
    .update(sessionAwaits)
    .set({ status: 'expired' })
    .where(and(
      eq(sessionAwaits.id, awaitId),
      eq(sessionAwaits.status, 'pending'),
    ))
    .returning()
    .get() ?? null
}

export async function trigger(rawInput: TriggerAwaitInput): Promise<SessionAwait | null> {
  const input = TriggerAwaitInputSchema.parse(rawInput)
  const row = db()
    .select()
    .from(sessionAwaits)
    .where(eq(sessionAwaits.id, input.awaitId))
    .get()

  if (!row) {
    return null
  }
  if (row.status === 'triggered') {
    return row
  } // idempotent

  if (row.status !== 'pending') {
    return null
  }

  const now = Math.floor(Date.now() / 1000)

  // Mark as triggered before dispatching resume to guarantee idempotency
  const updated = db()
    .update(sessionAwaits)
    .set({
      status: 'triggered',
      triggeredAt: now,
      resumePayloadJson: input.resumePayloadJson,
    })
    .where(and(
      eq(sessionAwaits.id, input.awaitId),
      eq(sessionAwaits.status, 'pending'),
    ))
    .returning()
    .get()

  if (!updated) {
    return row
  } // another trigger won the race

  // Resume through Chat Runtime's durable continuation queue. This preserves the
  // await result when the target session is currently running.
  try {
    await enqueueSessionQueueItem({
      sessionId: row.chatSessionId,
      mode: 'queue',
      text: input.resumeText,
    })
  }
  catch (err) {
    const errorText = err instanceof Error ? err.message : String(err)
    db()
      .update(sessionAwaits)
      .set({
        status: 'failed',
        triggeredAt: null,
        lastErrorText: errorText,
        lastCheckedAt: now,
      })
      .where(eq(sessionAwaits.id, input.awaitId))
      .run()

    return db().select().from(sessionAwaits).where(eq(sessionAwaits.id, input.awaitId)).get() ?? null
  }

  return updated
}

export function markFailed(awaitId: string, errorText: string): void {
  const now = Math.floor(Date.now() / 1000)
  db()
    .update(sessionAwaits)
    .set({ status: 'failed', lastErrorText: errorText, lastCheckedAt: now })
    .where(and(
      eq(sessionAwaits.id, awaitId),
      eq(sessionAwaits.status, 'pending'),
    ))
    .run()
}

export function updateLastChecked(awaitId: string, errorText?: string): void {
  const input = LastCheckedInputSchema.parse({ errorText })
  const now = Math.floor(Date.now() / 1000)
  db()
    .update(sessionAwaits)
    .set({
      lastCheckedAt: now,
      lastErrorText: input.errorText,
    })
    .where(eq(sessionAwaits.id, awaitId))
    .run()
}

export function bypassCheck(awaitId: string, checkName: string): SessionAwait | null {
  const row = db().select().from(sessionAwaits).where(eq(sessionAwaits.id, awaitId)).get()
  if (!row || row.status !== 'pending') {
    return null
  }

  const existing: string[] = row.bypassedChecksJson ? JSON.parse(row.bypassedChecksJson) : []
  if (existing.includes(checkName)) {
    return row
  }
  existing.push(checkName)

  return db()
    .update(sessionAwaits)
    .set({ bypassedChecksJson: JSON.stringify(existing) })
    .where(eq(sessionAwaits.id, awaitId))
    .returning()
    .get()
}

export function getBypassedChecks(awaitId: string): string[] {
  const row = db().select({ bypassedChecksJson: sessionAwaits.bypassedChecksJson }).from(sessionAwaits).where(eq(sessionAwaits.id, awaitId)).get()
  if (!row?.bypassedChecksJson) {
    return []
  }
  return JSON.parse(row.bypassedChecksJson) as string[]
}

// ── read operations ──

export function get(awaitId: string): SessionAwait | null {
  return db()
    .select()
    .from(sessionAwaits)
    .where(eq(sessionAwaits.id, awaitId))
    .get() ?? null
}

export function listBySession(sessionId: string): SessionAwait[] {
  return db()
    .select()
    .from(sessionAwaits)
    .where(eq(sessionAwaits.chatSessionId, sessionId))
    .all()
}

export function listPendingBySource(source: string): SessionAwait[] {
  return db()
    .select()
    .from(sessionAwaits)
    .where(and(
      eq(sessionAwaits.source, source),
      eq(sessionAwaits.status, 'pending'),
    ))
    .all()
}

export function listAllPending(): SessionAwait[] {
  return db()
    .select()
    .from(sessionAwaits)
    .where(eq(sessionAwaits.status, 'pending'))
    .all()
}

export function getSessionSummary(sessionId: string): SessionAwaitSummary {
  const pending = db()
    .select()
    .from(sessionAwaits)
    .where(and(
      eq(sessionAwaits.chatSessionId, sessionId),
      eq(sessionAwaits.status, 'pending'),
    ))
    .all()

  if (pending.length === 0) {
    return { awaiting: false, pendingCount: 0, primarySource: null, reason: null }
  }

  const first = pending[0]
  return {
    awaiting: true,
    pendingCount: pending.length,
    primarySource: first.source,
    reason: first.reason,
  }
}

// ── bypass rules ──

export type BypassRule = typeof awaitBypassRules.$inferSelect

export function listBypassRules(workspaceId: string): BypassRule[] {
  return db()
    .select()
    .from(awaitBypassRules)
    .where(eq(awaitBypassRules.workspaceId, workspaceId))
    .all()
}

export function createBypassRule(workspaceId: string, repo: string, checkPattern: string): BypassRule {
  const id = randomUUID()
  return db()
    .insert(awaitBypassRules)
    .values({ id, workspaceId, repo, checkPattern })
    .returning()
    .get()
}

export function deleteBypassRule(ruleId: string): boolean {
  const result = db()
    .delete(awaitBypassRules)
    .where(eq(awaitBypassRules.id, ruleId))
    .run()
  return result.changes > 0
}

export function toggleBypassRule(ruleId: string, enabled: boolean): BypassRule | null {
  return db()
    .update(awaitBypassRules)
    .set({ enabled: enabled ? 1 : 0 })
    .where(eq(awaitBypassRules.id, ruleId))
    .returning()
    .get() ?? null
}

export function getMatchingBypassPatterns(workspaceId: string, repo: string): string[] {
  const rules = db()
    .select({ checkPattern: awaitBypassRules.checkPattern })
    .from(awaitBypassRules)
    .where(and(
      eq(awaitBypassRules.workspaceId, workspaceId),
      eq(awaitBypassRules.repo, repo),
      eq(awaitBypassRules.enabled, 1),
    ))
    .all()
  return rules.map(r => r.checkPattern)
}

export function globMatch(name: string, pattern: string): boolean {
  // Convert glob pattern to regex: * -> .*, ? -> ., escape the rest
  const regexStr = `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`
  return new RegExp(regexStr).test(name)
}

export function matchesAnyBypassPattern(name: string, patterns: Iterable<string>): boolean {
  for (const pattern of patterns) {
    if (globMatch(name, pattern)) {
      return true
    }
  }
  return false
}

// ── discovered repos & available checks ──

export function listDiscoveredRepos(workspaceId: string): string[] {
  const rows = db()
    .select({ filterJson: sessionAwaits.filterJson })
    .from(sessionAwaits)
    .where(and(
      eq(sessionAwaits.workspaceId, workspaceId),
    ))
    .all()

  const repos = new Set<string>()
  for (const row of rows) {
    if (row.filterJson) {
      try {
        const parsed = JSON.parse(row.filterJson)
        if (typeof parsed.repo === 'string') {
          repos.add(parsed.repo)
        }
      }
      catch { /* ignore malformed filterJson */ }
    }
  }
  return [...repos].sort()
}

export interface AvailableCheck {
  name: string
  required: boolean
  source: 'check-run' | 'status'
}

export interface AvailableChecksResult {
  owner: string
  repo: string
  defaultBranch: string
  checks: AvailableCheck[]
}

export async function fetchAvailableChecks(owner: string, repo: string): Promise<AvailableChecksResult> {
  const repoInfo = await fetchRepo(owner, repo)
  if (!repoInfo) {
    throw new AppError({ code: 'github_repo_not_found', status: 404, message: `Repository ${owner}/${repo} not found` })
  }

  const defaultBranch = repoInfo.default_branch
  const headInfo = await fetchBranchHead(owner, repo, defaultBranch)
  if (!headInfo) {
    return { owner, repo, defaultBranch, checks: [] }
  }

  const [checkRunsResp, combinedStatus, branchProtection] = await Promise.all([
    fetchCheckRuns(owner, repo, headInfo.sha),
    fetchCombinedStatus(owner, repo, headInfo.sha),
    fetchBranchProtection(owner, repo, defaultBranch),
  ])

  const requiredContexts = new Set(branchProtection?.requiredContexts ?? [])
  const seen = new Map<string, AvailableCheck>()

  for (const run of checkRunsResp?.check_runs ?? []) {
    if (!seen.has(run.name)) {
      seen.set(run.name, {
        name: run.name,
        required: requiredContexts.has(run.name),
        source: 'check-run',
      })
    }
    else if (requiredContexts.has(run.name)) {
      seen.get(run.name)!.required = true
    }
  }

  for (const status of combinedStatus?.statuses ?? []) {
    if (!seen.has(status.context)) {
      seen.set(status.context, {
        name: status.context,
        required: requiredContexts.has(status.context),
        source: 'status',
      })
    }
    else if (requiredContexts.has(status.context)) {
      seen.get(status.context)!.required = true
    }
  }

  const checks = [...seen.values()].sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return { owner, repo, defaultBranch, checks }
}
