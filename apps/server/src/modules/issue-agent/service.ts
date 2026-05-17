import { randomUUID } from 'node:crypto'

import type { AgentActivity, AgentSession } from '@cradle/db'
import {
  agentActivities,
  agentProfiles,
  agentSessions,
} from '@cradle/db'
import { desc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { parseJsonStringArray } from '../../helpers/json-text'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import * as ChatRuntime from '../chat-runtime/service'
import * as Kanban from '../kanban/service'
import * as Session from '../session/service'
import * as WorkflowRules from '../workflow-rules/service'

// ── types ──

interface ActiveAgentRun {
  runId: string
  chatSessionId: string
  aborted: boolean
}

interface IssueAgentSessionView extends AgentSession {
  isCurrentDelegation: boolean
}

interface IssueAgentDelegationState {
  issueId: string
  delegated: boolean
  agentProfileId: string | null
  agentSessionId: string | null
  chatSessionId: string | null
}

// ── in-memory state ──

const activeRuns = new Map<string, ActiveAgentRun>()

// ── helpers ──

function parseContextRefs(raw: string): Array<{ type: string, value: string, label?: string }> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((v): v is { type: string, value: string, label?: string } => {
          return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string' && typeof (v as { value?: unknown }).value === 'string'
        })
      : []
  }
  catch {
    return []
  }
}

// ── DB queries (merged from store) ──

function getAgentProfile(agentProfileId: string) {
  return db()
    .select({ id: agentProfiles.id, name: agentProfiles.name, enabled: agentProfiles.enabled })
    .from(agentProfiles)
    .where(eq(agentProfiles.id, agentProfileId))
    .get()
}

function getAgentSession(agentSessionId: string): AgentSession | undefined {
  return db().select().from(agentSessions).where(eq(agentSessions.id, agentSessionId)).get()
}

function listAgentSessions(issueId: string): AgentSession[] {
  return db().select().from(agentSessions).where(eq(agentSessions.issueId, issueId)).orderBy(desc(agentSessions.createdAt)).all()
}

function listAgentActivities(agentSessionId: string): AgentActivity[] {
  return db().select().from(agentActivities).where(eq(agentActivities.agentSessionId, agentSessionId)).orderBy(agentActivities.createdAt).all()
}

function createDelegationSession(input: { issueId: string, agentProfileId: string }): AgentSession {
  const now = currentUnixSeconds()
  return db().insert(agentSessions).values({
    id: randomUUID(),
    issueId: input.issueId,
    agentProfileId: input.agentProfileId,
    chatSessionId: null,
    status: 'created',
    createdAt: now,
    updatedAt: now,
  }).returning().get()
}

function attachChatSession(input: { agentSessionId: string, chatSessionId: string }): AgentSession | undefined {
  db().update(agentSessions).set({
    chatSessionId: input.chatSessionId,
    updatedAt: currentUnixSeconds(),
  }).where(eq(agentSessions.id, input.agentSessionId)).run()
  return getAgentSession(input.agentSessionId)
}

function updateAgentSessionStatus(agentSessionId: string, status: AgentSession['status']): AgentSession | undefined {
  db().update(agentSessions).set({ status, updatedAt: currentUnixSeconds() }).where(eq(agentSessions.id, agentSessionId)).run()
  return getAgentSession(agentSessionId)
}

function createActivity(input: {
  agentSessionId: string
  type: AgentActivity['type']
  body: string
  signal?: string | null
  signalMetadata?: Record<string, unknown> | null
}): AgentActivity {
  return db().insert(agentActivities).values({
    id: randomUUID(),
    agentSessionId: input.agentSessionId,
    type: input.type,
    content: JSON.stringify({ body: input.body }),
    signal: input.signal ?? null,
    signalMetadata: input.signalMetadata ? JSON.stringify(input.signalMetadata) : null,
    createdAt: currentUnixSeconds(),
  }).returning().get()
}

// ── require helpers ──

function requireIssue(issueId: string) {
  try {
    return Kanban.getIssue(issueId)
  }
  catch {
    throw new AppError({
      code: 'issue_agent_issue_not_found',
      status: 404,
      message: 'Issue not found',
      details: { issueId },
    })
  }
}

function requireAgentProfile(agentProfileId: string) {
  const profile = getAgentProfile(agentProfileId)
  if (!profile) {
    throw new AppError({
      code: 'issue_agent_profile_not_found',
      status: 404,
      message: 'Agent profile not found',
      details: { agentProfileId },
    })
  }
  return profile
}

function requireAgentSession(agentSessionId: string) {
  const session = getAgentSession(agentSessionId)
  if (!session) {
    throw new AppError({
      code: 'issue_agent_session_not_found',
      status: 404,
      message: 'Issue agent session not found',
      details: { agentSessionId },
    })
  }
  return session
}

// ── prompt builder ──

function buildIssuePrompt(
  issue: { id: string, title: string, description: string | null, priority: string, labels: string, contextRefs: string },
  rules: { global: string | null, profileSpecific: string | null },
): string {
  const parts = [`# Issue: ${issue.title}`, '', `Issue ID: ${issue.id}`, '']

  if (issue.description) {
    parts.push(issue.description, '')
  }

  parts.push(`Priority: ${issue.priority}`)

  const labels = parseJsonStringArray(issue.labels)
  if (labels.length > 0) {
    parts.push(`Labels: ${labels.join(', ')}`)
  }

  const refs = parseContextRefs(issue.contextRefs)
  if (refs.length > 0) {
    parts.push('', '## Context')
    refs.forEach((ref) => {
      parts.push(`- [${ref.type}] ${ref.label ?? ref.value}`)
    })
  }

  if (rules.global || rules.profileSpecific) {
    parts.push('', '## Workflow Rules')
    if (rules.global) {
      parts.push(rules.global)
    }
    if (rules.profileSpecific) {
      parts.push(rules.profileSpecific)
    }
  }

  parts.push('', 'Please work on this issue. When done, summarize what you changed.')
  return parts.join('\n')
}

// ── background run watcher ──

async function watchRunCompletion(agentSessionId: string, runId: string): Promise<void> {
  try {
    const run = await ChatRuntime.waitForRunCompletion(runId)
    const tracked = activeRuns.get(agentSessionId)
    activeRuns.delete(agentSessionId)

    if (run.status === 'complete') {
      updateAgentSessionStatus(agentSessionId, 'completed')
      createActivity({
        agentSessionId,
        type: 'response',
        body: 'Completed work on issue',
        signal: 'run.completed',
      })
      return
    }

    if (run.status === 'failed') {
      updateAgentSessionStatus(agentSessionId, 'failed')
      createActivity({
        agentSessionId,
        type: 'error',
        body: run.errorText ?? 'Issue agent run failed',
        signal: 'run.failed',
      })
      return
    }

    updateAgentSessionStatus(agentSessionId, 'stopped')
    if (!tracked?.aborted) {
      createActivity({
        agentSessionId,
        type: 'response',
        body: 'Stopped by user',
        signal: 'run.aborted',
      })
    }
    return
  }
  catch (error) {
    activeRuns.delete(agentSessionId)
    updateAgentSessionStatus(agentSessionId, 'failed')
    createActivity({
      agentSessionId,
      type: 'error',
      body: error instanceof Error ? error.message : 'Issue agent run disappeared before completion',
      signal: 'run.failed',
    })
  }
}

// ── run session ──

async function runSession(agentSessionId: string, agentId?: string): Promise<void> {
  const session = requireAgentSession(agentSessionId)
  const issue = requireIssue(session.issueId)
  const workflowRules = await WorkflowRules.get(issue.workspaceId, session.agentProfileId)
  const chatSession = Session.create({
    workspaceId: issue.workspaceId,
    title: `Issue: ${issue.title}`,
    agentProfileId: session.agentProfileId,
    agentId: agentId ?? null,
    linkedIssueId: issue.id,
    configJson: JSON.stringify({ permissionMode: 'bypassPermissions' }),
  })

  attachChatSession({ agentSessionId, chatSessionId: chatSession.id })
  updateAgentSessionStatus(agentSessionId, 'active')
  createActivity({
    agentSessionId,
    type: 'thought',
    body: 'Examining issue...',
    signal: 'run.started',
  })

  try {
    const run = await ChatRuntime.createRun({
      sessionId: chatSession.id,
      text: buildIssuePrompt(issue, workflowRules),
    })

    activeRuns.set(agentSessionId, {
      runId: run.runId,
      chatSessionId: chatSession.id,
      aborted: false,
    })

    void watchRunCompletion(agentSessionId, run.runId)
  }
  catch (error) {
    updateAgentSessionStatus(agentSessionId, 'failed')
    createActivity({
      agentSessionId,
      type: 'error',
      body: error instanceof Error ? error.message : String(error),
      signal: 'run.failed',
    })
  }
}

// ── public API ──

export function getDelegation(issueId: string): IssueAgentDelegationState {
  requireIssue(issueId)
  const latestSession = listAgentSessions(issueId)[0]
  if (!latestSession) {
    return { issueId, delegated: false, agentProfileId: null, agentSessionId: null, chatSessionId: null }
  }

  const latestActivity = listAgentActivities(latestSession.id).at(-1)
  if (latestActivity?.signal === 'delegation.removed') {
    return { issueId, delegated: false, agentProfileId: null, agentSessionId: null, chatSessionId: null }
  }

  return {
    issueId,
    delegated: true,
    agentProfileId: latestSession.agentProfileId,
    agentSessionId: latestSession.id,
    chatSessionId: latestSession.chatSessionId,
  }
}

export function listSessions(issueId: string): IssueAgentSessionView[] {
  requireIssue(issueId)
  const current = getDelegation(issueId)
  return listAgentSessions(issueId).map(session => ({
    ...session,
    isCurrentDelegation: current.delegated && current.agentSessionId === session.id,
  }))
}

export function listActivities(agentSessionId: string): AgentActivity[] {
  requireAgentSession(agentSessionId)
  return listAgentActivities(agentSessionId)
}

export async function delegateIssue(input: { issueId: string, agentProfileId: string, agentId?: string }): Promise<IssueAgentSessionView> {
  requireIssue(input.issueId)
  const profile = requireAgentProfile(input.agentProfileId)
  if (!profile.enabled) {
    throw new AppError({
      code: 'issue_agent_profile_not_available',
      status: 409,
      message: 'Agent profile is disabled',
      details: { agentProfileId: input.agentProfileId },
    })
  }

  Kanban.updateIssueDelegation(input.issueId, input.agentProfileId)

  // Add system comment to activity timeline
  Kanban.addComment({ issueId: input.issueId, content: `Delegated to ${profile.name}`, authorKind: 'system.delegated' })

  const session = createDelegationSession({
    issueId: input.issueId,
    agentProfileId: input.agentProfileId,
  })

  createActivity({
    agentSessionId: session.id,
    type: 'response',
    body: `Delegated to ${profile.name}`,
    signal: 'delegation.created',
    signalMetadata: { agentProfileId: input.agentProfileId, agentId: input.agentId ?? null },
  })

  void runSession(session.id, input.agentId)

  return { ...session, isCurrentDelegation: true }
}

export async function rerunSession(input: { agentSessionId: string, agentId?: string }): Promise<IssueAgentSessionView> {
  const session = requireAgentSession(input.agentSessionId)
  if (activeRuns.has(session.id)) {
    throw new AppError({
      code: 'issue_agent_session_in_progress',
      status: 409,
      message: 'Issue agent session already has an active run',
      details: { agentSessionId: session.id },
    })
  }

  const refreshed = updateAgentSessionStatus(session.id, 'created') ?? session
  void runSession(session.id, input.agentId)

  const delegation = getDelegation(session.issueId)
  return { ...refreshed, isCurrentDelegation: delegation.agentSessionId === session.id }
}

export async function undelegateIssue(issueId: string): Promise<void> {
  requireIssue(issueId)
  const state = getDelegation(issueId)
  if (!state.delegated || !state.agentSessionId) {
    return
  }

  const run = activeRuns.get(state.agentSessionId)
  if (run) {
    run.aborted = true
    await ChatRuntime.abortRun(run.runId)
    updateAgentSessionStatus(state.agentSessionId, 'stopped')
  }

  Kanban.updateIssueDelegation(issueId, null)

  // Add system comment to activity timeline
  Kanban.addComment({ issueId, content: 'Delegation removed', authorKind: 'system.undelegated' })

  createActivity({
    agentSessionId: state.agentSessionId,
    type: 'response',
    body: 'Delegation removed',
    signal: 'delegation.removed',
  })
}

export async function stopSession(agentSessionId: string): Promise<void> {
  requireAgentSession(agentSessionId)
  const run = activeRuns.get(agentSessionId)
  if (run) {
    run.aborted = true
    await ChatRuntime.abortRun(run.runId)
  }
  updateAgentSessionStatus(agentSessionId, 'stopped')
  createActivity({
    agentSessionId,
    type: 'response',
    body: 'Session stopped by user',
    signal: 'run.aborted',
  })
}
