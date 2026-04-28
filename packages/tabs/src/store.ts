// Input: zustand, TabDefinition
// Output: createTabStore factory, TabInstance, TabStoreState, TabRegistry types
// Position: Core state management for tab lifecycle

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { TabDefinition } from './define-tab'

// ─── Public types ─────────────────────────────────────────────────────────────

// eslint-disable-next-line ts/no-explicit-any
export type TabRegistry = Record<string, TabDefinition<string, any>>

export interface TabInstance {
  id: string
  type: string
  params: Record<string, string | undefined>
  label: string
  pinned: boolean
}

export interface TabStoreState {
  tabs: TabInstance[]
  activeTabId: string | null
  openTab: (type: string, params?: Record<string, string | undefined>, options?: { label?: string, pinned?: boolean }) => string
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTabParams: (id: string, params: Partial<Record<string, string | undefined>>) => void
  updateTabLabel: (id: string, label: string) => void
  getActiveTab: () => TabInstance | undefined
}

// ─── Implementation ───────────────────────────────────────────────────────────

function makeId(): string {
  return crypto.randomUUID().slice(0, 8)
}

function resolveLabel(registry: TabRegistry, type: string, params: Record<string, string | undefined>): string {
  const def = registry[type]
  if (!def) {
    return type
  }
  if (typeof def.label === 'function') {
    return def.label(params)
  }
  return def.label
}

export function createTabStore(registry: TabRegistry, options?: { persistKey?: string }) {
  const persistKey = options?.persistKey ?? 'cradle-tab-store'

  return create<TabStoreState>()(
    persist(
      (set, get) => ({
        tabs: [],
        activeTabId: null,

        openTab: (type, params = {}, opts) => {
          const id = makeId()
          const label = opts?.label ?? resolveLabel(registry, type, params)
          const pinned = opts?.pinned ?? registry[type]?.pinned ?? false
          const tab: TabInstance = { id, type, params, label, pinned }
          set(s => ({
            tabs: [...s.tabs, tab],
            activeTabId: id,
          }))
          return id
        },

        closeTab: (tabId) => {
          const { tabs, activeTabId } = get()
          const tab = tabs.find(t => t.id === tabId)
          if (!tab || tab.pinned) {
            return
          }
          if (tabs.length <= 1) {
            return
          }

          const idx = tabs.findIndex(t => t.id === tabId)
          const next = tabs.filter(t => t.id !== tabId)

          let nextActive = activeTabId
          if (activeTabId === tabId) {
            nextActive = next[Math.min(idx, next.length - 1)]?.id ?? next[0]?.id ?? null
          }
          set({ tabs: next, activeTabId: nextActive })
        },

        setActiveTab: (tabId) => {
          const { tabs } = get()
          if (tabs.some(t => t.id === tabId)) {
            set({ activeTabId: tabId })
          }
        },

        updateTabParams: (tabId, params) => {
          set(s => ({
            tabs: s.tabs.map(t =>
              t.id === tabId ? { ...t, params: { ...t.params, ...params } } : t),
          }))
        },

        updateTabLabel: (tabId, label) => {
          set(s => ({
            tabs: s.tabs.map(t =>
              t.id === tabId ? { ...t, label } : t),
          }))
        },

        getActiveTab: () => {
          const { tabs, activeTabId } = get()
          return tabs.find(t => t.id === activeTabId)
        },
      }),
      {
        name: persistKey,
        partialize: state => ({
          tabs: state.tabs,
          activeTabId: state.activeTabId,
        }),
      },
    ),
  )
}
