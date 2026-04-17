// Input: zustand
// Output: useSidebarNavStore hook for drill-in navigation state
// Position: Global sidebar navigation state — controls which "view" the sidebar shows

import { create } from 'zustand'

export type SidebarView = 'main' | 'settings'

interface SidebarNavState {
  view: SidebarView
  /** Settings sub-section currently active */
  settingsSection: string
  navigateTo: (view: SidebarView) => void
  setSettingsSection: (section: string) => void
  back: () => void
}

export const useSidebarNavStore = create<SidebarNavState>()(set => ({
  view: 'main',
  settingsSection: 'appearance',
  navigateTo: view => set({ view }),
  setSettingsSection: section => set({ settingsSection: section }),
  back: () => set({ view: 'main' }),
}))
