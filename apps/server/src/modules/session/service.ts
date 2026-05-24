import { createHash, randomUUID } from 'node:crypto'

import type { Message, Session } from '@cradle/db'
import { agentProfiles, agents, backendRuns, backendSessionBindings, messages, sessions } from '@cradle/db'
import { desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { AgentRuntimeConfigJsonSchema, buildSessionRuntimeConfigJson } from '../../helpers/agent-runtime-config'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { buildAgentAvatarUrl } from '../agent-identity/avatar'
import { runtimeSupportsProviderKind } from '../providers/runtime-compatibility'
import { runtimeKinds, type RuntimeKind } from '../providers/types'

// ── session CRUD ──

export type SessionView = Session & { modelId: string | null, modelProfileId: string | null }

const RuntimeKindSchema = z.enum(runtimeKinds)

const SessionCreateInputSchema = z.object({
  id: z.string().default(() => randomUUID()),
  workspaceId: z.string().nullable().default(null),
  title: z.string(),
  agentProfileId: z.string().nullable().optional(),
  runtimeKind: RuntimeKindSchema.optional(),
  agentId: z.string().nullable().optional(),
  linkedIssueId: z.string().nullable().default(null),
  configJson: z.string().optional(),
})

const ProfileBackedSessionInputSchema = z.object({
  agentProfileId: z.string().nullable().optional(),
  runtimeKind: RuntimeKindSchema.default('standard'),
})

function listRequestedModelsBySessionIds(sessionIds: string[]): Map<string, { modelId: string | null, modelProfileId: string | null }> {
  if (sessionIds.length === 0) {
    return new Map()
  }

  const bindings = db()
    .select({
      chatSessionId: backendSessionBindings.chatSessionId,
      agentProfileId: backendSessionBindings.agentProfileId,
      requestedModelId: backendSessionBindings.requestedModelId,
    })
    .from(backendSessionBindings)
    .where(inArray(backendSessionBindings.chatSessionId, sessionIds))
    .all()

  return new Map(bindings.map(binding => [binding.chatSessionId, {
    modelId: binding.requestedModelId ?? null,
    modelProfileId: binding.agentProfileId ?? null,
  }]))
}

function toSessionView(session: Session, binding: { modelId: string | null, modelProfileId: string | null } | null): SessionView {
  return {
    ...session,
    modelId: binding?.modelId ?? null,
    modelProfileId: binding?.modelProfileId ?? null,
  }
}

function resolveDefaultAgentName(runtimeKind: RuntimeKind, profileName: string): string {
  if (runtimeKind === 'jar-core') {
    return 'Jarvis'
  }
  return profileName
}

function defaultAgentId(profileId: string, runtimeKind: RuntimeKind): string {
  const digest = createHash('sha256').update(`${profileId}:${runtimeKind}`).digest('hex').slice(0, 24)
  return `default-agent-${digest}`
}

function resolveProfileBackedAgent(input: { agentProfileId: string, runtimeKind: RuntimeKind }): string {
  const id = defaultAgentId(input.agentProfileId, input.runtimeKind)
  const existing = db()
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, id))
    .get()

  if (existing) {
    return existing.id
  }

  const profile = db()
    .select({ id: agentProfiles.id, name: agentProfiles.name })
    .from(agentProfiles)
    .where(eq(agentProfiles.id, input.agentProfileId))
    .get()

  if (!profile) {
    throw new AppError({
      code: 'agent_profile_not_found',
      status: 404,
      message: 'Agent profile not found',
      details: { agentProfileId: input.agentProfileId },
    })
  }

  const now = currentUnixSeconds()
  const name = resolveDefaultAgentName(input.runtimeKind, profile.name)
  const avatarSeed = input.runtimeKind === 'jar-core' ? 'jarvis' : `${profile.id}:${input.runtimeKind}`
  const created = db()
    .insert(agents)
    .values({
      id,
      name,
      description: `Default ${name} identity for ${profile.name}`,
      avatarUrl: buildAgentAvatarUrl('bottts-neutral', avatarSeed),
      avatarStyle: 'bottts-neutral',
      avatarSeed,
      agentProfileId: profile.id,
      runtimeKind: input.runtimeKind,
      configJson: '{}',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: agents.id,
      set: { updatedAt: now },
    })
    .returning({ id: agents.id })
    .get()

  return created.id
}

function assertProfileCompatibleWithRuntime(input: { agentProfileId: string, runtimeKind: RuntimeKind }): void {
  const profile = db()
    .select({ id: agentProfiles.id, providerKind: agentProfiles.providerKind })
    .from(agentProfiles)
    .where(eq(agentProfiles.id, input.agentProfileId))
    .get()

  if (!profile) {
    throw new AppError({
      code: 'agent_profile_not_found',
      status: 404,
      message: 'Agent profile not found',
      details: { agentProfileId: input.agentProfileId },
    })
  }

  if (!runtimeSupportsProviderKind(input.runtimeKind, profile.providerKind)) {
    throw new AppError({
      code: 'invalid_session_input',
      status: 400,
      message: 'Agent profile is not compatible with the selected runtime',
      details: {
        agentProfileId: input.agentProfileId,
        runtimeKind: input.runtimeKind,
        providerKind: profile.providerKind,
      },
    })
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

  const binding = db()
    .select({
      agentProfileId: backendSessionBindings.agentProfileId,
      requestedModelId: backendSessionBindings.requestedModelId,
    })
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.chatSessionId, id))
    .get() ?? null

  return toSessionView(row, binding
    ? { modelId: binding.requestedModelId ?? null, modelProfileId: binding.agentProfileId ?? null }
    : null)
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
  const parsed = SessionCreateInputSchema.parse(input)
  const resolved = resolveSessionCreateInput(parsed)
  const rowInput = z.object({
    configJson: z.string().default(() => resolved.configJson),
  }).parse(parsed)
  const created = db()
    .insert(sessions)
    .values({
      id: parsed.id,
      workspaceId: parsed.workspaceId,
      title: parsed.title,
      agentProfileId: resolved.agentProfileId,
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
        agentProfileId: null,
        runtimeKind: agent.runtimeKind,
        agentId: agent.id,
        configJson: buildSessionRuntimeConfigJson({ cliTuiLaunch: launch }),
      }
    }

    if (agent.agentProfileId) {
      assertProfileCompatibleWithRuntime({ agentProfileId: agent.agentProfileId, runtimeKind: agent.runtimeKind })
    }

    return {
      agentProfileId: agent.agentProfileId,
      runtimeKind: agent.runtimeKind,
      agentId: agent.id,
      configJson: '{}',
    }
  }

  const profileInput = ProfileBackedSessionInputSchema.parse({
    agentProfileId: input.agentProfileId,
    runtimeKind: input.runtimeKind,
  })

  if (profileInput.runtimeKind === 'cli-tui') {
    throw new AppError({
      code: 'invalid_session_input',
      status: 400,
      message: 'CLI TUI sessions must be created from an agent',
    })
  }

  if (!profileInput.agentProfileId) {
    throw new AppError({
      code: 'invalid_session_input',
      status: 400,
      message: 'Session requires an agent profile or an agent',
    })
  }

  assertProfileCompatibleWithRuntime({
    agentProfileId: profileInput.agentProfileId,
    runtimeKind: profileInput.runtimeKind,
  })

  return {
    agentProfileId: profileInput.agentProfileId,
    runtimeKind: profileInput.runtimeKind,
    agentId: resolveProfileBackedAgent({ agentProfileId: profileInput.agentProfileId, runtimeKind: profileInput.runtimeKind }),
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
