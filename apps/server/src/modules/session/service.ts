import { randomUUID } from 'node:crypto'

import type { Message, Session } from '@cradle/db'
import { agents, backendRuns, backendSessionBindings, messages, sessions } from '@cradle/db'
import { desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import {
  AgentRuntimeConfigJsonSchema,
  buildSessionRuntimeConfigJson,
} from '../../helpers/agent-runtime-config'
import { db } from '../../infra'
import { assertProviderTargetCompatibleWithRuntime, resolveProviderTarget } from '../provider-targets/service'
import type { RuntimeKind } from '../providers/types'
import { runtimeKinds } from '../providers/types'
import * as Workspace from '../workspace/service'

export type SessionView = Session & { modelId: string | null }

const RuntimeKindSchema = z.enum(runtimeKinds)

const SessionCreateInputSchema = z.object({
  id: z.string().default(() => randomUUID()),
  workspaceId: z.string().nullable().default(null),
  title: z.string(),
  providerTargetId: z.string().nullable().optional(),
  runtimeKind: RuntimeKindSchema.optional(),
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

function toSessionView(session: Session, modelId: string | null): SessionView {
  return {
    ...session,
    modelId,
  }
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

export function list(workspaceId: string): SessionView[] {
  const rows = db()
    .select()
    .from(sessions)
    .where(eq(sessions.workspaceId, workspaceId))
    .orderBy(desc(sessions.updatedAt))
    .all()

  const modelsBySessionId = listRequestedModelsBySessionIds(rows.map(row => row.id))
  return rows.map(row => toSessionView(row, modelsBySessionId.get(row.id) ?? null))
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

  return toSessionView(row, binding?.requestedModelId ?? null)
}

export function create(input: {
  id?: string
  workspaceId?: string | null
  title: string
  providerTargetId?: string | null
  runtimeKind?: RuntimeKind
  agentId?: string | null
  linkedIssueId?: string | null
  configJson?: string
}): SessionView {
  const parsed = SessionCreateInputSchema.parse(input)
  const resolved = resolveSessionCreateInput(parsed)
  const workspaceId = parsed.workspaceId ?? Workspace.createAdHocWorkspace().id
  const rowInput = z
    .object({
      configJson: z.string().default(() => resolved.configJson),
    })
    .parse(parsed)
  const created = db()
    .insert(sessions)
    .values({
      id: parsed.id,
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

  return toSessionView(created, null)
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
}): SessionView | null {
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

type CleanupHandler = (sessionId: string) => void
const cleanupHandlers: CleanupHandler[] = []

export function onSessionCleanup(handler: CleanupHandler): void {
  cleanupHandlers.push(handler)
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
