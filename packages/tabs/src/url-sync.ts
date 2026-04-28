// Input: TabStoreState, TabRegistry
// Output: createUrlSync — bidirectional hash URL ↔ tab sync
// Position: Optional URL synchronization module (dormant during Router migration)

import type { StoreApi } from 'zustand'

import type { TabRegistry, TabStoreState } from './store'

export interface UrlSyncOptions {
  /** Custom hash writer (default: sets window.location.hash) */
  setHash?: (hash: string) => void
  /** Custom hash reader (default: reads window.location.hash) */
  getHash?: () => string
}

/**
 * Creates a bidirectional sync between the tab store and URL hash.
 *
 * IMPORTANT: Do NOT activate this while TanStack Router owns `window.location.hash`.
 * This module is implemented for post-Router usage (M7+). During migration (M1-M6),
 * the Router's `/tabs/$tabId` route handles URL representation.
 *
 * @returns A cleanup function to stop syncing.
 */
export function createUrlSync(
  store: StoreApi<TabStoreState>,
  registry: TabRegistry,
  options?: UrlSyncOptions,
): () => void {
  const setHash = options?.setHash ?? ((hash: string) => {
    window.location.hash = hash
  })
  const getHash = options?.getHash ?? (() => window.location.hash.slice(1)) // strip #

  // Tab → URL: when active tab changes, serialize to hash
  const unsubStore = store.subscribe((state, prev) => {
    if (state.activeTabId === prev.activeTabId) {
      return
    }
    const tab = state.tabs.find(t => t.id === state.activeTabId)
    if (!tab) {
      return
    }
    const def = registry[tab.type]
    if (def?.serialize) {
      setHash(`/${tab.type}/${def.serialize(tab.params)}`)
    }
    else {
      const paramStr = Object.entries(tab.params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
        .join('&')
      setHash(paramStr ? `/${tab.type}?${paramStr}` : `/${tab.type}`)
    }
  })

  // URL → Tab: when hash changes, deserialize and open/activate
  const handleHashChange = () => {
    const hash = getHash()
    if (!hash) {
      return
    }

    const [path, query] = hash.split('?')
    const segments = path.split('/').filter(Boolean)
    if (segments.length === 0) {
      return
    }

    const type = segments[0]
    const def = registry[type]
    if (!def) {
      return
    }

    let params: Record<string, string | undefined>
    if (def.deserialize) {
      const result = def.deserialize(segments.slice(1).join('/'))
      if (!result) {
        return
      }
      params = result
    }
    else if (query) {
      params = Object.fromEntries(new URLSearchParams(query))
    }
    else {
      params = {}
    }

    // Check if a matching tab already exists
    const { tabs, setActiveTab, openTab } = store.getState()
    const existing = tabs.find(t => t.type === type && shallowParamsMatch(t.params, params))
    if (existing) {
      setActiveTab(existing.id)
    }
    else {
      openTab(type, params)
    }
  }

  window.addEventListener('hashchange', handleHashChange)

  return () => {
    unsubStore()
    window.removeEventListener('hashchange', handleHashChange)
  }
}

function shallowParamsMatch(a: Record<string, string | undefined>, b: Record<string, string | undefined>): boolean {
  const keysA = Object.keys(a).filter(k => a[k] !== undefined)
  const keysB = Object.keys(b).filter(k => b[k] !== undefined)
  if (keysA.length !== keysB.length) {
    return false
  }
  return keysA.every(k => a[k] === b[k])
}
