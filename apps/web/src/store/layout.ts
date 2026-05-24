import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { isTearoffWindow, tearoffSessionId } from '~/lib/electron'

import { persistStorage } from './persist-storage'

interface LayoutState {
  sidebarWidth: number
  sidebarCollapsed: boolean
  asideWidth: number
  bottomPanelHeight: number
  asideOpen: boolean
  asideActiveTab: string
  bottomPanelOpen: boolean
  browserPanelOpen: boolean
  browserPanelRatio: number
  setSidebarWidth: (w: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setAsideWidth: (w: number) => void
  setBottomPanelHeight: (h: number) => void
  toggleAside: () => void
  setAsideActiveTab: (tab: string) => void
  openAsideTab: (tab: string) => void
  toggleBottomPanel: () => void
  setBottomPanelOpen: (open: boolean) => void
  toggleBrowserPanel: () => void
  setBrowserPanelOpen: (open: boolean) => void
  setBrowserPanelRatio: (r: number) => void
}

interface PersistedLayoutState {
  sidebarWidth?: number
  sidebarCollapsed?: boolean
  asideWidth?: number
  bottomPanelHeight?: number
  asideOpen?: boolean
  bottomPanelOpen?: boolean
  browserPanelRatio?: number
}

const layoutPersistKey = isTearoffWindow
  ? `cradle:layout:tearoff:${tearoffSessionId ?? 'unknown'}:v1`
  : 'cradle:layout:v1'

export const useLayoutStore = create<LayoutState>()(
  persist(
    set => ({
      sidebarWidth: 260,
      sidebarCollapsed: false,
      asideWidth: 280,
      bottomPanelHeight: 200,
      asideOpen: false,
      asideActiveTab: 'files',
      bottomPanelOpen: !isTearoffWindow,
      browserPanelOpen: false,
      browserPanelRatio: 0.4,
      setSidebarWidth: sidebarWidth => set({ sidebarWidth }),
      setSidebarCollapsed: sidebarCollapsed => set({ sidebarCollapsed }),
      toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setAsideWidth: asideWidth => set({ asideWidth }),
      setBottomPanelHeight: bottomPanelHeight => set({ bottomPanelHeight }),
      toggleAside: () => set(s => ({ asideOpen: !s.asideOpen })),
      setAsideActiveTab: (asideActiveTab: string) => set({ asideActiveTab }),
      openAsideTab: (tab: string) => set({ asideOpen: true, asideActiveTab: tab }),
      toggleBottomPanel: () => set(s => ({ bottomPanelOpen: !s.bottomPanelOpen })),
      setBottomPanelOpen: (open: boolean) => set(s => (s.bottomPanelOpen === open ? s : { bottomPanelOpen: open })),
      toggleBrowserPanel: () => set(s => ({ browserPanelOpen: !s.browserPanelOpen })),
      setBrowserPanelOpen: (open: boolean) => set(s => (s.browserPanelOpen === open ? s : { browserPanelOpen: open })),
      setBrowserPanelRatio: (r: number) => set((s) => {
        const browserPanelRatio = Math.max(0.2, Math.min(0.7, r))
        return s.browserPanelRatio === browserPanelRatio ? s : { browserPanelRatio }
      }),
    }),
    {
      name: layoutPersistKey,
      storage: persistStorage,
      version: 2,
      migrate: (persistedState, version) => {
        const state = persistedState as PersistedLayoutState
        if (isTearoffWindow) {
          return {
            ...state,
            asideOpen: false,
            bottomPanelOpen: false,
          }
        }
        if (version < 2) {
          return {
            ...state,
            bottomPanelOpen: true,
          }
        }
        return state
      },
      partialize: state => ({
        sidebarWidth: state.sidebarWidth,
        sidebarCollapsed: state.sidebarCollapsed,
        asideWidth: state.asideWidth,
        bottomPanelHeight: state.bottomPanelHeight,
        ...(isTearoffWindow
          ? {}
          : {
              asideOpen: state.asideOpen,
              bottomPanelOpen: state.bottomPanelOpen,
            }),
        browserPanelRatio: state.browserPanelRatio,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as PersistedLayoutState),
        ...(isTearoffWindow
          ? {
              asideOpen: false,
              bottomPanelOpen: false,
            }
          : {}),
      }),
    },
  ),
)
