/* UI state store for the Nowledge Mem panel. Uses a tiny external store
   (no zustand dependency — keeps plugin bundle small) backed by React's
   useSyncExternalStore. Persisted keys go through ctx.storage so the active
   tab survives reloads. */

import { useSyncExternalStore } from 'react'

import type { WebPluginContext } from '@cradle/plugin-sdk/web'

export type NowledgeTab = 'today' | 'memories' | 'threads' | 'config'

export interface NowledgeUiState {
  activeTab: NowledgeTab
  selectedMemoryId: string | null
  selectedThreadId: string | null
  memoriesQuery: string
  memoriesMode: 'fast' | 'deep'
  threadsQuery: string
  threadsSource: string
}

const DEFAULT_STATE: NowledgeUiState = {
  activeTab: 'today',
  selectedMemoryId: null,
  selectedThreadId: null,
  memoriesQuery: '',
  memoriesMode: 'fast',
  threadsQuery: '',
  threadsSource: '',
}

const STORAGE_KEY = 'ui.v1'

type Listener = () => void
let state: NowledgeUiState = { ...DEFAULT_STATE }
const listeners = new Set<Listener>()
let storage: WebPluginContext['storage'] | null = null

function emit(): void {
  for (const listener of listeners) { listener() }
}

function persist(): void {
  if (!storage) { return }
  try {
    storage.set(STORAGE_KEY, JSON.stringify({
      activeTab: state.activeTab,
      memoriesMode: state.memoriesMode,
      threadsSource: state.threadsSource,
    }))
  }
  catch {
    /* swallow — UI state is best-effort */
  }
}

export function initNowledgeUiStore(ctxStorage: WebPluginContext['storage']): void {
  storage = ctxStorage
  try {
    const raw = storage.get(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NowledgeUiState>
      state = {
        ...DEFAULT_STATE,
        ...parsed,
        // Don't restore ephemeral selection/search — those should reset on reload
        selectedMemoryId: null,
        selectedThreadId: null,
        memoriesQuery: '',
        threadsQuery: '',
      }
    }
  }
  catch {
    /* fall through with default state */
  }
}

export function setNowledgeUiState(patch: Partial<NowledgeUiState>): void {
  state = { ...state, ...patch }
  persist()
  emit()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): NowledgeUiState {
  return state
}

export function useNowledgeUiState(): NowledgeUiState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useNowledgeUiAction<T,>(selector: (s: NowledgeUiState) => T): T {
  const snapshot = useNowledgeUiState()
  return selector(snapshot)
}
