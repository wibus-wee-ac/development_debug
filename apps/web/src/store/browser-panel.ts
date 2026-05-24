import { create } from 'zustand'

export interface BrowserWebTab {
  kind: 'browser'
  id: string
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

let tabCounter = 0
const BROWSER_PANEL_TAB_SHORTCUT_KEYS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
export const BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL = 'browser-panel:webview-tab-shortcut'

interface BrowserPanelTabShortcutInput {
  key: string
  metaKey: boolean
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

interface BrowserPanelState {
  tabs: BrowserPanelTab[]
  activeTabId: string | null
  requestedTab: { id: number, url?: string } | null
  scrollToFilePath: { path: string, tabId: string, nonce: number } | null
  createTab: (url?: string) => string
  openWorkspaceFileTab: (input: { workspaceId: string, path: string, view: BrowserWorkspaceFileTab['view'] }) => string
  openWorkspaceDiffTab: (input: { workspaceId: string, paths?: string[], title?: string }) => string
  requestScrollToFilePath: (input: { path: string, tabId: string }) => void
  clearScrollToFilePath: () => void
  requestTab: (url?: string) => void
  fulfillRequestedTab: (id: number) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, updates: Partial<BrowserWebTab>) => void
  navigateTo: (id: string, url: string) => void
}

function createBrowserTab(url?: string): BrowserWebTab {
  return {
    kind: 'browser',
    id: `bt-${tabCounter++}`,
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

export const useBrowserPanelStore = create<BrowserPanelState>()((set, _get) => ({
  tabs: [],
  activeTabId: null,
  requestedTab: null,
  scrollToFilePath: null,

  createTab: (url) => {
    const tab = createBrowserTab(url)
    set(s => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }))
    return tab.id
  },

  openWorkspaceFileTab: ({ workspaceId, path, view }) => {
    const existingTab = _get().tabs.find(tab =>
      tab.kind === 'workspace-file'
      && tab.workspaceId === workspaceId
      && tab.path === path)

    if (existingTab) {
      set((s) => {
        if (
          s.activeTabId === existingTab.id
          && existingTab.kind === 'workspace-file'
          && existingTab.view === view
        ) {
          return s
        }
        return {
          tabs: s.tabs.map((tab) => {
            if (tab.id !== existingTab.id || tab.kind !== 'workspace-file' || tab.view === view) {
              return tab
            }
            return { ...tab, view }
          }),
          activeTabId: existingTab.id,
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
    set(s => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }))
    return tab.id
  },

  openWorkspaceDiffTab: ({ workspaceId, paths, title }) => {
    const pathsKey = paths ? [...paths].sort().join(',') : ''
    const existingTab = _get().tabs.find(tab =>
      tab.kind === 'workspace-diff'
      && tab.workspaceId === workspaceId
      && (tab.paths ? [...tab.paths].sort().join(',') : '') === pathsKey)

    if (existingTab) {
      set(s => (s.activeTabId === existingTab.id ? s : { activeTabId: existingTab.id }))
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
    set(s => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }))
    return tab.id
  },

  requestScrollToFilePath: ({ path, tabId }) => {
    set({ scrollToFilePath: { path, tabId, nonce: Date.now() } })
  },

  clearScrollToFilePath: () => {
    set({ scrollToFilePath: null })
  },

  requestTab: (url) => {
    set({ requestedTab: { id: Date.now(), url } })
  },

  fulfillRequestedTab: (id) => {
    set((s) => {
      if (s.requestedTab?.id !== id) {
        return s
      }
      const tab = createBrowserTab(s.requestedTab.url)
      return {
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        requestedTab: null,
      }
    })
  },

  closeTab: (id) => {
    set((s) => {
      const tabs = s.tabs.filter(t => t.id !== id)
      const activeTabId = s.activeTabId === id
        ? (tabs.length > 0 ? tabs.at(-1)!.id : null)
        : s.activeTabId
      return { tabs, activeTabId }
    })
  },

  setActiveTab: (id) => {
    set(s => (s.activeTabId === id ? s : { activeTabId: id }))
  },

  updateTab: (id, updates) => {
    set(s => ({
      tabs: s.tabs.map(t => (t.id === id && t.kind === 'browser' ? { ...t, ...updates } : t)),
    }))
  },

  navigateTo: (id, url) => {
    set(s => ({
      tabs: s.tabs.map(t => (t.id === id && t.kind === 'browser' ? { ...t, url } : t)),
    }))
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

export function handleBrowserPanelTabShortcutInput(input: BrowserPanelTabShortcutInput, options: { panelOpen: boolean }): boolean {
  if (!options.panelOpen) {
    return false
  }

  const isCommandOnly = input.metaKey && !input.altKey && !input.ctrlKey && !input.shiftKey
  if (!isCommandOnly) {
    return false
  }

  const state = useBrowserPanelStore.getState()
  const currentTab = state.tabs.find(tab => tab.id === state.activeTabId)
  if (currentTab?.kind !== 'browser') {
    return false
  }

  const key = input.key.toLowerCase()
  if (key === 'w') {
    state.closeTab(currentTab.id)
    return true
  }

  if (!BROWSER_PANEL_TAB_SHORTCUT_KEYS.has(key)) {
    return false
  }

  const targetIndex = key === '0' ? 9 : Number.parseInt(key, 10) - 1
  const targetTab = state.tabs[targetIndex]
  if (targetTab) {
    state.setActiveTab(targetTab.id)
  }
  return true
}

export function handleBrowserPanelTabShortcutPayload(payload: unknown, options: { panelOpen: boolean }): boolean {
  if (!isBrowserPanelTabShortcutPayload(payload)) {
    return false
  }

  return handleBrowserPanelTabShortcutInput(payload, options)
}

export function handleBrowserPanelTabShortcut(event: KeyboardEvent, options: { panelOpen: boolean }): boolean {
  const handled = handleBrowserPanelTabShortcutInput(event, options)
  if (!handled) {
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  return true
}
