// Input: zustand
// Output: useBrowserPanelStore hook for browser panel tab state
// Position: Renderer store for the built-in browser panel (Electron-only feature)

import { create } from 'zustand'

export interface BrowserTab {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  favicon: string | null
}

let tabCounter = 0

interface BrowserPanelState {
  tabs: BrowserTab[]
  activeTabId: string | null
  createTab: (url?: string) => string
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, updates: Partial<BrowserTab>) => void
  navigateTo: (id: string, url: string) => void
}

export const useBrowserPanelStore = create<BrowserPanelState>()((set, _get) => ({
  tabs: [],
  activeTabId: null,

  createTab: (url) => {
    const id = `bt-${tabCounter++}`
    const tab: BrowserTab = {
      id,
      url: url ?? 'about:blank',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      favicon: null,
    }
    set(s => ({
      tabs: [...s.tabs, tab],
      activeTabId: id,
    }))
    return id
  },

  closeTab: (id) => {
    set((s) => {
      const tabs = s.tabs.filter(t => t.id !== id)
      const activeTabId = s.activeTabId === id
        ? (tabs.length > 0 ? tabs[tabs.length - 1].id : null)
        : s.activeTabId
      return { tabs, activeTabId }
    })
  },

  setActiveTab: (id) => {
    set({ activeTabId: id })
  },

  updateTab: (id, updates) => {
    set(s => ({
      tabs: s.tabs.map(t => (t.id === id ? { ...t, ...updates } : t)),
    }))
  },

  navigateTo: (id, url) => {
    set(s => ({
      tabs: s.tabs.map(t => (t.id === id ? { ...t, url } : t)),
    }))
  },
}))
