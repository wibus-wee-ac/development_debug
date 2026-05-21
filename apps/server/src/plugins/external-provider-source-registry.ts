import { createHash } from 'node:crypto'

import type { Disposable } from '@cradle/plugin-sdk'
import type { ExternalProviderSource } from '@cradle/plugin-sdk/server'

export interface RegisteredExternalProviderSource {
  key: string
  owner: string
  source: ExternalProviderSource
  registeredAt: number
}

const sources = new Map<string, RegisteredExternalProviderSource>()

function sourceKey(owner: string, sourceId: string): string {
  const hash = createHash('sha256').update(`${owner}\0${sourceId}`).digest('hex').slice(0, 24)
  return `external_source_${hash}`
}

export function registerExternalProviderSource(owner: string, source: ExternalProviderSource): Disposable {
  const id = source.id.trim()
  if (!id) {
    throw new Error('External provider source id is required')
  }
  if (!source.label.trim()) {
    throw new Error(`External provider source ${id} label is required`)
  }

  const key = sourceKey(owner, id)
  if (sources.has(key)) {
    throw new Error(`External provider source already registered: ${owner}:${id}`)
  }

  sources.set(key, {
    key,
    owner,
    source: { ...source, id },
    registeredAt: Math.floor(Date.now() / 1000),
  })

  return {
    dispose() {
      sources.delete(key)
    },
  }
}

export function listExternalProviderSources(): RegisteredExternalProviderSource[] {
  return Array.from(sources.values()).sort((a, b) => a.source.label.localeCompare(b.source.label))
}

export function getExternalProviderSource(sourceKey: string): RegisteredExternalProviderSource | null {
  return sources.get(sourceKey) ?? null
}

export function resetExternalProviderSourceRegistry(): void {
  sources.clear()
}
