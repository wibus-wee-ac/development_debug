import { randomUUID } from 'node:crypto'

import type { Agent } from '@cradle/db'
import { agents } from '@cradle/db'
import type { SQL } from 'drizzle-orm'
import { and, desc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
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
  agentProfileId: string
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
  agentProfileId?: string
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
  const avatarUrl = buildAvatarUrl(input.avatarStyle, input.avatarSeed)
  try {
    return db()
      .insert(agents)
      .values({
        id: randomUUID(),
        name: input.name,
        description: input.description ?? null,
        avatarUrl,
        avatarStyle: input.avatarStyle,
        avatarSeed: input.avatarSeed,
        agentProfileId: input.agentProfileId,
        modelId: input.modelId ?? null,
        thinkingEffort: input.thinkingEffort ?? 'auto',
        runtimeKind: input.runtimeKind ?? 'standard',
        configJson: input.configJson ?? '{}',
        enabled: true,
      })
      .returning()
      .get()
  }
  catch (error) {
    throw mapAgentIdentityError(error, input.agentProfileId)
  }
}

export function update(id: string, patch: UpdateAgentInput): Agent | null {
  const current = db().select().from(agents).where(eq(agents.id, id)).get()
  if (!current) {
    return null
  }

  const nextStyle = patch.avatarStyle ?? current.avatarStyle
  const nextSeed = patch.avatarSeed ?? current.avatarSeed

  const updatePatch: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) }
  if (patch.name !== undefined) {
    updatePatch.name = patch.name
  }
  if (patch.description !== undefined) {
    updatePatch.description = patch.description
  }
  if (patch.avatarStyle !== undefined) {
    updatePatch.avatarStyle = patch.avatarStyle
  }
  if (patch.avatarSeed !== undefined) {
    updatePatch.avatarSeed = patch.avatarSeed
  }
  if (patch.agentProfileId !== undefined) {
    updatePatch.agentProfileId = patch.agentProfileId
  }
  if (patch.modelId !== undefined) {
    updatePatch.modelId = patch.modelId
  }
  if (patch.thinkingEffort !== undefined) {
    updatePatch.thinkingEffort = patch.thinkingEffort
  }
  if (patch.runtimeKind !== undefined) {
    updatePatch.runtimeKind = patch.runtimeKind
  }
  if (patch.configJson !== undefined) {
    updatePatch.configJson = patch.configJson
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
    throw mapAgentIdentityError(error, (patch.agentProfileId ?? current.agentProfileId)!)
  }
}

export function remove(id: string): void {
  db().delete(agents).where(eq(agents.id, id)).run()
}

// ── helpers ──

function buildAvatarUrl(style: string | null, seed: string | null): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style ?? 'bottts')}/svg?seed=${encodeURIComponent(seed ?? 'default')}`
}

function mapAgentIdentityError(error: unknown, agentProfileId: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new AppError({
      code: 'agent_profile_not_found',
      status: 400,
      message: 'Agent profile not found',
      details: { agentProfileId },
    })
  }
  return error instanceof Error ? error : new Error(message)
}
