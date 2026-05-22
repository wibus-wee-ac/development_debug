import { randomUUID } from 'node:crypto'

import type { Agent } from '@cradle/db'
import { agents } from '@cradle/db'
import type { SQL } from 'drizzle-orm'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { AgentRuntimeConfigJsonSchema } from '../../helpers/agent-runtime-config'
import { db } from '../../infra'
import { buildAgentAvatarUrl } from './avatar'

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

const AgentRuntimeKindSchema = z.enum(['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui'])
const AgentThinkingEffortSchema = z.enum(['low', 'medium', 'high', 'auto'])
const AgentDescriptionSchema = z.string().trim().transform(value => value.length > 0 ? value : null).nullable().default(null)
const DefaultAgentRuntimeConfig = AgentRuntimeConfigJsonSchema.parse(undefined)
const CreateAgentInputSchema = z.object({
  name: z.string().trim(),
  description: AgentDescriptionSchema,
  avatarStyle: z.string(),
  avatarSeed: z.string(),
  agentProfileId: z.string().nullable().default(null),
  modelId: z.string().nullable().default(null),
  thinkingEffort: AgentThinkingEffortSchema.default('auto'),
  runtimeKind: AgentRuntimeKindSchema.default('standard'),
  configJson: AgentRuntimeConfigJsonSchema.default(DefaultAgentRuntimeConfig),
}).superRefine((input, ctx) => {
  if (input.runtimeKind === 'cli-tui') {
    if (input.agentProfileId) {
      ctx.addIssue({
        code: 'custom',
        message: 'CLI TUI agents must not reference a provider profile',
        path: ['agentProfileId'],
      })
      return
    }

    if (!input.configJson.cliTui) {
      ctx.addIssue({
        code: 'custom',
        message: 'CLI TUI agents require launch configuration',
        path: ['configJson'],
      })
    }
    return
  }

  if (!input.agentProfileId) {
    ctx.addIssue({
      code: 'custom',
      message: 'Provider-backed agents require an agent profile',
      path: ['agentProfileId'],
    })
  }
}).transform((input) => {
  const parsed = {
    ...input,
    configJson: JSON.stringify(input.configJson),
  }
  return input.runtimeKind === 'cli-tui'
    ? {
        ...parsed,
        agentProfileId: null,
        modelId: null,
        thinkingEffort: 'auto' as const,
      }
  : parsed
})
type ParsedAgentInput = z.infer<typeof CreateAgentInputSchema>

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
  let parsed: ParsedAgentInput | null = null
  try {
    parsed = CreateAgentInputSchema.parse(input)
    const avatarUrl = buildAgentAvatarUrl(parsed.avatarStyle, parsed.avatarSeed)
    return db()
      .insert(agents)
      .values({
        id: randomUUID(),
        name: parsed.name,
        description: parsed.description,
        avatarUrl,
        avatarStyle: parsed.avatarStyle,
        avatarSeed: parsed.avatarSeed,
        agentProfileId: parsed.agentProfileId,
        modelId: parsed.modelId,
        thinkingEffort: parsed.thinkingEffort,
        runtimeKind: parsed.runtimeKind,
        configJson: parsed.configJson,
        enabled: true,
      })
      .returning()
      .get()
  }
  catch (error) {
    throw mapAgentIdentityError(error, parsed?.agentProfileId)
  }
}

export function update(id: string, patch: UpdateAgentInput): Agent | null {
  const current = db().select().from(agents).where(eq(agents.id, id)).get()
  if (!current) {
    return null
  }

  let parsed: ParsedAgentInput | null = null

  try {
    parsed = CreateAgentInputSchema.parse({
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

    const nextStyle = parsed.avatarStyle
    const nextSeed = parsed.avatarSeed
    const updatePatch: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) }

    if (patch.name !== undefined) {
      updatePatch.name = parsed.name
    }
    if (patch.description !== undefined) {
      updatePatch.description = parsed.description
    }
    if (patch.avatarStyle !== undefined) {
      updatePatch.avatarStyle = parsed.avatarStyle
    }
    if (patch.avatarSeed !== undefined) {
      updatePatch.avatarSeed = parsed.avatarSeed
    }
    if (patch.agentProfileId !== undefined) {
      updatePatch.agentProfileId = parsed.agentProfileId
    }
    if (patch.modelId !== undefined) {
      updatePatch.modelId = parsed.modelId
    }
    if (patch.thinkingEffort !== undefined) {
      updatePatch.thinkingEffort = parsed.thinkingEffort
    }
    if (patch.runtimeKind !== undefined) {
      updatePatch.runtimeKind = parsed.runtimeKind
    }
    if (patch.configJson !== undefined) {
      updatePatch.configJson = parsed.configJson
    }
    if (patch.enabled !== undefined) {
      updatePatch.enabled = patch.enabled
    }
    if (patch.avatarStyle !== undefined || patch.avatarSeed !== undefined) {
      updatePatch.avatarUrl = buildAgentAvatarUrl(nextStyle, nextSeed)
    }

    return db().update(agents).set(updatePatch).where(eq(agents.id, id)).returning().get() ?? null
  }
  catch (error) {
    throw mapAgentIdentityError(error, parsed?.agentProfileId)
  }
}

export function remove(id: string): void {
  db().delete(agents).where(eq(agents.id, id)).run()
}

function mapAgentIdentityError(error: unknown, agentProfileId: string | null | undefined): Error {
  if (error instanceof z.ZodError) {
    return new AppError({
      code: 'invalid_agent_input',
      status: 400,
      message: error.issues[0]?.message ?? 'Invalid agent input',
      details: { issues: error.issues },
    })
  }

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
