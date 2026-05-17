// Input: zustand
// Output: useSettingsOverlayStore hook for settings feature overlay state
// Position: Settings feature-owned UI state separated from shell layout ownership

import { create } from 'zustand'

interface SettingsOverlayState {
  /** The tab id that currently has settings overlaid on it, or null if no settings are open. */
  settingsTabId: string | null
  settingsSection: string
  openSettings: (tabId: string) => void
  closeSettings: () => void
  setSettingsSection: (section: string) => void
}

export const useSettingsOverlayStore = create<SettingsOverlayState>()(set => ({
  settingsTabId: null,
  settingsSection: 'appearance',
  openSettings: settingsTabId => set({ settingsTabId }),
  closeSettings: () => set({ settingsTabId: null }),
  setSettingsSection: settingsSection => set({ settingsSection }),
}))
