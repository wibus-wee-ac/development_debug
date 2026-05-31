// Output: Provider model cache persistence helpers.
// Input: Provider catalog model descriptors and provider target cache keys.
// Position: Provider-catalog owns cached provider model inventory rows.

import { providerModelCache, providerTargetModelCache } from '@cradle/db'
import { eq, lt } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../infra'
import type { ProviderTarget } from '../provider-targets/service'
import { providerTargetCacheId } from '../provider-targets/service'
import { projectProviderModelListCapabilities } from './model-capabilities'
import type { ModelDescriptor } from '../provider-contracts/types'

const STALE_THRESHOLD_S = 60 * 60 * 24 // 24 hours

export interface CachedModelsResult {
  models: ModelDescriptor[]
  fetchedAt: number
  cached: boolean
}

const ModelCapabilitiesSchema = z.object({
  contextWindow: z.number().finite().optional(),
  maxOutput: z.number().finite().optional(),
  inputModalities: z.array(z.string()).optional(),
  outputModalities: z.array(z.string()).optional(),
  reasoning: z.boolean().optional(),
  toolCall: z.boolean().optional(),
  temperature: z.boolean().optional(),
  structuredOutput: z.boolean().optional(),
  cost: z.object({
    input: z.number().finite().optional(),
    output: z.number().finite().optional(),
    cacheRead: z.number().finite().optional(),
    cacheWrite: z.number().finite().optional(),
  }).optional(),
  family: z.string().optional(),
  knowledgeCutoff: z.string().optional(),
  releaseDate: z.string().optional(),
  registryMatch: z.enum(['exact', 'fuzzy', 'manual', 'alias', 'unmatched']).optional(),
  registryModelId: z.string().optional(),
  registryModelLabel: z.string().optional(),
})

const ModelDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerKind: z.enum(['openai-compatible', 'anthropic']),
  capabilities: ModelCapabilitiesSchema,
})

const CachedModelsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(ModelDescriptorSchema))

export function getCachedModels(profileId: string): CachedModelsResult | null {
  const row = db().select().from(providerModelCache).where(eq(providerModelCache.providerTargetId, profileId)).get()
  if (!row) {
    return null
  }
  const models = projectProviderModelListCapabilities(CachedModelsJsonSchema.parse(row.modelsJson))
  return { models, fetchedAt: row.fetchedAt, cached: true }
}

export function getCachedModelsForTarget(target: ProviderTarget): CachedModelsResult | null {
  const row = db()
    .select()
    .from(providerTargetModelCache)
    .where(eq(providerTargetModelCache.providerTargetId, providerTargetCacheId(target)))
    .get()
  if (!row) {
    return getCachedModels(providerTargetCacheId(target))
  }
  const models = projectProviderModelListCapabilities(CachedModelsJsonSchema.parse(row.modelsJson))
  return { models, fetchedAt: row.fetchedAt, cached: true }
}

export function setCachedModels(profileId: string, models: ModelDescriptor[]): void {
  const now = Math.floor(Date.now() / 1000)
  const projectedModels = projectProviderModelListCapabilities(models)
  db().insert(providerModelCache).values({
    providerTargetId: profileId,
    modelsJson: JSON.stringify(projectedModels),
    fetchedAt: now,
  }).onConflictDoUpdate({
    target: providerModelCache.providerTargetId,
    set: {
      modelsJson: JSON.stringify(projectedModels),
      fetchedAt: now,
    },
  }).run()
}

export function setCachedModelsForTarget(target: ProviderTarget, models: ModelDescriptor[]): void {
  const now = Math.floor(Date.now() / 1000)
  const projectedModels = projectProviderModelListCapabilities(models)
  db().insert(providerTargetModelCache).values({
    providerTargetId: providerTargetCacheId(target),
    modelsJson: JSON.stringify(projectedModels),
    fetchedAt: now,
  }).onConflictDoUpdate({
    target: providerTargetModelCache.providerTargetId,
    set: {
      modelsJson: JSON.stringify(projectedModels),
      fetchedAt: now,
    },
  }).run()
}

export function deleteCachedModels(profileId: string): void {
  db().delete(providerModelCache).where(eq(providerModelCache.providerTargetId, profileId)).run()
}

export function deleteCachedModelsForTarget(target: ProviderTarget): void {
  db().delete(providerTargetModelCache).where(eq(providerTargetModelCache.providerTargetId, providerTargetCacheId(target))).run()
}

export function isCacheStale(fetchedAt: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  return (now - fetchedAt) > STALE_THRESHOLD_S
}

export function getStaleProfileIds(): string[] {
  const threshold = Math.floor(Date.now() / 1000) - STALE_THRESHOLD_S
  const rows = db().select({ profileId: providerModelCache.providerTargetId }).from(providerModelCache).where(lt(providerModelCache.fetchedAt, threshold)).all()
  return rows.map(r => r.profileId)
}
