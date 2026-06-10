import { useSurfaceStore } from '~/navigation/surface-store'

import type { ContextEnvelope, ContextItem } from './context-items'

export interface ContextProviderInput {
  activeSurfaceId: string | null
  activeSurfaceType: string | null
  activeSurfaceParams: Record<string, string | undefined>
  activeSurfaceSearch: Record<string, string | undefined>
  now: number
}

export interface ContextProvider {
  owner: string
  readContext: (input: ContextProviderInput) => ContextItem[]
}

export interface ContextRegistry {
  registerProvider: (provider: ContextProvider) => () => void
  collectEnvelope: () => ContextEnvelope
}

export interface ContextRegistryOptions {
  readActiveSurface?: () => {
    id: string | null
    type: string | null
    params?: Record<string, string | undefined>
    search?: Record<string, string | undefined>
  }
  createEnvelopeId?: (now: number) => string
  readNow?: () => number
}

function defaultEnvelopeId(now: number): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
  return `ctx-${now}-${random}`
}

function surfaceKindToContextType(kind: string): string {
  if (kind === 'workspace') {
    return 'workspace-detail'
  }
  if (kind === 'kanban') {
    return 'kanban-board'
  }
  if (kind === 'plugin') {
    return 'plugin-panel'
  }
  return kind
}

function readCradleActiveSurface(): {
  id: string | null
  type: string | null
  params: Record<string, string | undefined>
  search: Record<string, string | undefined>
} {
  const surfaceState = useSurfaceStore.getState()
  const activeSurface = surfaceState.activeSurfaceId
    ? surfaceState.surfaces.find(surface => surface.id === surfaceState.activeSurfaceId) ?? null
    : null

  return {
    id: activeSurface?.id ?? null,
    type: activeSurface ? surfaceKindToContextType(activeSurface.kind) : null,
    params: activeSurface?.route.params ?? {},
    search: activeSurface?.route.search ?? {},
  }
}

export function createContextRegistry(options: ContextRegistryOptions = {}): ContextRegistry {
  const providers = new Map<string, ContextProvider>()
  const readActiveSurface = options.readActiveSurface ?? readCradleActiveSurface
  const readNow = options.readNow ?? Date.now
  const createEnvelopeId = options.createEnvelopeId ?? defaultEnvelopeId

  return {
    registerProvider(provider) {
      if (providers.has(provider.owner)) {
        throw new Error(`Context provider already registered: ${provider.owner}`)
      }

      providers.set(provider.owner, provider)
      return () => {
        providers.delete(provider.owner)
      }
    },

    collectEnvelope() {
      const now = readNow()
      const activeSurface = readActiveSurface()
      const input: ContextProviderInput = {
        activeSurfaceId: activeSurface.id,
        activeSurfaceType: activeSurface.type,
        activeSurfaceParams: activeSurface.params ?? {},
        activeSurfaceSearch: activeSurface.search ?? {},
        now,
      }
      const items = [...providers.values()].flatMap(provider => provider.readContext(input))

      return {
        id: createEnvelopeId(now),
        capturedAt: now,
        activeSurfaceId: activeSurface.id,
        activeSurfaceType: activeSurface.type,
        activeSurfaceParams: activeSurface.params ?? {},
        activeSurfaceSearch: activeSurface.search ?? {},
        items,
      }
    },
  }
}

export const jarvisContextRegistry = createContextRegistry()
