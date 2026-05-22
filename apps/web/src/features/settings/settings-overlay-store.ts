import { create } from 'zustand'

export interface ChronicleFocusTarget {
  type: 'memory' | 'knowledge'
  id: string
}

interface SettingsOverlayState {
  /** The tab id that currently has settings overlaid on it, or null if no settings are open. */
  settingsTabId: string | null
  settingsSection: string
  chronicleFocusTarget: ChronicleFocusTarget | null
  openSettings: (tabId: string) => void
  closeSettings: () => void
  setSettingsSection: (section: string) => void
  setChronicleFocusTarget: (target: ChronicleFocusTarget | null) => void
  clearChronicleFocusTarget: () => void
}

export const useSettingsOverlayStore = create<SettingsOverlayState>()(set => ({
  settingsTabId: null,
  settingsSection: 'appearance',
  chronicleFocusTarget: null,
  openSettings: settingsTabId => set({ settingsTabId }),
  closeSettings: () => set({ settingsTabId: null }),
  setSettingsSection: settingsSection => set({ settingsSection }),
  setChronicleFocusTarget: chronicleFocusTarget => set({ chronicleFocusTarget }),
  clearChronicleFocusTarget: () => set({ chronicleFocusTarget: null }),
}))
