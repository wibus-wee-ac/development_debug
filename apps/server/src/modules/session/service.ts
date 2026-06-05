import { randomUUID } from 'node:crypto'

import type { Message, Session } from '@cradle/db'
import { agents, backendRuns, backendSessionBindings, messages, sessions } from '@cradle/db'
import { and, desc, eq, inArray, isNotNull, isNull, max, sql } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import {
  AgentRuntimeConfigJsonSchema,
  buildSessionRuntimeConfigJson,
} from '../../helpers/agent-runtime-config'
import { db } from '../../infra'
import type { RuntimeKind } from '../provider-contracts/types'
import { assertProviderTargetCompatibleWithRuntime, resolveProviderTarget } from '../provider-targets/service'
import * as Workspace from '../workspace/service'

export type SessionStatus = 'idle' | 'streaming' | 'error'
export type SessionView = Session & {
  modelId: string | null
  status: SessionStatus
  latestUserMessageAt: number | null
}

const SessionCreateInputSchema = z.object({
  id: z.string().default(() => randomUUID()),
  workspaceId: z.string().nullable().optional(),
  title: z.string(),
  parentSessionId: z.string().nullable().optional(),
  sideContextSource: z.enum(['provider-native', 'cradle-context']).nullable().optional(),
  providerTargetId: z.string().nullable().optional(),
  runtimeKind: z.string().trim().min(1).optional(),
  agentId: z.string().nullable().optional(),
  linkedIssueId: z.string().nullable().default(null),
  configJson: z.string().optional(),
})

function listRequestedModelsBySessionIds(sessionIds: string[]): Map<string, string | null> {
  if (sessionIds.length === 0) {
    return new Map()
  }

  const bindings = db()
    .select({
      chatSessionId: backendSessionBindings.chatSessionId,
      requestedModelId: backendSessionBindings.requestedModelId,
    })
    .from(backendSessionBindings)
    .where(inArray(backendSessionBindings.chatSessionId, sessionIds))
    .all()

  return new Map(
    bindings.map(binding => [binding.chatSessionId, binding.requestedModelId ?? null]),
  )
}

function listStatusesBySessionIds(sessionIds: string[]): Map<string, SessionStatus> {
  if (sessionIds.length === 0) {
    return new Map()
  }

  const runRows = db()
    .select({
      chatSessionId: backendRuns.chatSessionId,
      status: backendRuns.status,
      startedAt: backendRuns.startedAt,
    })
    .from(backendRuns)
    .where(inArray(backendRuns.chatSessionId, sessionIds))
    .orderBy(desc(backendRuns.startedAt))
    .all()

  const statusesBySessionId = new Map<string, SessionStatus>()
  const latestStatusBySessionId = new Map<string, typeof runRows[number]['status']>()

  for (const row of runRows) {
    if (row.status === 'streaming') {
      statusesBySessionId.set(row.chatSessionId, 'streaming')
      continue
    }
    if (!latestStatusBySessionId.has(row.chatSessionId)) {
      latestStatusBySessionId.set(row.chatSessionId, row.status)
    }
  }

  for (const [sessionId, latestStatus] of latestStatusBySessionId) {
    if (!statusesBySessionId.has(sessionId) && latestStatus === 'failed') {
      statusesBySessionId.set(sessionId, 'error')
    }
  }

  return statusesBySessionId
}

function readSessionStatus(sessionId: string): SessionStatus {
  const runRows = db()
    .select({ status: backendRuns.status })
    .from(backendRuns)
    .where(eq(backendRuns.chatSessionId, sessionId))
    .orderBy(desc(backendRuns.startedAt))
    .all()

  if (runRows.some(row => row.status === 'streaming')) {
    return 'streaming'
  }

  return runRows[0]?.status === 'failed' ? 'error' : 'idle'
}

function toSessionView(
  session: Session,
  modelId: string | null,
  status: SessionStatus,
  latestUserMessageAt: number | null = null,
): SessionView {
  return {
    ...session,
    modelId,
    status,
    latestUserMessageAt,
  }
}

function listRowsByLatestUserMessage(where: ReturnType<typeof and> | undefined): Array<{
  session: Session
  latestUserMessageAt: number | null
}> {
  const latestUserMessages = db()
    .select({
      sessionId: messages.sessionId,
      latestUserMessageAt: max(messages.createdAt).as('latest_user_message_at'),
    })
    .from(messages)
    .where(eq(messages.role, 'user'))
    .groupBy(messages.sessionId)
    .as('latest_user_messages')

  const query = db()
    .select({
      session: sessions,
      latestUserMessageAt: latestUserMessages.latestUserMessageAt,
    })
    .from(sessions)
    .leftJoin(latestUserMessages, eq(sessions.id, latestUserMessages.sessionId))
    .orderBy(
      desc(sql<number>`coalesce(${latestUserMessages.latestUserMessageAt}, ${sessions.createdAt})`),
      desc(sessions.createdAt),
    )

  return (where ? query.where(where).all() : query.all()).map(row => ({
    session: row.session,
    latestUserMessageAt: row.latestUserMessageAt ?? null,
  }))
}

function readLatestUserMessageAt(sessionId: string): number | null {
  const row = db()
    .select({
      latestUserMessageAt: max(messages.createdAt),
    })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
    .get()
  return row?.latestUserMessageAt ?? null
}

function assertTargetCompatibleWithRuntime(input: {
  providerTargetId: string
  runtimeKind: RuntimeKind
}): void {
  try {
    assertProviderTargetCompatibleWithRuntime(input.providerTargetId, input.runtimeKind)
  }
 catch (error) {
    if (error instanceof AppError && error.code === 'invalid_provider_target') {
      throw new AppError({
        code: 'invalid_session_input',
        status: 400,
        message: 'Session provider target is not compatible with the selected runtime',
        details: error.details,
      })
    }
    throw error
  }
}

export function list(input: { workspaceId?: string, archived?: boolean } = {}): SessionView[] {
  const predicates = [
    input.workspaceId ? eq(sessions.workspaceId, input.workspaceId) : undefined,
    input.archived ? isNotNull(sessions.archivedAt) : isNull(sessions.archivedAt),
  ].filter(predicate => predicate !== undefined)
  const where = predicates.length > 0 ? and(...predicates) : undefined
  const rows = listRowsByLatestUserMessage(where)

  const sessionIds = rows.map(row => row.session.id)
  const modelsBySessionId = listRequestedModelsBySessionIds(sessionIds)
  const statusesBySessionId = listStatusesBySessionIds(sessionIds)
  return rows.map(row => toSessionView(
    row.session,
    modelsBySessionId.get(row.session.id) ?? null,
    statusesBySessionId.get(row.session.id) ?? 'idle',
    row.latestUserMessageAt,
  ))
}

export function setArchived(input: { id: string, archived: boolean }): SessionView | null {
  const record = db().select().from(sessions).where(eq(sessions.id, input.id)).get()
  if (!record) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  db()
    .update(sessions)
    .set({
      archivedAt: input.archived ? now : null,
      updatedAt: now,
    })
    .where(eq(sessions.id, input.id))
    .run()
  if (input.archived) {
    notifySessionArchived(input.id)
  }
  return get(input.id)
}

export function get(id: string): SessionView | null {
  const row = db().select().from(sessions).where(eq(sessions.id, id)).get() ?? null
  if (!row) {
    return null
  }

  const binding
    = db()
      .select({
        requestedModelId: backendSessionBindings.requestedModelId,
      })
      .from(backendSessionBindings)
      .where(eq(backendSessionBindings.chatSessionId, id))
      .get() ?? null

  return toSessionView(row, binding?.requestedModelId ?? null, readSessionStatus(id), readLatestUserMessageAt(id))
}

export function create(input: {
  id?: string
  workspaceId?: string | null
  title: string
  parentSessionId?: string | null
  sideContextSource?: 'provider-native' | 'cradle-context' | null
  providerTargetId?: string | null
  runtimeKind?: RuntimeKind
  agentId?: string | null
  linkedIssueId?: string | null
  configJson?: string
}): SessionView {
  const parsed = SessionCreateInputSchema.parse(input)
  const resolved = resolveSessionCreateInput(parsed)
  const workspaceId = resolveSessionWorkspaceId(parsed)
  const rowInput = z
    .object({
      configJson: z.string().default(() => resolved.configJson),
    })
    .parse(parsed)
  const created = db()
    .insert(sessions)
    .values({
      id: parsed.id,
      parentSessionId: parsed.parentSessionId ?? null,
      sideContextSource: parsed.sideContextSource ?? null,
      workspaceId,
      title: parsed.title,
      providerTargetId: resolved.providerTargetId,
      runtimeKind: resolved.runtimeKind,
      agentId: resolved.agentId,
      configJson: rowInput.configJson,
      linkedIssueId: parsed.linkedIssueId,
    })
    .returning()
    .get()

  return toSessionView(created, null, 'idle')
}

function resolveSessionWorkspaceId(input: { workspaceId?: string | null }): string | null {
  if (input.workspaceId !== undefined) {
    return input.workspaceId
  }
  return Workspace.createAdHocWorkspace().id
}

function resolveSessionCreateInput(input: {
  providerTargetId?: string | null
  runtimeKind?: RuntimeKind
  agentId?: string | null
}): {
  providerTargetId: string | null
  runtimeKind: RuntimeKind
  agentId: string | null
  configJson: string
} {
  if (input.agentId) {
    const agent = db().select().from(agents).where(eq(agents.id, input.agentId)).get()
    if (!agent) {
      throw new AppError({
        code: 'agent_not_found',
        status: 404,
        message: 'Agent not found',
        details: { agentId: input.agentId },
      })
    }

    if (input.runtimeKind && input.runtimeKind !== agent.runtimeKind) {
      throw new AppError({
        code: 'invalid_session_input',
        status: 400,
        message: 'Session runtime must match the selected agent runtime',
        details: {
          agentId: input.agentId,
          runtimeKind: input.runtimeKind,
          agentRuntimeKind: agent.runtimeKind,
        },
      })
    }

    if (!agent.enabled) {
      throw new AppError({
        code: 'invalid_session_input',
        status: 409,
        message: 'Agent is disabled',
        details: { agentId: input.agentId },
      })
    }

    if (agent.runtimeKind === 'cli-tui') {
      const launch = AgentRuntimeConfigJsonSchema.parse(agent.configJson).cliTui
      if (!launch) {
        throw new AppError({
          code: 'invalid_session_input',
          status: 400,
          message: 'CLI TUI session requires launch configuration on the selected agent',
          details: { agentId: input.agentId },
        })
      }
      return {
        providerTargetId: null,
        runtimeKind: agent.runtimeKind,
        agentId: agent.id,
        configJson: buildSessionRuntimeConfigJson({ cliTuiLaunch: launch }),
      }
    }

    if (!agent.providerTargetId) {
      throw new AppError({
        code: 'invalid_session_input',
        status: 400,
        message: 'Provider-backed agent requires a provider target',
        details: { agentId: input.agentId },
      })
    }

    assertTargetCompatibleWithRuntime({
      providerTargetId: agent.providerTargetId,
      runtimeKind: agent.runtimeKind,
    })
    const providerTarget = resolveProviderTarget(agent.providerTargetId)
    if (!providerTarget.enabled) {
      throw new AppError({
        code: 'invalid_session_input',
        status: 409,
        message: 'Provider target is disabled',
        details: { agentId: input.agentId, providerTargetId: agent.providerTargetId },
      })
    }

    return {
      providerTargetId: agent.providerTargetId,
      runtimeKind: agent.runtimeKind,
      agentId: agent.id,
      configJson: '{}',
    }
  }

  const runtimeKind = input.runtimeKind ?? 'standard'
  if (runtimeKind === 'cli-tui') {
    throw new AppError({
      code: 'invalid_session_input',
      status: 400,
      message: 'CLI TUI sessions must be created from an agent',
    })
  }

  if (!input.providerTargetId) {
    throw new AppError({
      code: 'invalid_session_input',
      status: 400,
      message: 'Session requires a provider target or an agent',
    })
  }

  resolveProviderTarget(input.providerTargetId)
  assertTargetCompatibleWithRuntime({
    providerTargetId: input.providerTargetId,
    runtimeKind,
  })

  return {
    providerTargetId: input.providerTargetId,
    runtimeKind,
    agentId: null,
    configJson: '{}',
  }
}

export function update(input: {
  id: string
  title?: string
  pinned?: boolean
  providerTargetId?: string | null
  modelId?: string | null
}): SessionView | null {
  const record = db().select().from(sessions).where(eq(sessions.id, input.id)).get()
  if (!record) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const patch: Partial<typeof sessions.$inferInsert> = { updatedAt: now }
  const nextProviderTargetId = input.providerTargetId ?? record.providerTargetId

  if (input.title !== undefined) {
    patch.title = input.title
    patch.titleSource = 'user'
  }
  if (input.pinned !== undefined) {
    patch.pinned = input.pinned ? 1 : 0
  }
  if (input.providerTargetId !== undefined) {
    if (!input.providerTargetId) {
      throw new AppError({
        code: 'invalid_session_input',
        status: 400,
        message: 'Provider-backed sessions require a provider target',
        details: { sessionId: input.id },
      })
    }
    const target = resolveProviderTarget(input.providerTargetId)
    assertProviderTargetCompatibleWithRuntime(input.providerTargetId, record.runtimeKind)
    if (!target.enabled) {
      throw new AppError({
        code: 'invalid_session_input',
        status: 409,
        message: 'Provider target is disabled',
        details: { sessionId: input.id, providerTargetId: input.providerTargetId },
      })
    }
    patch.providerTargetId = input.providerTargetId
    if (record.agentId && input.providerTargetId !== record.providerTargetId) {
      patch.agentId = null
    }
  }

  db().update(sessions).set(patch).where(eq(sessions.id, input.id)).run()

  if (input.modelId !== undefined || input.providerTargetId !== undefined) {
    upsertSessionRequestedModel({
      session: record,
      providerTargetId: nextProviderTargetId,
      modelId: input.modelId,
      now,
    })
  }

  return get(input.id)
}

function upsertSessionRequestedModel(input: {
  session: Session
  providerTargetId: string | null
  modelId?: string | null
  now: number
}): void {
  if (!input.providerTargetId) {
    return
  }

  const existing = db()
    .select()
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.chatSessionId, input.session.id))
    .get()
  const providerChanged = existing?.providerTargetId !== input.providerTargetId
  const runtimeChanged = existing?.runtimeKind !== input.session.runtimeKind
  const requestedModelId = input.modelId === undefined
    ? providerChanged || runtimeChanged ? null : existing?.requestedModelId ?? null
    : input.modelId

  if (existing) {
    const backendStateSnapshot = providerChanged || runtimeChanged
      ? JSON.stringify({ models: { currentModelId: requestedModelId } })
      : writeRequestedModelToProviderStateSnapshot(existing.backendStateSnapshot, requestedModelId)
    db()
      .update(backendSessionBindings)
      .set({
        providerTargetId: input.providerTargetId,
        runtimeKind: input.session.runtimeKind,
        backendSessionId: providerChanged || runtimeChanged ? null : existing.backendSessionId,
        backendStateSnapshot,
        requestedModelId,
        updatedAt: input.now,
      })
      .where(eq(backendSessionBindings.id, existing.id))
      .run()
    return
  }

  if (requestedModelId === null) {
    return
  }

  db()
    .insert(backendSessionBindings)
    .values({
      id: randomUUID(),
      chatSessionId: input.session.id,
      providerTargetId: input.providerTargetId,
      runtimeKind: input.session.runtimeKind,
      backendSessionId: null,
      backendStateSnapshot: JSON.stringify({ models: { currentModelId: requestedModelId } }),
      requestedModelId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run()
}

function writeRequestedModelToProviderStateSnapshot(
  raw: string | null,
  modelId: string | null,
): string {
  const snapshot = raw ? JSON.parse(raw) as Record<string, unknown> : {}
  const models = snapshot.models && typeof snapshot.models === 'object' && !Array.isArray(snapshot.models)
    ? snapshot.models as Record<string, unknown>
    : {}
  return JSON.stringify({
    ...snapshot,
    models: {
      ...models,
      currentModelId: modelId,
    },
  })
}

export function updateTitle(input: { id: string, title: string }): void {
  update(input)
}

type CleanupHandler = (sessionId: string) => void
type ArchiveHandler = (sessionId: string) => void
const cleanupHandlers: CleanupHandler[] = []
const archiveHandlers: ArchiveHandler[] = []

export function onSessionCleanup(handler: CleanupHandler): void {
  cleanupHandlers.push(handler)
}

export function onSessionArchived(handler: ArchiveHandler): void {
  archiveHandlers.push(handler)
}

function notifySessionArchived(id: string): void {
  for (const handler of archiveHandlers) {
    try {
      handler(id)
    }
 catch {
      // archive hooks must not break the soft-archive flow
    }
  }
}

function cleanupSessionResources(id: string): void {
  for (const handler of cleanupHandlers) {
    try {
      handler(id)
    }
 catch {
      // cleanup handlers must not break the delete flow
    }
  }
}

export function remove(id: string): void {
  cleanupSessionResources(id)
  db().delete(sessions).where(eq(sessions.id, id)).run()
}

type SessionDeleteDb = Pick<ReturnType<typeof db>, 'select' | 'delete'>

function deleteSessionIdsInDb(ids: string[], d: SessionDeleteDb): void {
  for (const id of ids) {
    cleanupSessionResources(id)
  }

  if (ids.length > 0) {
    d.delete(sessions).where(inArray(sessions.id, ids)).run()
  }
}

export function deleteByProviderTargetInDb(providerTargetId: string, d: SessionDeleteDb): void {
  const ids = d
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.providerTargetId, providerTargetId))
    .all()
    .map(row => row.id)

  deleteSessionIdsInDb(ids, d)
}

export function deleteByAgentIdsInDb(agentIds: string[], d: SessionDeleteDb): void {
  if (agentIds.length === 0) {
    return
  }

  const ids = d
    .select({ id: sessions.id })
    .from(sessions)
    .where(inArray(sessions.agentId, agentIds))
    .all()
    .map(row => row.id)

  deleteSessionIdsInDb(ids, d)
}

export function getMessages(sessionId: string): Message[] {
  return db()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()
}

export function getMessagesWithRunIds(
  sessionId: string,
): Array<Message & { runId: string | null }> {
  const d = db()
  const rows = d
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  const assistantIds = rows.filter(row => row.role === 'assistant').map(row => row.id)
  const latestRunByMessageId = new Map<string, string>()

  if (assistantIds.length > 0) {
    const runs = d
      .select({
        id: backendRuns.id,
        messageId: backendRuns.messageId,
        startedAt: backendRuns.startedAt,
      })
      .from(backendRuns)
      .where(inArray(backendRuns.messageId, assistantIds))
      .orderBy(desc(backendRuns.startedAt))
      .all()

    for (const run of runs) {
      if (!run.messageId || latestRunByMessageId.has(run.messageId)) {
        continue
      }
      latestRunByMessageId.set(run.messageId, run.id)
    }
  }

  return rows.map(row => ({
    ...row,
    runId: row.role === 'assistant' ? (latestRunByMessageId.get(row.id) ?? null) : null,
  }))
}

export function getRunMessageContents(runIds: string[]): { runId: string, content: string }[] {
  if (runIds.length === 0) {
    return []
  }

  const rows = db()
    .select({
      runId: backendRuns.id,
      content: messages.content,
    })
    .from(backendRuns)
    .innerJoin(messages, eq(backendRuns.messageId, messages.id))
    .where(inArray(backendRuns.id, runIds))
    .all()

  return rows.map(row => ({ runId: row.runId, content: row.content }))
}

export function exportMarkdown(sessionId: string): string {
  const d = db()
  const session = d.select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    return ''
  }

  const msgs = d
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  const binding = d
    .select()
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.chatSessionId, sessionId))
    .get()

  const lines: string[] = []
  lines.push(`# ${session.title}`)
  lines.push('')
  lines.push(
    `> Model: ${binding?.requestedModelId ?? 'unknown'} | Created: ${new Date(session.createdAt * 1000).toLocaleString()}`,
  )
  lines.push('')

  for (const msg of msgs) {
    const role = msg.role === 'user' ? 'User' : 'Assistant'
    lines.push(`## ${role}`)
    lines.push('')
    lines.push(msg.content)
    lines.push('')
  }

  return lines.join('\n')
}
