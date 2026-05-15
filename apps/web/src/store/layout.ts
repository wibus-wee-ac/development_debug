// Input: zustand, zustand/middleware
// Output: useLayoutStore hook for persisted panel and sidebar layout state
// Position: Renderer global UI layout store used across the application shell

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from './persist-storage'

interface LayoutState {
  sidebarWidth: number
  sidebarCollapsed: boolean
  asideWidth: number
  bottomPanelHeight: number
  asideOpen: boolean
  asideActiveTab: string
  bottomPanelOpen: boolean
  isSettings: boolean
  settingsSection: string
  jarvisExpanded: boolean
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
  openSettings: () => void
  closeSettings: () => void
  setSettingsSection: (section: string) => void
  setJarvisExpanded: (expanded: boolean) => void
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    set => ({
      sidebarWidth: 260,
      sidebarCollapsed: false,
      asideWidth: 280,
      bottomPanelHeight: 200,
      asideOpen: false,
      asideActiveTab: 'files',
      bottomPanelOpen: false,
      isSettings: false,
      settingsSection: 'appearance',
      jarvisExpanded: false,
      setSidebarWidth: sidebarWidth => set({ sidebarWidth }),
      setSidebarCollapsed: sidebarCollapsed => set({ sidebarCollapsed }),
      toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setAsideWidth: asideWidth => set({ asideWidth }),
      setBottomPanelHeight: bottomPanelHeight => set({ bottomPanelHeight }),
      toggleAside: () => set(s => ({ asideOpen: !s.asideOpen })),
      setAsideActiveTab: (asideActiveTab: string) => set({ asideActiveTab }),
      openAsideTab: (tab: string) => set({ asideOpen: true, asideActiveTab: tab }),
      toggleBottomPanel: () => set(s => ({ bottomPanelOpen: !s.bottomPanelOpen })),
      setBottomPanelOpen: (open: boolean) => set({ bottomPanelOpen: open }),
      openSettings: () => set({ isSettings: true }),
      closeSettings: () => set({ isSettings: false }),
      setSettingsSection: (settingsSection: string) => set({ settingsSection }),
      setJarvisExpanded: (jarvisExpanded: boolean) => set({ jarvisExpanded }),
    }),
    {
      name: 'cradle:layout:v1',
      storage: persistStorage,
      version: 1,
      partialize: state => ({
        sidebarWidth: state.sidebarWidth,
        sidebarCollapsed: state.sidebarCollapsed,
        asideWidth: state.asideWidth,
        bottomPanelHeight: state.bottomPanelHeight,
        asideOpen: state.asideOpen,
        bottomPanelOpen: state.bottomPanelOpen,
      }),
    },
  ),
)
