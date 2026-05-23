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

export type BrowserPanelTab = BrowserWebTab | BrowserWorkspaceFileTab

let tabCounter = 0

interface BrowserPanelState {
  tabs: BrowserPanelTab[]
  activeTabId: string | null
  requestedTab: { id: number, url?: string } | null
  createTab: (url?: string) => string
  openWorkspaceFileTab: (input: { workspaceId: string, path: string, view: BrowserWorkspaceFileTab['view'] }) => string
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
      set(s => ({
        tabs: s.tabs.map((tab) => {
          if (tab.id !== existingTab.id || tab.kind !== 'workspace-file') {
            return tab
          }
          return { ...tab, view }
        }),
        activeTabId: existingTab.id,
      }))
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
    set({ activeTabId: id })
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
