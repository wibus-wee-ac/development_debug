import { create } from 'zustand'

export interface BrowserWebTab {
  kind: 'browser'
  id: string
  sessionId: string | null
  sessionTitle: string | null
  scriptIds: string[]
  customScripts: BrowserPanelCustomScript[]
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
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

export type BrowserPanelTab = BrowserWebTab | BrowserWorkspaceFileTab | BrowserWorkspaceDiffTab

export type BrowserPanelScriptRunAt = 'document-start' | 'document-end' | 'document-idle'

export interface BrowserPanelCustomScript {
  id: string
  label: string
  runAt: BrowserPanelScriptRunAt
  source: string
}

export interface BrowserPanelCloseTabResult {
  closed: boolean
  closedLastTab: boolean
}

let tabCounter = 0
let customScriptCounter = 0
const BROWSER_PANEL_TAB_SHORTCUT_KEYS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
export const BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL = 'browser-panel:webview-tab-shortcut'
export const DEFAULT_BROWSER_PANEL_OWNER_ID = 'global'

interface BrowserPanelTabShortcutInput {
  key: string
  metaKey: boolean
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

interface BrowserPanelState {
  activeOwnerId: string
  owners: Record<string, BrowserPanelOwnerState>
  tabs: BrowserPanelTab[]
  activeTabId: string | null
  requestedTab: { id: number, url?: string, sessionId?: string | null, sessionTitle?: string | null } | null
  scrollToFilePath: { path: string, tabId: string, nonce: number } | null
  setActiveOwner: (ownerId: string | null | undefined) => void
  createTab: (url?: string, source?: BrowserTabSource, ownerId?: string | null) => string
  openWorkspaceFileTab: (input: { workspaceId: string, path: string, view: BrowserWorkspaceFileTab['view'], ownerId?: string | null }) => string
  openWorkspaceDiffTab: (input: { workspaceId: string, paths?: string[], title?: string, ownerId?: string | null }) => string
  requestScrollToFilePath: (input: { path: string, tabId: string }) => void
  clearScrollToFilePath: (ownerId?: string | null) => void
  requestTab: (url?: string, source?: BrowserTabSource, ownerId?: string | null) => void
  fulfillRequestedTab: (id: number, ownerId?: string | null) => void
  closeTab: (id: string, ownerId?: string | null) => BrowserPanelCloseTabResult
  setActiveTab: (id: string, ownerId?: string | null) => void
  updateTab: (id: string, updates: Partial<BrowserWebTab>, ownerId?: string | null) => void
  navigateTo: (id: string, url: string, ownerId?: string | null) => void
  setBrowserTabScripts: (id: string, scriptIds: string[], ownerId?: string | null) => void
  addBrowserTabCustomScript: (id: string, input: Omit<BrowserPanelCustomScript, 'id'>, ownerId?: string | null) => string
}

interface BrowserPanelOwnerState {
  tabs: BrowserPanelTab[]
  activeTabId: string | null
  requestedTab: { id: number, url?: string, sessionId?: string | null, sessionTitle?: string | null } | null
  scrollToFilePath: { path: string, tabId: string, nonce: number } | null
}

export interface BrowserTabSource {
  sessionId?: string | null
  sessionTitle?: string | null
}

function normalizeBrowserTabSource(source?: BrowserTabSource): Required<BrowserTabSource> {
  return {
    sessionId: source?.sessionId ?? null,
    sessionTitle: source?.sessionTitle ?? null,
  }
}

function createBrowserTab(url?: string, source?: BrowserTabSource): BrowserWebTab {
  const normalizedSource = normalizeBrowserTabSource(source)
  return {
    kind: 'browser',
    id: `bt-${tabCounter++}`,
    sessionId: normalizedSource.sessionId,
    sessionTitle: normalizedSource.sessionTitle,
    scriptIds: [],
    customScripts: [],
    url: url ?? 'about:blank',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    favicon: null,
  }
}

function getWorkspaceFileTabTitle(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function normalizeBrowserPanelOwnerId(ownerId: string | null | undefined): string {
  return ownerId || DEFAULT_BROWSER_PANEL_OWNER_ID
}

function createEmptyOwnerState(): BrowserPanelOwnerState {
  return {
    tabs: [],
    activeTabId: null,
    requestedTab: null,
    scrollToFilePath: null,
  }
}

function getBrowserPanelOwnerState(state: BrowserPanelState, ownerId: string): BrowserPanelOwnerState {
  return state.owners[ownerId] ?? createEmptyOwnerState()
}

function projectBrowserPanelOwnerState(ownerState: BrowserPanelOwnerState) {
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
  const owners = {
    ...state.owners,
    [ownerId]: ownerState,
  }
  return {
    owners,
    ...(state.activeOwnerId === ownerId ? projectBrowserPanelOwnerState(ownerState) : {}),
  }
}

export const useBrowserPanelStore = create<BrowserPanelState>()((set, _get) => ({
  activeOwnerId: DEFAULT_BROWSER_PANEL_OWNER_ID,
  owners: {},
  tabs: [],
  activeTabId: null,
  requestedTab: null,
  scrollToFilePath: null,

  setActiveOwner: (ownerIdInput) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput)
    set((s) => {
      if (s.activeOwnerId === ownerId) {
        return s
      }
      return {
        activeOwnerId: ownerId,
        ...projectBrowserPanelOwnerState(getBrowserPanelOwnerState(s, ownerId)),
      }
    })
  },

  createTab: (url, source, ownerIdInput) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? _get().activeOwnerId)
    const tab = createBrowserTab(url, source)
    set((s) => {
      const ownerState = getBrowserPanelOwnerState(s, ownerId)
      return applyOwnerState(s, ownerId, {
        ...ownerState,
        tabs: [...ownerState.tabs, tab],
        activeTabId: tab.id,
      })
    })
    return tab.id
  },

  openWorkspaceFileTab: ({ workspaceId, path, view, ownerId: ownerIdInput }) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? _get().activeOwnerId)
    const ownerState = getBrowserPanelOwnerState(_get(), ownerId)
    const existingTab = ownerState.tabs.find(tab =>
      tab.kind === 'workspace-file'
      && tab.workspaceId === workspaceId
      && tab.path === path)

    if (existingTab) {
      set((s) => {
        if (
          getBrowserPanelOwnerState(s, ownerId).activeTabId === existingTab.id
          && existingTab.kind === 'workspace-file'
          && existingTab.view === view
        ) {
          return s
        }
        const currentOwnerState = getBrowserPanelOwnerState(s, ownerId)
        return {
          ...applyOwnerState(s, ownerId, {
            ...currentOwnerState,
            tabs: currentOwnerState.tabs.map((tab) => {
              if (tab.id !== existingTab.id || tab.kind !== 'workspace-file' || tab.view === view) {
                return tab
              }
              return { ...tab, view }
            }),
            activeTabId: existingTab.id,
          }),
        }
      })
      return existingTab.id
    }

    const tab: BrowserWorkspaceFileTab = {
      kind: 'workspace-file',
      id: `bt-${tabCounter++}`,
      workspaceId,
      path,
      view,
      title: getWorkspaceFileTabTitle(path),
      loading: false,
      favicon: null,
    }
    set((s) => {
      const currentOwnerState = getBrowserPanelOwnerState(s, ownerId)
      return applyOwnerState(s, ownerId, {
        ...currentOwnerState,
        tabs: [...currentOwnerState.tabs, tab],
        activeTabId: tab.id,
      })
    })
    return tab.id
  },

  openWorkspaceDiffTab: ({ workspaceId, paths, title, ownerId: ownerIdInput }) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? _get().activeOwnerId)
    const ownerState = getBrowserPanelOwnerState(_get(), ownerId)
    const pathsKey = paths ? [...paths].sort().join(',') : ''
    const existingTab = ownerState.tabs.find(tab =>
      tab.kind === 'workspace-diff'
      && tab.workspaceId === workspaceId
      && (tab.paths ? [...tab.paths].sort().join(',') : '') === pathsKey)

    if (existingTab) {
      set((s) => {
        const currentOwnerState = getBrowserPanelOwnerState(s, ownerId)
        return currentOwnerState.activeTabId === existingTab.id
          ? s
          : applyOwnerState(s, ownerId, {
              ...currentOwnerState,
              activeTabId: existingTab.id,
            })
      })
      return existingTab.id
    }

    const tab: BrowserWorkspaceDiffTab = {
      kind: 'workspace-diff',
      id: `bt-${tabCounter++}`,
      workspaceId,
      paths,
      title: title ?? (paths && paths.length === 1 ? getWorkspaceFileTabTitle(paths[0]) : 'Changes'),
      loading: false,
      favicon: null,
    }
    set((s) => {
      const currentOwnerState = getBrowserPanelOwnerState(s, ownerId)
      return applyOwnerState(s, ownerId, {
        ...currentOwnerState,
        tabs: [...currentOwnerState.tabs, tab],
        activeTabId: tab.id,
      })
    })
    return tab.id
  },

  requestScrollToFilePath: ({ path, tabId }) => {
    set((s) => {
      const ownerEntry = Object.entries(s.owners).find(([, ownerState]) =>
        ownerState.tabs.some(tab => tab.id === tabId))
      const ownerId = ownerEntry?.[0] ?? s.activeOwnerId
      const ownerState = ownerEntry?.[1] ?? getBrowserPanelOwnerState(s, ownerId)
      return applyOwnerState(s, ownerId, {
        ...ownerState,
        scrollToFilePath: { path, tabId, nonce: Date.now() },
      })
    })
  },

  clearScrollToFilePath: (ownerIdInput) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? _get().activeOwnerId)
    set((s) => {
      const ownerState = getBrowserPanelOwnerState(s, ownerId)
      return applyOwnerState(s, ownerId, {
        ...ownerState,
        scrollToFilePath: null,
      })
    })
  },

  requestTab: (url, source, ownerIdInput) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? _get().activeOwnerId)
    set((s) => {
      const ownerState = getBrowserPanelOwnerState(s, ownerId)
      return applyOwnerState(s, ownerId, {
        ...ownerState,
        requestedTab: { id: Date.now(), url, ...normalizeBrowserTabSource(source) },
      })
    })
  },

  fulfillRequestedTab: (id, ownerIdInput) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? _get().activeOwnerId)
    set((s) => {
      const ownerState = getBrowserPanelOwnerState(s, ownerId)
      if (ownerState.requestedTab?.id !== id) {
        return s
      }
      const tab = createBrowserTab(ownerState.requestedTab.url, {
        sessionId: ownerState.requestedTab.sessionId,
        sessionTitle: ownerState.requestedTab.sessionTitle,
      })
      return applyOwnerState(s, ownerId, {
        ...ownerState,
        tabs: [...ownerState.tabs, tab],
        activeTabId: tab.id,
        requestedTab: null,
      })
    })
  },

  closeTab: (id, ownerIdInput) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? _get().activeOwnerId)
    let result: BrowserPanelCloseTabResult = {
      closed: false,
      closedLastTab: false,
    }
    set((s) => {
      const ownerState = getBrowserPanelOwnerState(s, ownerId)
      const tabExists = ownerState.tabs.some(t => t.id === id)
      if (!tabExists) {
        return s
      }
      const tabs = ownerState.tabs.filter(t => t.id !== id)
      const activeTabId = ownerState.activeTabId === id
        ? (tabs.length > 0 ? tabs.at(-1)!.id : null)
        : ownerState.activeTabId
      result = {
        closed: true,
        closedLastTab: tabs.length === 0,
      }
      return applyOwnerState(s, ownerId, {
        ...ownerState,
        tabs,
        activeTabId,
      })
    })
    return result
  },

  setActiveTab: (id, ownerIdInput) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? _get().activeOwnerId)
    set((s) => {
      const ownerState = getBrowserPanelOwnerState(s, ownerId)
      return ownerState.activeTabId === id
        ? s
        : applyOwnerState(s, ownerId, { ...ownerState, activeTabId: id })
    })
  },

  updateTab: (id, updates, ownerIdInput) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? _get().activeOwnerId)
    set((s) => {
      const ownerState = getBrowserPanelOwnerState(s, ownerId)
      return applyOwnerState(s, ownerId, {
        ...ownerState,
        tabs: ownerState.tabs.map(t => (t.id === id && t.kind === 'browser' ? { ...t, ...updates } : t)),
      })
    })
  },

  navigateTo: (id, url, ownerIdInput) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? _get().activeOwnerId)
    set((s) => {
      const ownerState = getBrowserPanelOwnerState(s, ownerId)
      return applyOwnerState(s, ownerId, {
        ...ownerState,
        tabs: ownerState.tabs.map(t => (t.id === id && t.kind === 'browser' ? { ...t, url } : t)),
      })
    })
  },

  setBrowserTabScripts: (id, scriptIds, ownerIdInput) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? _get().activeOwnerId)
    set((s) => {
      const ownerState = getBrowserPanelOwnerState(s, ownerId)
      return applyOwnerState(s, ownerId, {
        ...ownerState,
        tabs: ownerState.tabs.map(t => (t.id === id && t.kind === 'browser' ? { ...t, scriptIds } : t)),
      })
    })
  },

  addBrowserTabCustomScript: (id, input, ownerIdInput) => {
    const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? _get().activeOwnerId)
    const scriptId = `custom-script-${customScriptCounter++}`
    const script: BrowserPanelCustomScript = {
      id: scriptId,
      ...input,
    }
    set((s) => {
      const ownerState = getBrowserPanelOwnerState(s, ownerId)
      return applyOwnerState(s, ownerId, {
        ...ownerState,
        tabs: ownerState.tabs.map(t => (t.id === id && t.kind === 'browser'
        ? { ...t, customScripts: [...t.customScripts, script] }
        : t)),
      })
    })
    return scriptId
  },
}))

function isBrowserPanelTabShortcutPayload(payload: unknown): payload is BrowserPanelTabShortcutInput {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<BrowserPanelTabShortcutInput>
  return typeof candidate.key === 'string'
    && typeof candidate.metaKey === 'boolean'
    && typeof candidate.altKey === 'boolean'
    && typeof candidate.ctrlKey === 'boolean'
    && typeof candidate.shiftKey === 'boolean'
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
  const ownerState = getBrowserPanelOwnerState(state, ownerId)
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
