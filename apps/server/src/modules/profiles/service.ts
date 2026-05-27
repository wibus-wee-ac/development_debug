import type { AgentProfile, ProviderTarget } from '@cradle/db'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import * as ProviderTargets from '../provider-targets/service'
import type { ModelCapabilities, ProviderKind } from '../providers/types'

// ── types ──

export interface UpsertProfileInput {
  id: string
  name: string
  providerKind: ProviderKind
  enabled: boolean
  configJson: string
  credentialRef: string | null
  iconSlug?: string | null
}

function toProfile(target: ProviderTarget): AgentProfile {
  return {
    id: target.id,
    name: target.displayName,
    providerKind: target.providerKind,
    enabled: target.enabled,
    configJson: target.connectionConfigJson,
    credentialRef: target.credentialRef,
    customModels: target.customModelsJson,
    iconSlug: target.iconSlug,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  }
}

// ── public API ──

const ModelCapabilitiesSchema = z.object({
  contextWindow: z.number().optional(),
  maxOutput: z.number().optional(),
  inputModalities: z.array(z.string()).optional(),
  outputModalities: z.array(z.string()).optional(),
  reasoning: z.boolean().optional(),
  toolCall: z.boolean().optional(),
  temperature: z.boolean().optional(),
  structuredOutput: z.boolean().optional(),
  cost: z.object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
  }).optional(),
  family: z.string().optional(),
  knowledgeCutoff: z.string().optional(),
  releaseDate: z.string().optional(),
  registryMatch: z.enum(['exact', 'fuzzy', 'manual', 'alias', 'unmatched']).optional(),
  registryModelId: z.string().optional(),
  registryModelLabel: z.string().optional(),
})

const CustomModelInputSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  capabilities: ModelCapabilitiesSchema.default({}),
})

export function listProfiles(): AgentProfile[] {
  return ProviderTargets.listProviderTargets()
    .filter(target => target.kind === 'manual')
    .toSorted((a, b) => a.displayName.localeCompare(b.displayName))
    .map(toProfile)
}

export function getProfile(id: string): AgentProfile | null {
  const target = ProviderTargets.getProviderTarget(id)
  return target?.kind === 'manual' ? toProfile(target) : null
}

function assertProfileEditable(profileId: string, next?: UpsertProfileInput): void {
  const existing = getProfile(profileId)
  if (!existing) {
    return
  }

  if (!next) {
    return
  }

  if (existing.providerKind !== next.providerKind) {
    throw new AppError({
      code: 'invalid_profile_input',
      status: 400,
      message: 'Provider kind cannot be changed for an existing profile',
      details: { profileId, providerKind: next.providerKind },
    })
  }
}

export function upsertProfile(input: UpsertProfileInput): AgentProfile {
  assertProfileEditable(input.id, input)
  return toProfile(ProviderTargets.upsertManualProviderTarget({
    id: input.id,
    displayName: input.name,
    providerKind: input.providerKind,
    enabled: input.enabled,
    connectionConfigJson: input.configJson,
    credentialRef: input.credentialRef,
    iconSlug: input.iconSlug,
  }))
}

export function updateIcon(profileId: string, iconSlug: string | null): AgentProfile {
  assertProfileEditable(profileId)
  return toProfile(ProviderTargets.updateProviderTargetIcon(profileId, iconSlug))
}

export function removeProfile(id: string): void {
  assertProfileEditable(id)
  ProviderTargets.removeProviderTarget(id)
}

// ── custom models ──

export interface CustomModelEntry {
  id: string
  label: string
  capabilities: ModelCapabilities
}

export async function updateCustomModels(
  profileId: string,
  models: Array<{ id: string, label?: string, capabilities?: ModelCapabilities }>,
): Promise<CustomModelEntry[]> {
  const parsedModels = z.array(CustomModelInputSchema).parse(models)
  if (!getProfile(profileId)) {
    throw new AppError({
      code: 'profile_not_found',
      status: 404,
      message: 'Profile not found',
      details: { profileId },
    })
  }
  return ProviderTargets.updateProviderTargetCustomModels(profileId, parsedModels)
}
