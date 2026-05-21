import type { AgentProfile } from '@cradle/db'
import {
  agentProfiles,
  agents,
  agentSessions,
  backendCapabilitySnapshots,
  runtimeAuditLog,
  usageLogs,
} from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { isExternalProfile } from '../external-provider-sources/profile-link-store'
import { deleteCachedModels } from '../providers/model-cache'
import type { ModelRegistryMappingEntry, ModelsDevModel } from '../providers/model-info-registry'
import { enrichModelsFromRegistry, lookupModelRawExact } from '../providers/model-info-registry'
import { serializeProfileConfigWithMapping } from '../providers/model-registry-mappings'
import type { ModelCapabilities, ProviderKind } from '../providers/types'
import * as Session from '../session/service'

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

// ── public API ──

const EXTERNAL_PROFILE_MODEL_CONFIG_KEYS = new Set(['enabledModels', 'modelRegistryMappings'])

function stableJson(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableJson(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

function parseProfileConfig(configJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(configJson) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

function removeCradleOwnedModelConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).filter(([key, value]) => !EXTERNAL_PROFILE_MODEL_CONFIG_KEYS.has(key) && value !== undefined),
  )
}

function mergeExternalProfileModelConfig(currentConfigJson: string, requestedConfigJson: string): string {
  const currentConfig = parseProfileConfig(currentConfigJson)
  const requestedConfig = parseProfileConfig(requestedConfigJson)
  const currentSourceConfig = removeCradleOwnedModelConfig(currentConfig)
  const requestedSourceConfig = removeCradleOwnedModelConfig(requestedConfig)

  if (stableJson(currentSourceConfig) !== stableJson(requestedSourceConfig)) {
    throw new AppError({
      code: 'profile_managed_by_external_source',
      status: 409,
      message: 'Profile is managed by an external provider source',
    })
  }

  const merged = { ...currentConfig }
  for (const key of EXTERNAL_PROFILE_MODEL_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(requestedConfig, key) && requestedConfig[key] !== undefined) {
      merged[key] = requestedConfig[key]
    }
    else {
      delete merged[key]
    }
  }

  return JSON.stringify(merged)
}

export function listProfiles(): AgentProfile[] {
  return db().select().from(agentProfiles).orderBy(agentProfiles.name).all()
}

export function getProfile(id: string): AgentProfile | null {
  return db().select().from(agentProfiles).where(eq(agentProfiles.id, id)).get() ?? null
}

function assertProfileEditable(profileId: string, next?: UpsertProfileInput): void {
  if (!isExternalProfile(profileId)) {
    return
  }

  if (!next) {
    throw new AppError({
      code: 'profile_managed_by_external_source',
      status: 409,
      message: 'Profile is managed by an external provider source',
      details: { profileId },
    })
  }

  const current = getProfile(profileId)
  if (!current) {
    throw new AppError({
      code: 'profile_not_found',
      status: 404,
      message: 'Profile not found',
      details: { profileId },
    })
  }

  const normalizedCurrentCredential = current.credentialRef ?? null
  const normalizedNextCredential = next.credentialRef ? String(next.credentialRef) : null
  const sameIcon = next.iconSlug === undefined || current.iconSlug === (next.iconSlug ?? null)
  const mergedConfigJson = mergeExternalProfileModelConfig(current.configJson, next.configJson)
  const isAllowedCradleOwnedChange = current.name === next.name
    && current.providerKind === next.providerKind
    && normalizedCurrentCredential === normalizedNextCredential
    && sameIcon

  if (isAllowedCradleOwnedChange) {
    next.configJson = mergedConfigJson
    return
  }

  throw new AppError({
    code: 'profile_managed_by_external_source',
    status: 409,
    message: 'Profile is managed by an external provider source',
    details: { profileId },
  })
}

function writeProfile(input: UpsertProfileInput, database = db()): AgentProfile {
  const now = Math.floor(Date.now() / 1000)
  const configJson = input.configJson
  database.insert(agentProfiles).values({
      id: input.id,
      name: input.name,
      providerKind: input.providerKind,
      enabled: input.enabled,
      configJson,
      credentialRef: input.credentialRef,
      iconSlug: input.iconSlug ?? null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: agentProfiles.id,
      set: {
        name: input.name,
        providerKind: input.providerKind,
        enabled: input.enabled,
        configJson,
        credentialRef: input.credentialRef,
        ...(input.iconSlug !== undefined ? { iconSlug: input.iconSlug } : {}),
        updatedAt: now,
      },
    }).run()

  return database.select().from(agentProfiles).where(eq(agentProfiles.id, input.id)).get()!
}

export function upsertProfile(input: UpsertProfileInput): AgentProfile {
  if (isExternalProfile(input.id)) {
    const current = getProfile(input.id)
    if (!current) {
      throw new AppError({
        code: 'profile_not_found',
        status: 404,
        message: 'Profile not found',
        details: { profileId: input.id },
      })
    }

    assertProfileEditable(input.id, input)
    return writeProfile({
      id: input.id,
      name: current.name,
      providerKind: current.providerKind,
      enabled: input.enabled,
      configJson: input.configJson,
      credentialRef: current.credentialRef,
      iconSlug: current.iconSlug,
    })
  }

  assertProfileEditable(input.id, input)
  return writeProfile(input)
}

export function upsertMirroredProfile(input: UpsertProfileInput, database = db()): AgentProfile {
  return writeProfile(input, database)
}

export function updateIcon(profileId: string, iconSlug: string | null): AgentProfile {
  assertProfileEditable(profileId)
  const now = Math.floor(Date.now() / 1000)
  db().update(agentProfiles).set({ iconSlug, updatedAt: now }).where(eq(agentProfiles.id, profileId)).run()
  return db().select().from(agentProfiles).where(eq(agentProfiles.id, profileId)).get()!
}

export function removeProfile(id: string): void {
  assertProfileEditable(id)
  const d = db()
  d.transaction((tx) => {
    Session.deleteByAgentProfileInDb(id, tx)
    tx.delete(agents).where(eq(agents.agentProfileId, id)).run()
    tx.delete(agentSessions).where(eq(agentSessions.agentProfileId, id)).run()
    tx.delete(backendCapabilitySnapshots).where(eq(backendCapabilitySnapshots.agentProfileId, id)).run()
    tx.delete(runtimeAuditLog).where(eq(runtimeAuditLog.agentProfileId, id)).run()
    tx.delete(usageLogs).where(eq(usageLogs.agentProfileId, id)).run()
    tx.delete(agentProfiles).where(eq(agentProfiles.id, id)).run()
  })
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
  if (!getProfile(profileId)) {
    throw new AppError({
      code: 'profile_not_found',
      status: 404,
      message: 'Profile not found',
      details: { profileId },
    })
  }
  // Build descriptors for enrichment
  const descriptors = models.map(m => ({
    id: m.id,
    label: m.label ?? m.id,
    providerKind: 'openai-compatible' as const,
    capabilities: m.capabilities ?? {},
  }))

  // Only enrich entries that don't already have contextWindow
  const needsEnrich = descriptors.filter(d => d.capabilities.contextWindow == null)
  const enriched = needsEnrich.length > 0 ? await enrichModelsFromRegistry(needsEnrich) : []
  const enrichedMap = new Map(enriched.map(e => [e.id, e]))

  const entries: CustomModelEntry[] = descriptors.map((m) => {
    if (m.capabilities.contextWindow != null) {
      return { id: m.id, label: m.label, capabilities: m.capabilities }
    }
    const enrichedEntry = enrichedMap.get(m.id)
    return {
      id: m.id,
      label: enrichedEntry?.label ?? m.label,
      capabilities: enrichedEntry?.capabilities ?? m.capabilities,
    }
  })

  db().update(agentProfiles).set({
      customModels: JSON.stringify(entries),
      updatedAt: Math.floor(Date.now() / 1000),
    }).where(eq(agentProfiles.id, profileId)).run()

  return entries
}

// ── available model registry mappings ──

export async function updateModelRegistryMapping(
  profileId: string,
  input: { modelId: string, registryModelId?: string, model?: ModelsDevModel },
): Promise<ModelRegistryMappingEntry[]> {
  const profile = getProfile(profileId)
  if (!profile) {
    return []
  }

  const registryModelId = input.registryModelId?.trim() || input.model?.id
  if (!registryModelId) {
    return []
  }

  const registryModel = input.model ?? await lookupModelRawExact(registryModelId)
  const mapping: ModelRegistryMappingEntry = {
    modelId: input.modelId,
    registryModelId,
    ...(registryModel === null ? {} : { model: registryModel }),
    updatedAt: Math.floor(Date.now() / 1000),
  }
  const next = serializeProfileConfigWithMapping(profile.configJson, mapping)

  db().update(agentProfiles).set({
      configJson: next.configJson,
      updatedAt: Math.floor(Date.now() / 1000),
    }).where(eq(agentProfiles.id, profileId)).run()
  deleteCachedModels(profileId)

  return next.mappings
}
