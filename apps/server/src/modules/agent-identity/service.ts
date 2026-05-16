import { randomUUID } from 'node:crypto'

import type { Agent } from '@cradle/db'
import { agents } from '@cradle/db'
import type { SQL } from 'drizzle-orm'
import { and, desc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { readCliTuiLaunchSpecFromAgentConfig } from '../../helpers/agent-runtime-config'
import { db } from '../../infra'

// ── types ──

export interface AgentListFilters {
  enabled?: boolean
  agentProfileId?: string
}

export interface CreateAgentInput {
  name: string
  description?: string | null
  avatarStyle: string
  avatarSeed: string
  agentProfileId?: string | null
  modelId?: string | null
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto'
  runtimeKind?: 'standard' | 'claude-agent' | 'codex' | 'jar-core' | 'acp-chat' | 'cli-tui'
  configJson?: string
}

export interface UpdateAgentInput {
  name?: string
  description?: string | null
  avatarStyle?: string
  avatarSeed?: string
  agentProfileId?: string | null
  modelId?: string | null
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto'
  runtimeKind?: 'standard' | 'claude-agent' | 'codex' | 'jar-core' | 'acp-chat' | 'cli-tui'
  configJson?: string
  enabled?: boolean
}

// ── public API ──

export function list(filters: AgentListFilters = {}): Agent[] {
  const clauses: SQL[] = []
  if (filters.enabled !== undefined) {
    clauses.push(eq(agents.enabled, filters.enabled))
  }
  if (filters.agentProfileId) {
    clauses.push(eq(agents.agentProfileId, filters.agentProfileId))
  }

  const query = db().select().from(agents)
  if (clauses.length === 0) {
    return query.orderBy(desc(agents.updatedAt)).all()
  }
  return query.where(clauses.length === 1 ? clauses[0]! : and(...clauses)).orderBy(desc(agents.updatedAt)).all()
}

export function get(id: string): Agent | null {
  return db().select().from(agents).where(eq(agents.id, id)).get() ?? null
}

export function create(input: CreateAgentInput): Agent {
  const normalized = normalizeAgentInput(input)
  const avatarUrl = buildAvatarUrl(input.avatarStyle, input.avatarSeed)
  try {
    return db()
      .insert(agents)
      .values({
        id: randomUUID(),
        name: normalized.name,
        description: normalized.description,
        avatarUrl,
        avatarStyle: normalized.avatarStyle,
        avatarSeed: normalized.avatarSeed,
        agentProfileId: normalized.agentProfileId,
        modelId: normalized.modelId,
        thinkingEffort: normalized.thinkingEffort,
        runtimeKind: normalized.runtimeKind,
        configJson: normalized.configJson,
        enabled: true,
      })
      .returning()
      .get()
  }
  catch (error) {
    throw mapAgentIdentityError(error, normalized.agentProfileId)
  }
}

export function update(id: string, patch: UpdateAgentInput): Agent | null {
  const current = db().select().from(agents).where(eq(agents.id, id)).get()
  if (!current) {
    return null
  }

  const normalized = normalizeAgentInput({
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    avatarStyle: patch.avatarStyle ?? current.avatarStyle,
    avatarSeed: patch.avatarSeed ?? current.avatarSeed,
    agentProfileId: patch.agentProfileId ?? current.agentProfileId,
    modelId: patch.modelId ?? current.modelId,
    thinkingEffort: patch.thinkingEffort ?? current.thinkingEffort,
    runtimeKind: patch.runtimeKind ?? current.runtimeKind,
    configJson: patch.configJson ?? current.configJson,
  })

  const nextStyle = normalized.avatarStyle
  const nextSeed = normalized.avatarSeed

  const updatePatch: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) }
  if (patch.name !== undefined) {
    updatePatch.name = normalized.name
  }
  if (patch.description !== undefined) {
    updatePatch.description = normalized.description
  }
  if (patch.avatarStyle !== undefined) {
    updatePatch.avatarStyle = normalized.avatarStyle
  }
  if (patch.avatarSeed !== undefined) {
    updatePatch.avatarSeed = normalized.avatarSeed
  }
  if (patch.agentProfileId !== undefined) {
    updatePatch.agentProfileId = normalized.agentProfileId
  }
  if (patch.modelId !== undefined) {
    updatePatch.modelId = normalized.modelId
  }
  if (patch.thinkingEffort !== undefined) {
    updatePatch.thinkingEffort = normalized.thinkingEffort
  }
  if (patch.runtimeKind !== undefined) {
    updatePatch.runtimeKind = normalized.runtimeKind
  }
  if (patch.configJson !== undefined) {
    updatePatch.configJson = normalized.configJson
  }
  if (patch.enabled !== undefined) {
    updatePatch.enabled = patch.enabled
  }
  if (patch.avatarStyle !== undefined || patch.avatarSeed !== undefined) {
    updatePatch.avatarUrl = buildAvatarUrl(nextStyle, nextSeed)
  }

  try {
    return db().update(agents).set(updatePatch).where(eq(agents.id, id)).returning().get() ?? null
  }
  catch (error) {
    throw mapAgentIdentityError(error, normalized.agentProfileId)
  }
}

export function remove(id: string): void {
  db().delete(agents).where(eq(agents.id, id)).run()
}

// ── helpers ──

function buildAvatarUrl(style: string | null, seed: string | null): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style ?? 'bottts')}/svg?seed=${encodeURIComponent(seed ?? 'default')}`
}

function normalizeAgentInput(input: CreateAgentInput): Required<Omit<CreateAgentInput, 'agentProfileId'>> & { agentProfileId: string | null, description: string | null } {
  const runtimeKind = input.runtimeKind ?? 'standard'
  const configJson = input.configJson ?? '{}'

  if (runtimeKind === 'cli-tui') {
    if (input.agentProfileId) {
      throw new AppError({
        code: 'invalid_agent_input',
        status: 400,
        message: 'CLI TUI agents must not reference a provider profile',
        details: { runtimeKind },
      })
    }

    const launch = readCliTuiLaunchSpecFromAgentConfig(configJson)
    if (!launch) {
      throw new AppError({
        code: 'invalid_agent_input',
        status: 400,
        message: 'CLI TUI agents require launch configuration',
        details: { runtimeKind },
      })
    }

    return {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      avatarStyle: input.avatarStyle,
      avatarSeed: input.avatarSeed,
      agentProfileId: null,
      modelId: null,
      thinkingEffort: 'auto',
      runtimeKind,
      configJson,
    }
  }

  if (!input.agentProfileId) {
    throw new AppError({
      code: 'invalid_agent_input',
      status: 400,
      message: 'Provider-backed agents require an agent profile',
      details: { runtimeKind },
    })
  }

  return {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    avatarStyle: input.avatarStyle,
    avatarSeed: input.avatarSeed,
    agentProfileId: input.agentProfileId,
    modelId: input.modelId ?? null,
    thinkingEffort: input.thinkingEffort ?? 'auto',
    runtimeKind,
    configJson,
  }
}

function mapAgentIdentityError(error: unknown, agentProfileId: string | null | undefined): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('FOREIGN KEY constraint failed') && agentProfileId) {
    return new AppError({
      code: 'agent_profile_not_found',
      status: 400,
      message: 'Agent profile not found',
      details: { agentProfileId },
    })
  }
  return error instanceof Error ? error : new Error(message)
}
