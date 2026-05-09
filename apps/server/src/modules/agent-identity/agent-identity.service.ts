// Input: AgentIdentityStore
// Output: agent identity module semantics
// Position: apps/server/src/modules/agent-identity/agent-identity.service.ts

import type { Agent } from '@cradle/db'
import { injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { AgentIdentityStore, type AgentListFilters, type CreateAgentRecord, type UpdateAgentRecord } from './agent-identity.store'

export interface CreateAgentInput {
  name: string
  description?: string | null
  avatarStyle: string
  avatarSeed: string
  agentProfileId: string
  modelId?: string | null
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto'
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
  configJson?: string
  enabled?: boolean
}

@injectable()
export class AgentIdentityService {
  constructor(private readonly store: AgentIdentityStore) {}

  list(filters: AgentListFilters = {}): Agent[] {
    return this.store.list(filters)
  }

  get(id: string): Agent | null {
    return this.store.get(id) ?? null
  }

  create(input: CreateAgentInput): Agent {
    const record: CreateAgentRecord = {
      name: input.name,
      description: input.description ?? null,
      avatarUrl: buildAvatarUrl(input.avatarStyle, input.avatarSeed),
      avatarStyle: input.avatarStyle,
      avatarSeed: input.avatarSeed,
      agentProfileId: input.agentProfileId,
      modelId: input.modelId ?? null,
      thinkingEffort: input.thinkingEffort ?? 'auto',
      configJson: input.configJson ?? '{}',
    }

    try {
      return this.store.create(record)
    }
    catch (error) {
      throw mapAgentIdentityError(error, input.agentProfileId)
    }
  }

  update(id: string, patch: UpdateAgentInput): Agent | null {
    const current = this.store.get(id)
    if (!current) {
      return null
    }

    const nextStyle = patch.avatarStyle ?? current.avatarStyle
    const nextSeed = patch.avatarSeed ?? current.avatarSeed

    const updatePatch: UpdateAgentRecord = {}
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
      return this.store.update(id, updatePatch) ?? null
    }
    catch (error) {
      throw mapAgentIdentityError(error, patch.agentProfileId ?? current.agentProfileId)
    }
  }

  delete(id: string): void {
    this.store.delete(id)
  }
}

function buildAvatarUrl(style: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`
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
