import { create } from 'zustand'

export interface ChronicleFocusTarget {
  type: 'memory' | 'knowledge'
  id: string
}

export interface AgentFocusTarget {
  id: string
}

interface SettingsOverlayState {
  /** The tab id that currently has settings overlaid on it, or null if no settings are open. */
  settingsTabId: string | null
  settingsSection: string
  chronicleFocusTarget: ChronicleFocusTarget | null
  agentFocusTarget: AgentFocusTarget | null
  openSettings: (tabId: string) => void
  closeSettings: () => void
  setSettingsSection: (section: string) => void
  setChronicleFocusTarget: (target: ChronicleFocusTarget | null) => void
  clearChronicleFocusTarget: () => void
  setAgentFocusTarget: (target: AgentFocusTarget | null) => void
  clearAgentFocusTarget: () => void
}

export const useSettingsOverlayStore = create<SettingsOverlayState>()(set => ({
  settingsTabId: null,
  settingsSection: 'appearance',
  chronicleFocusTarget: null,
  agentFocusTarget: null,
  openSettings: settingsTabId => set({ settingsTabId }),
  closeSettings: () => set({ settingsTabId: null }),
  setSettingsSection: settingsSection => set({ settingsSection }),
  setChronicleFocusTarget: chronicleFocusTarget => set({ chronicleFocusTarget }),
  clearChronicleFocusTarget: () => set({ chronicleFocusTarget: null }),
  setAgentFocusTarget: agentFocusTarget => set({ agentFocusTarget }),
  clearAgentFocusTarget: () => set({ agentFocusTarget: null }),
}))
