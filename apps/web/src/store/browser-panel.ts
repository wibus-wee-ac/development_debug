// FILE: browser-panel.ts
// Purpose: Caches owner-scoped native BrowserPanel metadata and browser history for renderer chrome.
// Layer: Renderer Zustand store
// Depends on: Zustand persistence, browser IPC state snapshots

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from './persist-storage'

export const DEFAULT_BROWSER_PANEL_OWNER_ID = 'global'
export const BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL = 'browser-panel:webview-tab-shortcut'

const BROWSER_HISTORY_LIMIT = 12
const EMPTY_BROWSER_HISTORY: BrowserHistoryEntry[] = []
const BROWSER_PANEL_STORAGE_KEY = 'cradle:browser-panel:v2'
const BROWSER_PANEL_TAB_SHORTCUT_KEYS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])

export type BrowserPanelScriptRunAt = 'document-start' | 'document-end' | 'document-idle'

export interface BrowserPanelCustomScript {
  id: string
  label: string
  runAt: BrowserPanelScriptRunAt
  source: string
}

export interface BrowserTabSource {
  sessionId?: string | null
  sessionTitle?: string | null
}

export interface BrowserTabState {
  id: string
  url: string
  title: string
  status: 'live' | 'suspended'
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  faviconUrl: string | null
  lastCommittedUrl: string | null
  lastError: string | null
}

export interface ThreadBrowserState {
  threadId: string
  version: number
  open: boolean
  activeTabId: string | null
  tabs: BrowserTabState[]
  lastError: string | null
}

export type BrowserWebTab = BrowserTabState & {
  kind: 'browser'
  sessionId: string | null
  sessionTitle: string | null
  scriptIds: string[]
  customScripts: BrowserPanelCustomScript[]
  loading: boolean
  favicon: string | null
}

export interface BrowserWorkspaceFileTab {
  kind: 'workspace-file'
  id: string
  workspaceId: string
  path: string
  view: 'editor' | 'preview'
  title: string
  loading: false
  favicon: null
}

export interface BrowserWorkspaceDiffTab {
  kind: 'workspace-diff'
  id: string
  workspaceId: string
  paths?: string[]
  title: string
  loading: false
  favicon: null
}

export interface BrowserSubagentTab {
  kind: 'subagent'
  id: string
  sessionId: string
  threadId: string
  agentName: string
  agentRole: string | null
  title: string
  loading: false
  favicon: null
}

export type BrowserPanelTab = BrowserWebTab | BrowserWorkspaceFileTab | BrowserWorkspaceDiffTab | BrowserSubagentTab

export interface BrowserHistoryEntry {
  url: string
  title: string
  tabId: string
}

export interface BrowserPanelCloseTabResult {
  closed: boolean
  closedLastTab: boolean
}

interface BrowserPanelTabShortcutInput {
  key: string
  metaKey: boolean
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

interface BrowserPanelOwnerState {
  threadState: ThreadBrowserState | null
  tabs: BrowserPanelTab[]
  activeTabId: string | null
  requestedTab: {
    id: number
    url?: string
    sessionId?: string | null
    sessionTitle?: string | null
  } | null
  scrollToFilePath: { path: string, tabId: string, nonce: number } | null
}

interface BrowserPanelState {
  activeOwnerId: string
  owners: Record<string, BrowserPanelOwnerState | undefined>
  tabs: BrowserPanelTab[]
  activeTabId: string | null
  requestedTab: BrowserPanelOwnerState['requestedTab']
  scrollToFilePath: BrowserPanelOwnerState['scrollToFilePath']
  recentHistoryByOwnerId: Record<string, BrowserHistoryEntry[] | undefined>
  setActiveOwner: (ownerId: string | null | undefined) => void
  upsertOwnerState: (state: ThreadBrowserState) => void
  removeOwnerState: (ownerId: string) => void
  requestTab: (url?: string, source?: BrowserTabSource, ownerId?: string | null) => void
  fulfillRequestedTab: (id: number, ownerId?: string | null) => void
  createTab: (url?: string, source?: BrowserTabSource, ownerId?: string | null) => string
  closeTab: (id: string, ownerId?: string | null) => BrowserPanelCloseTabResult
  setActiveTab: (id: string, ownerId?: string | null) => void
  updateTab: (id: string, updates: Partial<BrowserWebTab>, ownerId?: string | null) => void
  navigateTo: (id: string, url: string, ownerId?: string | null) => void
  setBrowserTabScripts: (id: string, scriptIds: string[], ownerId?: string | null) => void
  addBrowserTabCustomScript: (
    id: string,
    input: Omit<BrowserPanelCustomScript, 'id'>,
    ownerId?: string | null,
  ) => string
  openWorkspaceFileTab: (input: {
    workspaceId: string
    path: string
    view: 'editor' | 'preview'
    ownerId?: string | null
  }) => string
  openWorkspaceDiffTab: (input: {
    workspaceId: string
    paths?: string[]
    title?: string
    ownerId?: string | null
  }) => string
  openSubagentTab: (input: {
    sessionId: string
    threadId: string
    agentName: string
    agentRole?: string | null
    ownerId?: string | null
  }) => string
  requestScrollToFilePath: (input: { path: string, tabId: string }) => void
  clearScrollToFilePath: (ownerId?: string | null) => void
}

let localTabCounter = 0
let customScriptCounter = 0

function normalizeBrowserPanelOwnerId(ownerId: string | null | undefined): string {
  return ownerId || DEFAULT_BROWSER_PANEL_OWNER_ID
}

function createEmptyThreadState(ownerId: string): ThreadBrowserState {
  return {
    threadId: ownerId,
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  }
}

function createEmptyOwnerState(ownerId: string): BrowserPanelOwnerState {
  return {
    threadState: createEmptyThreadState(ownerId),
    tabs: [],
    activeTabId: null,
    requestedTab: null,
    scrollToFilePath: null,
  }
}

function toBrowserPanelTab(tab: BrowserTabState): BrowserWebTab {
  return {
    ...tab,
    kind: 'browser',
    sessionId: null,
    sessionTitle: null,
    scriptIds: [],
    customScripts: [],
    loading: tab.isLoading,
    favicon: tab.faviconUrl,
  }
}

function projectThreadState(
  state: ThreadBrowserState,
  previousOwnerState?: BrowserPanelOwnerState,
): BrowserPanelOwnerState {
  const nextBrowserTabsById = new Map(state.tabs.map(tab => [tab.id, toBrowserPanelTab(tab)]))
  const projectedTabs: BrowserPanelTab[] = []
  const seenBrowserTabIds = new Set<string>()

  for (const previousTab of previousOwnerState?.tabs ?? []) {
    if (previousTab.kind !== 'browser') {
      projectedTabs.push(previousTab)
      continue
    }

    const nextBrowserTab = nextBrowserTabsById.get(previousTab.id)
    if (!nextBrowserTab) {
      continue
    }

    seenBrowserTabIds.add(previousTab.id)
    projectedTabs.push({
      ...nextBrowserTab,
      sessionId: previousTab.sessionId,
      sessionTitle: previousTab.sessionTitle,
      scriptIds: previousTab.scriptIds,
      customScripts: previousTab.customScripts,
    })
  }

  for (const nextBrowserTab of nextBrowserTabsById.values()) {
    if (!seenBrowserTabIds.has(nextBrowserTab.id)) {
      projectedTabs.push(nextBrowserTab)
    }
  }

  const previousActiveTab = previousOwnerState?.tabs.find(
    tab => tab.id === previousOwnerState.activeTabId,
  )
  const previousActiveWorkspaceTab
    = previousActiveTab && previousActiveTab.kind !== 'browser' ? previousActiveTab : null
  const shouldKeepWorkspaceActiveTab = previousActiveWorkspaceTab !== null
    && projectedTabs.some(tab => tab.id === previousActiveWorkspaceTab.id)

  return {
    threadState: state,
    tabs: projectedTabs,
    activeTabId: shouldKeepWorkspaceActiveTab
      ? previousActiveWorkspaceTab.id
      : (state.activeTabId ?? projectedTabs.at(-1)?.id ?? null),
    requestedTab: null,
    scrollToFilePath: null,
  }
}

function getOwnerState(state: BrowserPanelState, ownerId: string): BrowserPanelOwnerState {
  return state.owners[ownerId] ?? createEmptyOwnerState(ownerId)
}

function projectActiveOwner(ownerState: BrowserPanelOwnerState) {
  return {
    tabs: ownerState.tabs,
    activeTabId: ownerState.activeTabId,
    requestedTab: ownerState.requestedTab,
    scrollToFilePath: ownerState.scrollToFilePath,
  }
}

function applyOwnerState(
  state: BrowserPanelState,
  ownerId: string,
  ownerState: BrowserPanelOwnerState,
): Partial<BrowserPanelState> {
  return {
    owners: {
      ...state.owners,
      [ownerId]: ownerState,
    },
    ...(state.activeOwnerId === ownerId ? projectActiveOwner(ownerState) : {}),
  }
}

function normalizeHistoryUrl(url: string): string {
  const trimmed = url.trim()
  return trimmed === 'about:blank' ? '' : trimmed
}

function upsertRecentHistoryEntry(
  entries: BrowserHistoryEntry[] | undefined,
  nextEntry: BrowserHistoryEntry,
): BrowserHistoryEntry[] {
  const normalizedUrl = normalizeHistoryUrl(nextEntry.url)
  if (!normalizedUrl) {
    return entries ?? []
  }

  const nextEntries = (entries ?? []).filter(
    entry => normalizeHistoryUrl(entry.url) !== normalizedUrl,
  )
  nextEntries.unshift({
    ...nextEntry,
    url: normalizedUrl,
  })
  return nextEntries.slice(0, BROWSER_HISTORY_LIMIT)
}

function buildHistoryFromState(
  previousHistory: BrowserHistoryEntry[] | undefined,
  state: ThreadBrowserState,
): BrowserHistoryEntry[] {
  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId) ?? null
  const orderedTabs = activeTab
    ? [activeTab, ...state.tabs.filter(tab => tab.id !== activeTab.id)]
    : state.tabs

  return orderedTabs.reduce(
    (entries, tab) =>
      upsertRecentHistoryEntry(entries, {
        url: tab.lastCommittedUrl ?? tab.url,
        title: tab.title,
        tabId: tab.id,
      }),
    previousHistory ?? EMPTY_BROWSER_HISTORY,
  )
}

function createLocalBrowserTab(url = 'about:blank', source?: BrowserTabSource): BrowserWebTab {
  const id = `local-browser-${++localTabCounter}`
  return {
    kind: 'browser',
    id,
    sessionId: source?.sessionId ?? null,
    sessionTitle: source?.sessionTitle ?? null,
    scriptIds: [],
    customScripts: [],
    url,
    title: url === 'about:blank' ? 'New tab' : url,
    status: 'suspended',
    isLoading: false,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    favicon: null,
    lastCommittedUrl: null,
    lastError: null,
  }
}

export const useBrowserPanelStore = create<BrowserPanelState>()(
  persist(
    (set, get) => ({
      activeOwnerId: DEFAULT_BROWSER_PANEL_OWNER_ID,
      owners: {},
      tabs: [],
      activeTabId: null,
      requestedTab: null,
      scrollToFilePath: null,
      recentHistoryByOwnerId: {},

      setActiveOwner: (ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput)
        set((state) => {
          if (state.activeOwnerId === ownerId) {
            return state
          }
          return {
            activeOwnerId: ownerId,
            ...projectActiveOwner(getOwnerState(state, ownerId)),
          }
        })
      },

      upsertOwnerState: (threadState) => {
        set((state) => {
          const ownerId = normalizeBrowserPanelOwnerId(threadState.threadId)
          const previousOwnerState = state.owners[ownerId]
          if (previousOwnerState?.threadState?.version === threadState.version) {
            return state
          }

          const ownerState = {
            ...projectThreadState(threadState, previousOwnerState),
            requestedTab: previousOwnerState?.requestedTab ?? null,
            scrollToFilePath: previousOwnerState?.scrollToFilePath ?? null,
          }
          return {
            ...applyOwnerState(state, ownerId, ownerState),
            recentHistoryByOwnerId: {
              ...state.recentHistoryByOwnerId,
              [ownerId]: buildHistoryFromState(state.recentHistoryByOwnerId[ownerId], threadState),
            },
          }
        })
      },

      removeOwnerState: (ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput)
        set((state) => {
          if (!Object.hasOwn(state.owners, ownerId)) {
            return state
          }
          const owners = { ...state.owners }
          delete owners[ownerId]
          const nextOwnerState = createEmptyOwnerState(ownerId)
          return {
            owners,
            ...(state.activeOwnerId === ownerId ? projectActiveOwner(nextOwnerState) : {}),
          }
        })
      },

      requestTab: (url, source, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            requestedTab: {
              id: Date.now(),
              url,
              sessionId: source?.sessionId ?? null,
              sessionTitle: source?.sessionTitle ?? null,
            },
          })
        })
      },

      fulfillRequestedTab: (id, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          if (ownerState.requestedTab?.id !== id) {
            return state
          }
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            requestedTab: null,
          })
        })
      },

      createTab: (url, source, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab = createLocalBrowserTab(url, source)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
      },

      closeTab: (id, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        let result: BrowserPanelCloseTabResult = { closed: false, closedLastTab: false }
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          if (!ownerState.tabs.some(tab => tab.id === id)) {
            return state
          }
          const tabs = ownerState.tabs.filter(tab => tab.id !== id)
          result = { closed: true, closedLastTab: tabs.length === 0 }
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs,
            activeTabId:
              ownerState.activeTabId === id ? (tabs.at(-1)?.id ?? null) : ownerState.activeTabId,
          })
        })
        return result
      },

      setActiveTab: (id, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, { ...ownerState, activeTabId: id })
        })
      },

      updateTab: (id, updates, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: ownerState.tabs.map(tab =>
              tab.id === id && tab.kind === 'browser'
                ? ({ ...tab, ...updates } satisfies BrowserWebTab)
                : tab),
          })
        })
      },

      navigateTo: (id, url, ownerIdInput) => {
        get().updateTab(id, { url }, ownerIdInput)
      },

      setBrowserTabScripts: (id, scriptIds, ownerIdInput) => {
        get().updateTab(id, { scriptIds }, ownerIdInput)
      },

      addBrowserTabCustomScript: (id, input, ownerIdInput) => {
        const scriptId = `custom-script-${++customScriptCounter}`
        const script = { ...input, id: scriptId }
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: ownerState.tabs.map(tab =>
              tab.id === id && tab.kind === 'browser'
                ? ({
                    ...tab,
                    customScripts: [...tab.customScripts, script],
                  } satisfies BrowserWebTab)
                : tab),
          })
        })
        return scriptId
      },

      openWorkspaceFileTab: ({ workspaceId, path, view, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const existing = getOwnerState(get(), ownerId).tabs.find(
          tab =>
            tab.kind === 'workspace-file'
            && tab.workspaceId === workspaceId
            && tab.path === path
            && tab.view === view,
        )
        if (existing) {
          get().setActiveTab(existing.id, ownerId)
          return existing.id
        }
        const tab: BrowserWorkspaceFileTab = {
          kind: 'workspace-file',
          id: `legacy-workspace-file-${++localTabCounter}`,
          workspaceId,
          path,
          view,
          title: path.split('/').filter(Boolean).at(-1) ?? path,
          loading: false,
          favicon: null,
        }
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
      },

      openWorkspaceDiffTab: ({ workspaceId, paths, title, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab: BrowserWorkspaceDiffTab = {
          kind: 'workspace-diff',
          id: `legacy-workspace-diff-${++localTabCounter}`,
          workspaceId,
          paths,
          title:
            title
            ?? (paths?.length === 1
              ? (paths[0]?.split('/').filter(Boolean).at(-1) ?? 'Changes')
              : 'Changes'),
          loading: false,
          favicon: null,
        }
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
      },

      openSubagentTab: ({ sessionId, threadId, agentName, agentRole, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const existing = getOwnerState(get(), ownerId).tabs.find(
          tab => tab.kind === 'subagent' && tab.threadId === threadId && tab.sessionId === sessionId,
        )
        if (existing) {
          get().setActiveTab(existing.id, ownerId)
          return existing.id
        }
        const tab: BrowserSubagentTab = {
          kind: 'subagent',
          id: `subagent-${threadId}-${++localTabCounter}`,
          sessionId,
          threadId,
          agentName,
          agentRole: agentRole ?? null,
          title: agentName,
          loading: false,
          favicon: null,
        }
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
      },

      requestScrollToFilePath: ({ path, tabId }) => {
        set((state) => {
          const ownerEntry = Object.entries(state.owners).find(([, ownerState]) =>
            ownerState?.tabs.some(tab => tab.id === tabId))
          const ownerId = ownerEntry?.[0] ?? state.activeOwnerId
          const ownerState = ownerEntry?.[1] ?? getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            scrollToFilePath: { path, tabId, nonce: Date.now() },
          })
        })
      },
      clearScrollToFilePath: (ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            scrollToFilePath: null,
          })
        })
      },
    }),
    {
      name: BROWSER_PANEL_STORAGE_KEY,
      storage: persistStorage,
      partialize: state => ({
        recentHistoryByOwnerId: state.recentHistoryByOwnerId,
      }),
      merge: (persisted, current) => ({
        ...current,
        recentHistoryByOwnerId:
          (
            persisted as
            | { recentHistoryByOwnerId?: Record<string, BrowserHistoryEntry[]> }
            | undefined
          )?.recentHistoryByOwnerId ?? {},
      }),
    },
  ),
)

function isBrowserPanelTabShortcutPayload(
  payload: unknown,
): payload is BrowserPanelTabShortcutInput {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<BrowserPanelTabShortcutInput>
  return (
    typeof candidate.key === 'string'
    && typeof candidate.metaKey === 'boolean'
    && typeof candidate.altKey === 'boolean'
    && typeof candidate.ctrlKey === 'boolean'
    && typeof candidate.shiftKey === 'boolean'
  )
}

export function selectOwnerBrowserState(ownerId: string) {
  return (store: BrowserPanelState): ThreadBrowserState | null =>
    store.owners[normalizeBrowserPanelOwnerId(ownerId)]?.threadState ?? null
}

export function selectOwnerBrowserHistory(ownerId: string) {
  return (store: BrowserPanelState): BrowserHistoryEntry[] =>
    store.recentHistoryByOwnerId[normalizeBrowserPanelOwnerId(ownerId)] ?? EMPTY_BROWSER_HISTORY
}

export function handleBrowserPanelTabShortcutInput(
  input: BrowserPanelTabShortcutInput,
  options: {
    panelOpen: boolean
    ownerId?: string | null
    onCloseLastTab?: (ownerId: string) => void
  },
): boolean {
  if (!options.panelOpen) {
    return false
  }

  const isCommandOnly = input.metaKey && !input.altKey && !input.ctrlKey && !input.shiftKey
  if (!isCommandOnly) {
    return false
  }

  const state = useBrowserPanelStore.getState()
  const ownerId = normalizeBrowserPanelOwnerId(options.ownerId ?? state.activeOwnerId)
  const ownerState = getOwnerState(state, ownerId)
  const currentTab = ownerState.tabs.find(tab => tab.id === ownerState.activeTabId)
  if (!currentTab) {
    return false
  }

  const key = input.key.toLowerCase()
  if (key === 'w') {
    const closeResult = state.closeTab(currentTab.id, ownerId)
    if (closeResult.closedLastTab) {
      options.onCloseLastTab?.(ownerId)
    }
    return true
  }

  if (!BROWSER_PANEL_TAB_SHORTCUT_KEYS.has(key)) {
    return false
  }

  const targetIndex = key === '0' ? 9 : Number.parseInt(key, 10) - 1
  const targetTab = ownerState.tabs[targetIndex]
  if (targetTab) {
    state.setActiveTab(targetTab.id, ownerId)
  }
  return true
}

export function handleBrowserPanelTabShortcutPayload(
  payload: unknown,
  options: {
    panelOpen: boolean
    ownerId?: string | null
    onCloseLastTab?: (ownerId: string) => void
  },
): boolean {
  if (!isBrowserPanelTabShortcutPayload(payload)) {
    return false
  }

  return handleBrowserPanelTabShortcutInput(payload, options)
}

export function handleBrowserPanelTabShortcut(
  event: KeyboardEvent,
  options: {
    panelOpen: boolean
    ownerId?: string | null
    onCloseLastTab?: (ownerId: string) => void
  },
): boolean {
  const handled = handleBrowserPanelTabShortcutInput(event, options)
  if (!handled) {
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  return true
}
