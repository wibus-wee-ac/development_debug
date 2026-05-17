import { randomUUID } from 'node:crypto'

import type { Message, Session } from '@cradle/db'
import { agents, backendRuns, backendSessionBindings, messages, sessions } from '@cradle/db'
import { desc, eq, inArray } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { buildSessionRuntimeConfigJson, readCliTuiLaunchSpecFromAgentConfig } from '../../helpers/agent-runtime-config'
import { db } from '../../infra'
import type { RuntimeKind } from '../providers/types'

// ── session CRUD ──

export type SessionView = Session & { modelId: string | null }

function listRequestedModelIdsBySessionIds(sessionIds: string[]): Map<string, string | null> {
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

  return new Map(bindings.map(binding => [binding.chatSessionId, binding.requestedModelId ?? null]))
}

function toSessionView(session: Session, modelId: string | null): SessionView {
  return {
    ...session,
    modelId,
  }
}

export function list(workspaceId: string): SessionView[] {
  const rows = db()
    .select()
    .from(sessions)
    .where(eq(sessions.workspaceId, workspaceId))
    .orderBy(desc(sessions.updatedAt))
    .all()

  const modelIdsBySessionId = listRequestedModelIdsBySessionIds(rows.map(row => row.id))
  return rows.map(row => toSessionView(row, modelIdsBySessionId.get(row.id) ?? null))
}

export function get(id: string): SessionView | null {
  const row = db().select().from(sessions).where(eq(sessions.id, id)).get() ?? null
  if (!row) {
    return null
  }

  const modelId = db()
    .select({ requestedModelId: backendSessionBindings.requestedModelId })
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.chatSessionId, id))
    .get()
?.requestedModelId ?? null

  return toSessionView(row, modelId)
}

export function create(input: {
  id?: string
  workspaceId?: string | null
  title: string
  agentProfileId?: string | null
  runtimeKind?: RuntimeKind
  agentId?: string | null
  linkedIssueId?: string | null
  configJson?: string
}): SessionView {
  const id = input.id ?? randomUUID()
  const resolved = resolveSessionCreateInput(input)
  const finalConfigJson = input.configJson ?? resolved.configJson
  const created = db()
    .insert(sessions)
    .values({
      id,
      workspaceId: input.workspaceId ?? null,
      title: input.title,
      agentProfileId: resolved.agentProfileId,
      runtimeKind: resolved.runtimeKind,
      agentId: resolved.agentId,
      configJson: finalConfigJson,
      linkedIssueId: input.linkedIssueId ?? null,
    })
    .returning()
    .get()

  return toSessionView(created, null)
}

function resolveSessionCreateInput(input: {
  agentProfileId?: string | null
  runtimeKind?: RuntimeKind
  agentId?: string | null
}): {
  agentProfileId: string | null
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
        details: { agentId: input.agentId, runtimeKind: input.runtimeKind, agentRuntimeKind: agent.runtimeKind },
      })
    }

    if (agent.runtimeKind === 'cli-tui') {
      const launch = readCliTuiLaunchSpecFromAgentConfig(agent.configJson)
      if (!launch) {
        throw new AppError({
          code: 'invalid_session_input',
          status: 400,
          message: 'CLI TUI session requires launch configuration on the selected agent',
          details: { agentId: input.agentId },
        })
      }
      return {
        agentProfileId: null,
        runtimeKind: agent.runtimeKind,
        agentId: agent.id,
        configJson: buildSessionRuntimeConfigJson({ cliTuiLaunch: launch }),
      }
    }

    return {
      agentProfileId: agent.agentProfileId,
      runtimeKind: agent.runtimeKind,
      agentId: agent.id,
      configJson: '{}',
    }
  }

  if ((input.runtimeKind ?? 'standard') === 'cli-tui') {
    throw new AppError({
      code: 'invalid_session_input',
      status: 400,
      message: 'CLI TUI sessions must be created from an agent',
    })
  }

  if (!input.agentProfileId) {
    throw new AppError({
      code: 'invalid_session_input',
      status: 400,
      message: 'Session requires an agent profile or an agent',
    })
  }

  return {
    agentProfileId: input.agentProfileId,
    runtimeKind: input.runtimeKind ?? 'standard',
    agentId: input.agentId ?? null,
    configJson: '{}',
  }
}

export function update(input: { id: string, title?: string, pinned?: boolean }): SessionView | null {
  const record = db().select().from(sessions).where(eq(sessions.id, input.id)).get()
  if (!record) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const patch: Partial<typeof sessions.$inferInsert> = { updatedAt: now }

  if (input.title !== undefined) {
    patch.title = input.title
  }
  if (input.pinned !== undefined) {
    patch.pinned = input.pinned ? 1 : 0
  }

  db().update(sessions).set(patch).where(eq(sessions.id, input.id)).run()
  return get(input.id)
}

export function updateTitle(input: { id: string, title: string }): void {
  update(input)
}

// ── cleanup hooks ──

type CleanupHandler = (sessionId: string) => void
const cleanupHandlers: CleanupHandler[] = []

export function onSessionCleanup(handler: CleanupHandler): void {
  cleanupHandlers.push(handler)
}

// ...

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

export function deleteByAgentProfileInDb(agentProfileId: string, d: SessionDeleteDb): void {
  const ids = d
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.agentProfileId, agentProfileId))
    .all()
    .map(row => row.id)

  for (const id of ids) {
    cleanupSessionResources(id)
  }

  if (ids.length > 0) {
    d.delete(sessions).where(inArray(sessions.id, ids)).run()
  }
}

export function deleteByAgentProfile(agentProfileId: string): void {
  db().transaction((tx) => {
    deleteByAgentProfileInDb(agentProfileId, tx)
  })
}

// ── messages ──

export function getMessages(sessionId: string): Message[] {
  return db()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()
}

export function getMessagesWithRunIds(sessionId: string): Array<Message & { runId: string | null }> {
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
    runId: row.role === 'assistant' ? latestRunByMessageId.get(row.id) ?? null : null,
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

// ── export ──

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
  lines.push(`> Model: ${binding?.requestedModelId ?? 'unknown'} | Created: ${new Date(session.createdAt * 1000).toLocaleString()}`)
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
