// Design decisions:
//   - Store is the single source of truth; URL is a projection
//   - Hash-based routing (#/type/serialized) for Electron file:// compatibility
//   - Tab switch = pushState (user expects Back to undo tab switches)
//   - Tab internal navigation = pushState
//   - Tab internal replace / goBack / goForward = replaceState
//   - Closed tab entries: replaceState to correct (no recursive history.go())
//
// Trade-off (intentional):
//   When switching from Tab A to Tab B, the replaceState overwrites {A, currentIndex}
//   with pushState({B,0}). This means Tab A's latest browser entry is lost. However,
//   Tab A's store context retains full history — the user can still use in-tab navigation.
//   Browser Forward after Back-ing to Tab A will go to Tab B, while Tab A's in-tab
//   forward goes to the next internal history entry. These two "forward" semantics differ.
//   This is acceptable because the pushState-for-everything alternative causes 120+ entry
//   bloat that makes browser Back unusable.

import type { StoreApi, UseBoundStore } from 'zustand'

import type { TabStoreState } from './store'
import type { TabParams, TabRegistry } from './types'

const HASH_PREFIX_RE = /^#\/?/

// ── Public types ──

export interface UrlSyncOptions {
  store: UseBoundStore<StoreApi<TabStoreState>>
  registry: TabRegistry
  /** Reserved for future pathname mode. Default: 'hash' */
  mode?: 'hash'
}

export interface UrlSyncHandle {
  init: () => void
  destroy: () => void
}

// ── Browser history.state encoding ──

interface TabHistoryState {
  __tabsNext: true
  tabId: string
  historyIndex: number
}

function isTabHistoryState(value: unknown): value is TabHistoryState {
  return (
    !!value
    && typeof value === 'object'
    && (value as Record<string, unknown>).__tabsNext === true
    && typeof (value as Record<string, unknown>).tabId === 'string'
    && typeof (value as Record<string, unknown>).historyIndex === 'number'
  )
}

// ── Hash utilities ──

export function buildHash(registry: TabRegistry, type: string, params: TabParams): string {
  const route = registry[type]
  if (route?.serialize) {
    const serialized = route.serialize(params)
    return serialized ? `#/${type}/${serialized}` : `#/${type}`
  }
  return `#/${type}`
}

export function parseHash(
  registry: TabRegistry,
  hash: string,
): { type: string, params: TabParams } | null {
  // Strip leading # and /
  const raw = hash.replace(HASH_PREFIX_RE, '')
  if (!raw || raw === 'devtool') {
    return null
  }

  // Split: first segment is type, rest is serialized params
  const slashIndex = raw.indexOf('/')
  const type = slashIndex === -1 ? raw : raw.slice(0, slashIndex)
  const rest = slashIndex === -1 ? '' : raw.slice(slashIndex + 1)

  const route = registry[type]
  if (!route) {
    return null
  }

  if (route.deserialize && rest) {
    const params = route.deserialize(rest)
    if (params) {
      return { type, params }
    }
  }

  // No params or no deserializer — return empty params
  return { type, params: {} }
}

// ── Snapshot for state diff ──

interface ContextSnapshot {
  historyHeadRef: unknown // identity reference of history[index]
  index: number
}

// ── Main module ──

export function createUrlSync({ store, registry }: UrlSyncOptions): UrlSyncHandle {
  let updatingFromPopstate = false
  let unsubStore: (() => void) | null = null

  // Prev state snapshot for diff
  let prevActiveTabId: string | null = null
  let prevSnapshot: ContextSnapshot | null = null

  function captureSnapshot(): void {
    const state = store.getState()
    prevActiveTabId = state.activeTabId
    if (state.activeTabId) {
      const ctx = state.contexts.find(c => c.id === state.activeTabId)
      if (ctx) {
        prevSnapshot = {
          historyHeadRef: ctx.history[ctx.index],
          index: ctx.index,
        }
      }
 else {
        prevSnapshot = null
      }
    }
 else {
      prevSnapshot = null
    }
  }

  function inferAction(state: TabStoreState): 'push' | 'replace' | 'skip' {
    if (updatingFromPopstate) {
      return 'skip'
    }
    if (!state.activeTabId) {
      return 'skip'
    }

    // Tab switch → pushState
    if (state.activeTabId !== prevActiveTabId) {
      return 'push'
    }

    // Same tab — check if new history entry was added
    const ctx = state.contexts.find(c => c.id === state.activeTabId)
    if (!ctx || !prevSnapshot) {
      return 'replace'
    }

    // Identity check: if history[index] is a new reference, it's a push navigation
    if (ctx.history[ctx.index] !== prevSnapshot.historyHeadRef) {
      // New entry added (navigateTab without replace)
      // Distinguish: history grew (new entry) vs same entry replaced
      if (ctx.index > prevSnapshot.index && ctx.history.length > prevSnapshot.index + 1) {
        return 'push'
      }
    }

    return 'replace'
  }

  // ── Store → URL ──

  function onStoreChange(): void {
    if (updatingFromPopstate) {
      captureSnapshot()
      return
    }

    const state = store.getState()
    if (!state.activeTabId) {
      return
    }

    const action = inferAction(state)
    captureSnapshot()

    if (action === 'skip') {
      return
    }

    const tab = state.tabs.find(t => t.id === state.activeTabId)
    const ctx = state.contexts.find(c => c.id === state.activeTabId)
    if (!tab || !ctx) {
      return
    }

    const hash = buildHash(registry, tab.type, tab.params)
    const historyState: TabHistoryState = {
      __tabsNext: true,
      tabId: tab.id,
      historyIndex: ctx.index,
    }

    if (action === 'push') {
      history.pushState(historyState, '', hash)
    }
 else {
      history.replaceState(historyState, '', hash)
    }
  }

  // ── URL → Store (popstate) ──

  function onPopstate(event: PopStateEvent): void {
    const state = event.state

    if (!isTabHistoryState(state)) {
      // Not our entry — attempt cold URL parse
      handleColdUrl()
      return
    }

    const s = store.getState()
    const tabExists = s.tabs.some(t => t.id === state.tabId)

    if (!tabExists) {
      // Closed tab entry → replaceState to correct URL
      syncCurrentTabToUrl()
      return
    }

    // Use try/finally to ensure flag is cleared even if store.setState throws
    updatingFromPopstate = true
    try {
      // Switch tab if needed
      if (s.activeTabId !== state.tabId) {
        s.setActiveTab(state.tabId)
      }

      // Restore context.index if needed
      const context = store.getState().contexts.find(c => c.id === state.tabId)
      if (context && context.index !== state.historyIndex) {
        store.getState().restoreTabHistoryIndex(state.tabId, state.historyIndex)
      }
    }
 finally {
      updatingFromPopstate = false
      captureSnapshot()
    }
  }

  // ── Helpers ──

  function syncCurrentTabToUrl(): void {
    const s = store.getState()
    const tab = s.tabs.find(t => t.id === s.activeTabId)
    const ctx = s.contexts.find(c => c.id === s.activeTabId)
    if (tab && ctx) {
      const hash = buildHash(registry, tab.type, tab.params)
      history.replaceState(
        { __tabsNext: true, tabId: tab.id, historyIndex: ctx.index } satisfies TabHistoryState,
        '',
        hash,
      )
    }
  }

  function handleColdUrl(): void {
    const hash = window.location.hash
    const parsed = parseHash(registry, hash)
    if (!parsed) {
      return
    } // No valid route in URL, keep persist-restored state

    const s = store.getState()

    // Try to find existing tab matching this route + params
    const existing = s.tabs.find((tab) => {
      if (tab.type !== parsed.type) {
        return false
      }
      // For tabs with serialize/deserialize, match on serialized form
      const route = registry[parsed.type]
      if (route?.serialize) {
        return route.serialize(tab.params) === route.serialize(parsed.params)
      }
      return true // No serializer = singleton tab
    })

    if (existing) {
      if (s.activeTabId !== existing.id) {
        s.setActiveTab(existing.id)
      }
    }
 else {
      // Open new tab for this URL
      s.openTab(parsed.type, parsed.params)
    }
  }

  // ── Lifecycle ──

  return {
    init() {
      // Cold start: reconcile URL with persisted store state
      handleColdUrl()

      // Mark initial browser history entry
      syncCurrentTabToUrl()

      // Capture initial snapshot
      captureSnapshot()

      // Bind listeners
      window.addEventListener('popstate', onPopstate)
      unsubStore = store.subscribe(onStoreChange)
    },

    destroy() {
      window.removeEventListener('popstate', onPopstate)
      unsubStore?.()
      unsubStore = null
    },
  }
}
