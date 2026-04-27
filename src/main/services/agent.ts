// Input: IpcService base, drizzle DB, agents table schema, AgentRuntimeService for model listing
// Output: AgentService IPC handler for Agent identity CRUD
// Position: Main-process service for the Agent identity layer (bound to Providers via providerId)

import { randomUUID } from 'node:crypto'

import { IpcMethod, IpcService } from '@cradle/ipc'
import { eq } from 'drizzle-orm'

import { getDb } from '../db'
import type { Agent } from '../db/schema'
import { agents } from '../db/schema'

// ── Input types ───────────────────────────────────────────────────────────────

export interface CreateAgentInput {
  name: string
  description?: string | null
  avatarStyle: string
  avatarSeed: string
  providerId: string
  modelId?: string | null
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto'
  configJson?: string
}

export interface UpdateAgentInput {
  name?: string
  description?: string | null
  avatarStyle?: string
  avatarSeed?: string
  avatarUrl?: string | null
  providerId?: string
  modelId?: string | null
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto'
  configJson?: string
  enabled?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildAvatarUrl(style: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`
}

// ── Service ───────────────────────────────────────────────────────────────────

export class AgentService extends IpcService {
  static readonly groupName = 'agent'

  @IpcMethod()
  list(): Agent[] {
    return getDb().select().from(agents).all()
  }

  @IpcMethod()
  get(id: string): Agent | undefined {
    return getDb().select().from(agents).where(eq(agents.id, id)).get()
  }

  @IpcMethod()
  create(input: CreateAgentInput): Agent {
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const avatarUrl = buildAvatarUrl(input.avatarStyle, input.avatarSeed)

    getDb()
      .insert(agents)
      .values({
        id,
        name: input.name,
        description: input.description ?? null,
        avatarUrl,
        avatarStyle: input.avatarStyle,
        avatarSeed: input.avatarSeed,
        providerId: input.providerId,
        modelId: input.modelId ?? null,
        thinkingEffort: input.thinkingEffort ?? 'auto',
        configJson: input.configJson ?? '{}',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    return this.get(id)!
  }

  @IpcMethod()
  update(id: string, patch: UpdateAgentInput): Agent {
    const existing = this.get(id)
    if (!existing) {
      throw new Error(`Agent not found: ${id}`)
    }

    const now = Math.floor(Date.now() / 1000)

    // Recompute avatar URL if style or seed changed
    const newStyle = patch.avatarStyle ?? existing.avatarStyle
    const newSeed = patch.avatarSeed ?? existing.avatarSeed
    const avatarUrl = (patch.avatarStyle !== undefined || patch.avatarSeed !== undefined)
      ? buildAvatarUrl(newStyle, newSeed)
      : existing.avatarUrl

    const set: Record<string, unknown> = { updatedAt: now }
    if (patch.name !== undefined) {
      set.name = patch.name
    }
    if (patch.description !== undefined) {
      set.description = patch.description
    }
    if (patch.avatarStyle !== undefined) {
      set.avatarStyle = patch.avatarStyle
    }
    if (patch.avatarSeed !== undefined) {
      set.avatarSeed = patch.avatarSeed
    }
    if (avatarUrl !== existing.avatarUrl) {
      set.avatarUrl = avatarUrl
    }
    if (patch.providerId !== undefined) {
      set.providerId = patch.providerId
    }
    if (patch.modelId !== undefined) {
      set.modelId = patch.modelId
    }
    if (patch.thinkingEffort !== undefined) {
      set.thinkingEffort = patch.thinkingEffort
    }
    if (patch.configJson !== undefined) {
      set.configJson = patch.configJson
    }
    if (patch.enabled !== undefined) {
      set.enabled = patch.enabled
    }

    getDb()
      .update(agents)
      .set(set)
      .where(eq(agents.id, id))
      .run()

    return this.get(id)!
  }

  @IpcMethod()
  remove(id: string): void {
    getDb().delete(agents).where(eq(agents.id, id)).run()
  }
}
