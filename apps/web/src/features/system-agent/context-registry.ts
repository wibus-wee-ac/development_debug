// Output: Provider registry and envelope collector for Jarvis semantic context.
// Input: Feature-owned context providers that expose current attention and references.
// Position: Owned by system-agent as the aggregation layer, without reading feature DOM directly.

import { useCradleTabStore } from '~/tabs/registry'

import type { ContextEnvelope, ContextItem } from './context-items'

export interface ContextProviderInput {
  activeTabId: string | null
  activeTabType: string | null
  activeTabParams: Record<string, string | undefined>
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
  readActiveTab?: () => { id: string | null, type: string | null, params?: Record<string, string | undefined> }
  createEnvelopeId?: (now: number) => string
  readNow?: () => number
}

function defaultEnvelopeId(now: number): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
  return `ctx-${now}-${random}`
}

function readCradleActiveTab(): { id: string | null, type: string | null, params: Record<string, string | undefined> } {
  const tabState = useCradleTabStore.getState()
  const activeTab = tabState.activeTabId
    ? tabState.tabs.find(tab => tab.id === tabState.activeTabId) ?? null
    : null

  return {
    id: activeTab?.id ?? null,
    type: activeTab?.type ?? null,
    params: activeTab?.params ?? {},
  }
}

export function createContextRegistry(options: ContextRegistryOptions = {}): ContextRegistry {
  const providers = new Map<string, ContextProvider>()
  const readActiveTab = options.readActiveTab ?? readCradleActiveTab
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
      const activeTab = readActiveTab()
      const input: ContextProviderInput = {
        activeTabId: activeTab.id,
        activeTabType: activeTab.type,
        activeTabParams: activeTab.params ?? {},
        now,
      }
      const items = [...providers.values()].flatMap(provider => provider.readContext(input))

      return {
        id: createEnvelopeId(now),
        capturedAt: now,
        activeTabId: activeTab.id,
        activeTabType: activeTab.type,
        activeTabParams: activeTab.params ?? {},
        items,
      }
    },
  }
}

export const jarvisContextRegistry = createContextRegistry()
