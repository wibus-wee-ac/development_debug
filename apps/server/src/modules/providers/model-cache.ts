import { providerModelCache } from '@cradle/db'
import { eq, lt } from 'drizzle-orm'

import { db } from '../../infra'
import type { ModelDescriptor } from './types'

const STALE_THRESHOLD_S = 60 * 60 * 24 // 24 hours

export interface CachedModelsResult {
  models: ModelDescriptor[]
  fetchedAt: number
  cached: boolean
}

export function getCachedModels(profileId: string): CachedModelsResult | null {
  const row = db().select().from(providerModelCache).where(eq(providerModelCache.profileId, profileId)).get()
  if (!row) {
    return null
  }
  try {
    const models = JSON.parse(row.modelsJson) as ModelDescriptor[]
    return { models, fetchedAt: row.fetchedAt, cached: true }
  }
  catch {
    return null
  }
}

export function setCachedModels(profileId: string, models: ModelDescriptor[]): void {
  const now = Math.floor(Date.now() / 1000)
  db().insert(providerModelCache).values({
    profileId,
    modelsJson: JSON.stringify(models),
    fetchedAt: now,
  }).onConflictDoUpdate({
    target: providerModelCache.profileId,
    set: {
      modelsJson: JSON.stringify(models),
      fetchedAt: now,
    },
  }).run()
}

export function deleteCachedModels(profileId: string): void {
  db().delete(providerModelCache).where(eq(providerModelCache.profileId, profileId)).run()
}

export function isCacheStale(fetchedAt: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  return (now - fetchedAt) > STALE_THRESHOLD_S
}

export function getStaleProfileIds(): string[] {
  const threshold = Math.floor(Date.now() / 1000) - STALE_THRESHOLD_S
  const rows = db().select({ profileId: providerModelCache.profileId }).from(providerModelCache).where(lt(providerModelCache.fetchedAt, threshold)).all()
  return rows.map(r => r.profileId)
}
