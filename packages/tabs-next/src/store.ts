// Input: zustand, route registry, persisted tab descriptors
// Output: createTabStore with multi-location tab contexts and compatibility actions
// Position: Core runtime state for @cradle/tabs-next

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { installDebug, metrics } from './debug'
import { resolveLocation, resolveRouteTitle } from './route-definition'
import type {
  NavigateTabOptions,
  OpenTabOptions,
  PersistedTabsNextState,
  RestoreTabsInput,
  TabContextState,
  TabHistoryEntry,
  TabInstance,
  TabKeepAlivePolicy,
  TabLocation,
  TabParams,
  TabRegistry,
} from './types'

export interface TabStoreState {
  tabs: TabInstance[]
  contexts: TabContextState[]
  activeTabId: string | null
  openTab: (type: string, params?: TabParams, options?: OpenTabOptions) => string
  createTab: (type: string, params?: TabParams, options?: Omit<OpenTabOptions, 'dedupe'>) => string
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  navigateTab: (id: string, location: TabLocation, options?: NavigateTabOptions) => void
  replaceTabLocation: (id: string, location: TabLocation, options?: NavigateTabOptions) => void
  updateTabParams: (id: string, params: Partial<TabParams>) => void
  updateTabLabel: (id: string, label: string) => void
  updateTabViewState: (id: string, key: string, value: unknown) => void
  reorderTabs: (orderedIds: string[]) => void
  restoreTabs: (input: RestoreTabsInput) => void
  goBack: (id: string) => void
  goForward: (id: string) => void
  getActiveTab: () => TabInstance | undefined
  getActiveContext: () => TabContextState | undefined
}

function makeId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID().slice(0, 8)
  }
  return Math.random().toString(36).slice(2, 10)
}

function now(): number {
  return Date.now()
}

function paramsMatch(a: TabParams, b: TabParams): boolean {
  const keysA = Object.keys(a).filter(k => a[k] !== undefined)
  const keysB = Object.keys(b).filter(k => b[k] !== undefined)
  if (keysA.length !== keysB.length) {
    return false
  }
  return keysA.every(k => a[k] === b[k])
}

function resolveKeepAlive(policy: TabKeepAlivePolicy | undefined, pinned: boolean): TabKeepAlivePolicy {
  if (policy) {
    return policy
  }
  return pinned ? 'always' : 'default'
}

function createEntry(registry: TabRegistry, type: string, params: TabParams, label?: string): {
  entry: TabHistoryEntry
  label: string
  pinned: boolean
  keepAlive: TabKeepAlivePolicy
} {
  const route = registry[type]
  const location = route ? resolveLocation(route, params) : { routeId: type, params, pathname: `/${type}` }
  const resolvedLabel = route ? resolveRouteTitle(route, params, label) : (label ?? type)
  return {
    entry: { location, title: resolvedLabel },
    label: resolvedLabel,
    pinned: route?.pinned ?? false,
    keepAlive: resolveKeepAlive(route?.keepAlive, route?.pinned ?? false),
  }
}

function contextLocation(context: TabContextState): TabLocation | null {
  return context.history[context.index]?.location ?? null
}

function validateTab(value: unknown): value is TabInstance {
  if (!value || typeof value !== 'object') {
    return false
  }
  const tab = value as Partial<TabInstance>
  return (
    typeof tab.id === 'string'
    && typeof tab.type === 'string'
    && typeof tab.label === 'string'
    && typeof tab.pinned === 'boolean'
    && !!tab.params
    && typeof tab.params === 'object'
    && !Array.isArray(tab.params)
  )
}

function sanitizeTabs(tabs: unknown, registry: TabRegistry): TabInstance[] {
  if (!Array.isArray(tabs)) {
    return []
  }
  const validTabs: TabInstance[] = []
  for (const tab of tabs) {
    if (validateTab(tab) && registry[tab.type]) {
      validTabs.push(tab)
    }
  }
  return validTabs
}

function sanitizeContexts(contexts: unknown, tabs: TabInstance[]): TabContextState[] {
  if (!Array.isArray(contexts)) {
    return []
  }
  const tabIds = new Set<string>()
  for (const tab of tabs) {
    tabIds.add(tab.id)
  }
  const valid: TabContextState[] = []
  for (const item of contexts) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const context = item as Partial<TabContextState>
    if (
      typeof context.id !== 'string'
      || !tabIds.has(context.id)
      || !Array.isArray(context.history)
      || typeof context.index !== 'number'
    ) {
      continue
    }
    const history = context.history.filter((entry): entry is TabHistoryEntry => {
      if (!entry || typeof entry !== 'object') {
        return false
      }
      const candidate = entry as Partial<TabHistoryEntry>
      return !!candidate.location && typeof candidate.location.routeId === 'string'
    })
    if (history.length === 0) {
      continue
    }
    valid.push({
      id: context.id,
      history,
      index: Math.max(0, Math.min(context.index, history.length - 1)),
      pinned: context.pinned === true,
      keepAlive: context.keepAlive ?? 'default',
      createdAt: typeof context.createdAt === 'number' ? context.createdAt : now(),
      lastActiveAt: typeof context.lastActiveAt === 'number' ? context.lastActiveAt : now(),
      viewState: context.viewState && typeof context.viewState === 'object' ? context.viewState : {},
    })
  }
  return valid
}

function contextsFromTabs(tabs: TabInstance[], registry: TabRegistry): TabContextState[] {
  return tabs.map((tab) => {
    const { entry, keepAlive } = createEntry(registry, tab.type, tab.params, tab.label)
    return {
      id: tab.id,
      history: [entry],
      index: 0,
      pinned: tab.pinned,
      keepAlive: resolveKeepAlive(keepAlive, tab.pinned),
      createdAt: now(),
      lastActiveAt: now(),
      viewState: {},
    }
  })
}

function sanitizePersisted(value: unknown, registry: TabRegistry): Pick<TabStoreState, 'tabs' | 'contexts' | 'activeTabId'> {
  const persisted = value as Partial<PersistedTabsNextState> | undefined
  const tabs = sanitizeTabs(persisted?.tabs, registry)
  const contexts = sanitizeContexts(persisted?.contexts, tabs)
  const normalizedContexts = contexts.length > 0 ? contexts : contextsFromTabs(tabs, registry)
  const activeTabId = typeof persisted?.activeTabId === 'string' && tabs.some(tab => tab.id === persisted.activeTabId)
    ? persisted.activeTabId
    : tabs.at(-1)?.id ?? null
  return { tabs, contexts: normalizedContexts, activeTabId }
}

const persistStorage = createJSONStorage(() => {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      return globalThis.localStorage
    }
  }
  catch {
    // Ignore and fall back to ephemeral storage for non-browser tests.
  }

  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }
})

export function createTabStore(registry: TabRegistry, options?: { persistKey?: string }) {
  const persistKey = options?.persistKey ?? 'cradle:tabs-next:v1'

  const store = create<TabStoreState>()(
    persist(
      (set, get) => ({
        tabs: [],
        contexts: [],
        activeTabId: null,

        openTab: (type, params = {}, opts) => {
          metrics.openCount++
          const route = registry[type]
          const pinned = opts?.pinned ?? route?.pinned ?? false
          const dedupe = opts?.dedupe ?? (pinned || Object.keys(params).length > 0)

          if (dedupe) {
            const existing = get().tabs.find((tab) => {
              if (tab.type !== type) {
                return false
              }
              return tab.pinned || pinned || paramsMatch(tab.params, params)
            })
            if (existing) {
              get().setActiveTab(existing.id)
              return existing.id
            }
          }

          return get().createTab(type, params, { ...opts, pinned })
        },

        createTab: (type, params = {}, opts) => {
          metrics.createCount++
          const { entry, label, pinned: routePinned, keepAlive } = createEntry(registry, type, params, opts?.label)
          const id = makeId()
          const pinned = opts?.pinned ?? routePinned
          const timestamp = now()
          const tab: TabInstance = { id, type, params, label, pinned }
          const context: TabContextState = {
            id,
            history: [entry],
            index: 0,
            pinned,
            keepAlive: resolveKeepAlive(opts?.keepAlive ?? keepAlive, pinned),
            createdAt: timestamp,
            lastActiveAt: timestamp,
            viewState: {},
          }
          set(s => ({
            tabs: [...s.tabs, tab],
            contexts: [...s.contexts, context],
            activeTabId: opts?.activate === false ? s.activeTabId : id,
          }))
          return id
        },

        closeTab: (tabId) => {
          metrics.closeCount++
          const { tabs, activeTabId } = get()
          const tab = tabs.find(t => t.id === tabId)
          if (!tab || tab.pinned || tabs.length <= 1) {
            return
          }

          const index = tabs.findIndex(t => t.id === tabId)
          const nextTabs = tabs.filter(t => t.id !== tabId)
          const nextContexts = get().contexts.filter(context => context.id !== tabId)
          const nextActiveId = activeTabId === tabId
            ? nextTabs[Math.min(index, nextTabs.length - 1)]?.id ?? nextTabs[0]?.id ?? null
            : activeTabId
          set({ tabs: nextTabs, contexts: nextContexts, activeTabId: nextActiveId })
        },

        setActiveTab: (tabId) => {
          metrics.activateCount++
          if (!get().tabs.some(t => t.id === tabId)) {
            return
          }
          const timestamp = now()
          set(s => ({
            activeTabId: tabId,
            contexts: s.contexts.map(context => context.id === tabId ? { ...context, lastActiveAt: timestamp } : context),
          }))
        },

        navigateTab: (tabId, location, options) => {
          metrics.navigateCount++
          set((s) => {
            const context = s.contexts.find(item => item.id === tabId)
            if (!context) {
              return s
            }
            const route = registry[location.routeId]
            const title = options?.title ?? (route ? resolveRouteTitle(route, location.params) : location.routeId)
            const entry: TabHistoryEntry = { location, title }
            const history = options?.replace
              ? context.history.map((item, index) => index === context.index ? entry : item)
              : [...context.history.slice(0, context.index + 1), entry]
            const nextIndex = options?.replace ? context.index : history.length - 1
            return {
              tabs: s.tabs.map(tab => tab.id === tabId
                ? { ...tab, type: location.routeId, params: location.params, label: title }
                : tab),
              contexts: s.contexts.map(item => item.id === tabId
                ? { ...item, history, index: nextIndex, lastActiveAt: now() }
                : item),
            }
          })
        },

        replaceTabLocation: (tabId, location, options) => {
          get().navigateTab(tabId, location, { ...options, replace: true })
        },

        updateTabParams: (tabId, params) => {
          const tab = get().tabs.find(t => t.id === tabId)
          if (!tab) {
            return
          }
          const nextParams = { ...tab.params, ...params }
          const route = registry[tab.type]
          const location = route ? resolveLocation(route, nextParams) : { routeId: tab.type, params: nextParams, pathname: `/${tab.type}` }
          get().replaceTabLocation(tabId, location)
        },

        updateTabLabel: (tabId, label) => {
          set(s => ({
            tabs: s.tabs.map(tab => tab.id === tabId ? { ...tab, label } : tab),
            contexts: s.contexts.map((context) => {
              if (context.id !== tabId) {
                return context
              }
              const history = context.history.map((entry, index) => index === context.index ? { ...entry, title: label } : entry)
              return { ...context, history }
            }),
          }))
        },

        updateTabViewState: (tabId, key, value) => {
          set(s => ({
            contexts: s.contexts.map(context => context.id === tabId
              ? { ...context, viewState: { ...context.viewState, [key]: value } }
              : context),
          }))
        },

        reorderTabs: (orderedIds) => {
          set((s) => {
            const tabMap = new Map(s.tabs.map(tab => [tab.id, tab]))
            const orderedIdSet = new Set(orderedIds)
            const nextTabs: TabInstance[] = []
            for (const id of orderedIds) {
              const tab = tabMap.get(id)
              if (tab) {
                nextTabs.push(tab)
              }
            }
            for (const tab of s.tabs) {
              if (!orderedIdSet.has(tab.id)) {
                nextTabs.push(tab)
              }
            }
            return { tabs: nextTabs }
          })
        },

        restoreTabs: (input) => {
          const tabs = sanitizeTabs(input.tabs, registry)
          const activeTabId = typeof input.activeTabId === 'string' && tabs.some(tab => tab.id === input.activeTabId)
            ? input.activeTabId
            : tabs.at(-1)?.id ?? null
          set({ tabs, contexts: contextsFromTabs(tabs, registry), activeTabId })
        },

        goBack: (tabId) => {
          set(s => ({
            contexts: s.contexts.map(context => context.id === tabId
              ? { ...context, index: Math.max(0, context.index - 1), lastActiveAt: now() }
              : context),
          }))
          const context = get().contexts.find(item => item.id === tabId)
          const location = context ? contextLocation(context) : null
          if (location) {
            get().replaceTabLocation(tabId, location, { title: context?.history[context.index]?.title })
          }
        },

        goForward: (tabId) => {
          set(s => ({
            contexts: s.contexts.map(context => context.id === tabId
              ? { ...context, index: Math.min(context.history.length - 1, context.index + 1), lastActiveAt: now() }
              : context),
          }))
          const context = get().contexts.find(item => item.id === tabId)
          const location = context ? contextLocation(context) : null
          if (location) {
            get().replaceTabLocation(tabId, location, { title: context?.history[context.index]?.title })
          }
        },

        getActiveTab: () => {
          const { tabs, activeTabId } = get()
          return tabs.find(tab => tab.id === activeTabId)
        },

        getActiveContext: () => {
          const { contexts, activeTabId } = get()
          return contexts.find(context => context.id === activeTabId)
        },
      }),
      {
        name: persistKey,
        storage: persistStorage,
        version: 1,
        partialize: state => ({
          version: 1,
          tabs: state.tabs,
          contexts: state.contexts,
          activeTabId: state.activeTabId,
        }),
        merge: (persisted, current) => ({
          ...current,
          ...sanitizePersisted(persisted, registry),
        }),
      },
    ),
  )

  installDebug(() => store.getState())

  return store
}

export function selectCurrentLocation(context: TabContextState | undefined): TabLocation | null {
  return context ? contextLocation(context) : null
}
