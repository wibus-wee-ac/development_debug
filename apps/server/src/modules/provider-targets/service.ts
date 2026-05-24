import { randomUUID } from 'node:crypto'

import {
  agentSessions,
  agents,
  backendCapabilitySnapshots,
  backendSessionBindings,
  externalProviderRecords,
  providerModelCache,
  providerTargetModelCache,
  providerTargets,
  runtimeAuditLog,
  usageLogs
} from '@cradle/db'
import type { ProviderTarget as ProviderTargetRow } from '@cradle/db'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import type { ModelRegistryMappingEntry, ModelsDevModel } from '../providers/model-info-registry'
import { enrichModelsFromRegistry, lookupModelRawExact } from '../providers/model-info-registry'
import {
  ModelRegistryMappingsJsonSchema,
  serializeModelRegistryMappings
} from '../providers/model-registry-mappings'
import { runtimeSupportsProviderKind } from '../providers/runtime-compatibility'
import type { ModelCapabilities, ProviderKind, RuntimeKind } from '../providers/types'
import * as Session from '../session/service'

const ProviderTargetRefSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(['manual', 'external']).optional()
})

export type ProviderTarget = z.infer<typeof ProviderTargetRefSchema>

export interface UpsertManualProviderTargetInput {
  id?: string
  displayName: string
  providerKind: ProviderKind
  enabled?: boolean
  connectionConfigJson: string
  credentialRef?: string | null
  iconSlug?: string | null
}

export interface ResolvedProviderTarget {
  target: {
    id: string
    kind: 'manual' | 'external'
  }
  id: string
  kind: 'manual' | 'external'
  label: string
  providerKind: ProviderKind
  enabled: boolean
  connectionConfigJson: string
  configJson: string
  credentialRef: string | null
  enabledModelsJson: string
  customModelsJson: string
  modelRegistryMappingsJson: string
  iconSlug: string | null
  sourceMetadata: {
    sourceKey: string
    externalRecordId: string
    app: string
  } | null
}

export interface ProviderTargetModelSettings {
  providerTargetId: string
  configJson: string
  connectionConfigJson: string
  enabledModelsJson: string
  customModelsJson: string
  modelRegistryMappingsJson: string
  providerTargetKind?: 'manual' | 'external'
}

export interface CustomModelEntry {
  id: string
  label: string
  capabilities: ModelCapabilities
}

const JsonObjectTextSchema = z
  .string()
  .transform((raw) => JSON.parse(raw))
  .pipe(z.record(z.string(), z.unknown()).default({}))

const EnabledModelsJsonSchema = z
  .string()
  .transform((raw) => JSON.parse(raw))
  .pipe(z.array(z.string().min(1)).default([]))

const ModelCapabilitiesSchema = z.object({
  contextWindow: z.number().optional(),
  maxOutput: z.number().optional(),
  inputModalities: z.array(z.string()).optional(),
  outputModalities: z.array(z.string()).optional(),
  reasoning: z.boolean().optional(),
  toolCall: z.boolean().optional(),
  temperature: z.boolean().optional(),
  structuredOutput: z.boolean().optional(),
  cost: z
    .object({
      input: z.number().optional(),
      output: z.number().optional(),
      cacheRead: z.number().optional(),
      cacheWrite: z.number().optional()
    })
    .optional(),
  family: z.string().optional(),
  knowledgeCutoff: z.string().optional(),
  releaseDate: z.string().optional(),
  registryMatch: z.enum(['exact', 'fuzzy', 'manual', 'unmatched']).optional(),
  registryModelId: z.string().optional(),
  registryModelLabel: z.string().optional()
})

const CustomModelInputSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().optional(),
  capabilities: ModelCapabilitiesSchema.default({})
})

const ModelRegistryMappingInputSchema = z.object({
  modelId: z.string().trim().min(1),
  registryModelId: z.string().trim().min(1).optional(),
  model: z.custom<ModelsDevModel>().optional()
})

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

function parseTargetId(input: ProviderTarget | string): string {
  if (typeof input === 'string') {
    return z.string().trim().min(1).parse(input)
  }
  return ProviderTargetRefSchema.parse(input).id
}

function mergeConnectionConfigWithEnabledModels(
  connectionConfigJson: string,
  enabledModelsJson: string
): string {
  const config = JsonObjectTextSchema.parse(connectionConfigJson)
  const enabledModels = EnabledModelsJsonSchema.parse(enabledModelsJson)
  return JSON.stringify({
    ...config,
    enabledModels
  })
}

function toResolvedProviderTarget(row: ProviderTargetRow): ResolvedProviderTarget {
  const sourceMetadata =
    row.kind === 'external' && row.sourceKey && row.externalRecordId
      ? (() => {
          const record = db()
            .select()
            .from(externalProviderRecords)
            .where(
              and(
                eq(externalProviderRecords.sourceKey, row.sourceKey),
                eq(externalProviderRecords.externalId, row.externalRecordId)
              )
            )
            .get()
          return {
            sourceKey: row.sourceKey,
            externalRecordId: row.externalRecordId,
            app: record?.app ?? 'external'
          }
        })()
      : null

  return {
    target: {
      id: row.id,
      kind: row.kind
    },
    id: row.id,
    kind: row.kind,
    label: row.displayName,
    providerKind: row.providerKind,
    enabled: row.enabled,
    connectionConfigJson: row.connectionConfigJson,
    configJson: mergeConnectionConfigWithEnabledModels(
      row.connectionConfigJson,
      row.enabledModelsJson
    ),
    credentialRef: row.credentialRef ?? null,
    enabledModelsJson: row.enabledModelsJson,
    customModelsJson: row.customModelsJson,
    modelRegistryMappingsJson: row.modelRegistryMappingsJson,
    iconSlug: row.iconSlug ?? null,
    sourceMetadata
  }
}

export function providerTargetFromLegacyProfileId(
  profileId: string | null | undefined
): ProviderTarget | null {
  if (!profileId) {
    return null
  }
  return { id: profileId, kind: 'manual' }
}

export function providerTargetCacheId(target: ProviderTarget | string): string {
  return parseTargetId(target)
}

export function listProviderTargets(): ProviderTargetRow[] {
  return db().select().from(providerTargets).all()
}

export function getProviderTarget(id: string): ProviderTargetRow | null {
  return db().select().from(providerTargets).where(eq(providerTargets.id, id)).get() ?? null
}

export function resolveProviderTarget(input: ProviderTarget | string): ResolvedProviderTarget {
  const id = parseTargetId(input)
  const row = getProviderTarget(id)
  if (!row) {
    throw new AppError({
      code: 'provider_target_not_found',
      status: 404,
      message: 'Provider target not found',
      details: { providerTargetId: id }
    })
  }
  return toResolvedProviderTarget(row)
}

export function upsertManualProviderTarget(
  input: UpsertManualProviderTargetInput
): ProviderTargetRow {
  const id = input.id?.trim() || randomUUID()
  const now = nowUnix()
  const existing = getProviderTarget(id)
  if (existing && existing.kind !== 'manual') {
    throw new AppError({
      code: 'invalid_provider_target',
      status: 400,
      message: 'External provider targets cannot be overwritten as manual targets',
      details: { providerTargetId: id }
    })
  }

  db()
    .insert(providerTargets)
    .values({
      id,
      kind: 'manual',
      providerKind: input.providerKind,
      displayName: input.displayName,
      enabled: input.enabled ?? true,
      connectionConfigJson: input.connectionConfigJson,
      credentialRef: input.credentialRef ?? null,
      iconSlug: input.iconSlug ?? null,
      enabledModelsJson: existing?.enabledModelsJson ?? '[]',
      customModelsJson: existing?.customModelsJson ?? '[]',
      modelRegistryMappingsJson: existing?.modelRegistryMappingsJson ?? '[]',
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: providerTargets.id,
      set: {
        providerKind: input.providerKind,
        displayName: input.displayName,
        enabled: input.enabled ?? existing?.enabled ?? true,
        connectionConfigJson: input.connectionConfigJson,
        credentialRef: input.credentialRef ?? null,
        ...(input.iconSlug !== undefined ? { iconSlug: input.iconSlug } : {}),
        updatedAt: now
      }
    })
    .run()

  return getProviderTarget(id)!
}

export function updateProviderTargetIcon(
  providerTargetId: string,
  iconSlug: string | null
): ProviderTargetRow {
  const target = resolveProviderTarget(providerTargetId)
  db()
    .update(providerTargets)
    .set({ iconSlug, updatedAt: nowUnix() })
    .where(eq(providerTargets.id, target.id))
    .run()
  return getProviderTarget(target.id)!
}

export function updateProviderTargetEnabled(
  providerTargetId: string,
  enabled: boolean
): ProviderTargetRow {
  const target = resolveProviderTarget(providerTargetId)
  db()
    .update(providerTargets)
    .set({ enabled, updatedAt: nowUnix() })
    .where(eq(providerTargets.id, target.id))
    .run()
  return getProviderTarget(target.id)!
}

export function removeProviderTarget(providerTargetId: string): void {
  const target = resolveProviderTarget(providerTargetId)
  const d = db()
  d.transaction((tx) => {
    const ownedAgentIds = tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.providerTargetId, target.id))
      .all()
      .map(row => row.id)

    Session.deleteByProviderTargetInDb(target.id, tx)
    Session.deleteByAgentIdsInDb(ownedAgentIds, tx)

    tx.delete(backendSessionBindings).where(eq(backendSessionBindings.providerTargetId, target.id)).run()
    tx.delete(backendCapabilitySnapshots).where(eq(backendCapabilitySnapshots.providerTargetId, target.id)).run()
    tx.delete(runtimeAuditLog).where(eq(runtimeAuditLog.providerTargetId, target.id)).run()
    tx.delete(usageLogs).where(eq(usageLogs.providerTargetId, target.id)).run()
    tx.delete(providerModelCache).where(eq(providerModelCache.providerTargetId, target.id)).run()
    tx.delete(providerTargetModelCache).where(eq(providerTargetModelCache.providerTargetId, target.id)).run()
    tx.delete(agentSessions).where(eq(agentSessions.providerTargetId, target.id)).run()
    if (ownedAgentIds.length > 0) {
      tx.delete(agentSessions).where(inArray(agentSessions.agentId, ownedAgentIds)).run()
      tx.delete(agents).where(inArray(agents.id, ownedAgentIds)).run()
    }
    tx.delete(providerTargets).where(eq(providerTargets.id, target.id)).run()
  })
}

export function assertProviderTargetCompatibleWithRuntime(
  target: ProviderTarget | string,
  runtimeKind: RuntimeKind
): void {
  const resolved = resolveProviderTarget(target)
  if (!runtimeSupportsProviderKind(runtimeKind, resolved.providerKind)) {
    throw new AppError({
      code: 'invalid_provider_target',
      status: 400,
      message: 'Provider target is not compatible with the selected runtime',
      details: {
        providerTargetId: resolved.id,
        runtimeKind,
        providerKind: resolved.providerKind
      }
    })
  }
}

export function getProviderTargetModelSettings(
  input: ProviderTarget | string
): ProviderTargetModelSettings {
  const resolved = resolveProviderTarget(input)
  return {
    providerTargetId: resolved.id,
    providerTargetKind: resolved.kind,
    configJson: resolved.configJson,
    connectionConfigJson: resolved.connectionConfigJson,
    enabledModelsJson: resolved.enabledModelsJson,
    customModelsJson: resolved.customModelsJson,
    modelRegistryMappingsJson: resolved.modelRegistryMappingsJson
  }
}

export function updateProviderTargetModelVisibility(
  input: ProviderTarget | string,
  enabledModels: string[]
): ProviderTargetModelSettings {
  const providerTargetId = parseTargetId(input)
  resolveProviderTarget(providerTargetId)
  const enabledModelsJson = JSON.stringify(z.array(z.string().trim().min(1)).parse(enabledModels))
  db()
    .update(providerTargets)
    .set({
      enabledModelsJson,
      updatedAt: nowUnix()
    })
    .where(eq(providerTargets.id, providerTargetId))
    .run()

  return getProviderTargetModelSettings(providerTargetId)
}

export async function updateProviderTargetCustomModels(
  input: ProviderTarget | string,
  models: Array<{ id: string; label?: string; capabilities?: ModelCapabilities }>
): Promise<CustomModelEntry[]> {
  const providerTargetId = parseTargetId(input)
  const resolved = resolveProviderTarget(providerTargetId)
  const parsedModels = z.array(CustomModelInputSchema).parse(models)
  const descriptors = parsedModels.map((model) => ({
    id: model.id,
    label: model.label ?? model.id,
    providerKind: resolved.providerKind,
    capabilities: model.capabilities
  }))
  const modelsWithoutContext = descriptors.filter(
    (model) => model.capabilities.contextWindow == null
  )
  const enriched =
    modelsWithoutContext.length > 0 ? await enrichModelsFromRegistry(modelsWithoutContext) : []
  const enrichedById = new Map(enriched.map((model) => [model.id, model]))
  const entries: CustomModelEntry[] = descriptors.map((model) => {
    if (model.capabilities.contextWindow != null) {
      return { id: model.id, label: model.label, capabilities: model.capabilities }
    }
    const enrichedModel = enrichedById.get(model.id)
    return {
      id: model.id,
      label: enrichedModel?.label ?? model.label,
      capabilities: enrichedModel?.capabilities ?? model.capabilities
    }
  })

  db()
    .update(providerTargets)
    .set({
      customModelsJson: JSON.stringify(entries),
      updatedAt: nowUnix()
    })
    .where(eq(providerTargets.id, providerTargetId))
    .run()

  return entries
}

export async function updateProviderTargetModelRegistryMapping(
  input: ProviderTarget | string,
  rawInput: { modelId: string; registryModelId?: string; model?: ModelsDevModel }
): Promise<ModelRegistryMappingEntry[]> {
  const providerTargetId = parseTargetId(input)
  const resolved = resolveProviderTarget(providerTargetId)
  const parsedInput = ModelRegistryMappingInputSchema.parse(rawInput)
  const registryModelId = parsedInput.registryModelId?.trim() || parsedInput.model?.id
  if (!registryModelId) {
    return ModelRegistryMappingsJsonSchema.parse(resolved.modelRegistryMappingsJson)
  }

  const registryModel = parsedInput.model ?? (await lookupModelRawExact(registryModelId))
  const mapping: ModelRegistryMappingEntry = {
    modelId: parsedInput.modelId,
    registryModelId,
    ...(registryModel === null ? {} : { model: registryModel }),
    updatedAt: nowUnix()
  }
  const next = serializeModelRegistryMappings(resolved.modelRegistryMappingsJson, mapping)
  db()
    .update(providerTargets)
    .set({
      modelRegistryMappingsJson: next.mappingsJson,
      updatedAt: nowUnix()
    })
    .where(eq(providerTargets.id, providerTargetId))
    .run()
  return next.mappings
}
