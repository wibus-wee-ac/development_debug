import { create } from 'zustand'

export interface ChronicleFocusTarget {
  type: 'memory' | 'knowledge'
  id: string
}

export interface AgentFocusTarget {
  id: string
}

interface SettingsOverlayState {
  settingsSection: string
  chronicleFocusTarget: ChronicleFocusTarget | null
  agentFocusTarget: AgentFocusTarget | null
  setSettingsSection: (section: string) => void
  setChronicleFocusTarget: (target: ChronicleFocusTarget | null) => void
  clearChronicleFocusTarget: () => void
  setAgentFocusTarget: (target: AgentFocusTarget | null) => void
  clearAgentFocusTarget: () => void
}

export const useSettingsOverlayStore = create<SettingsOverlayState>()(set => ({
  settingsSection: 'appearance',
  chronicleFocusTarget: null,
  agentFocusTarget: null,
  setSettingsSection: settingsSection => set({ settingsSection }),
  setChronicleFocusTarget: chronicleFocusTarget => set({ chronicleFocusTarget }),
  clearChronicleFocusTarget: () => set({ chronicleFocusTarget: null }),
  setAgentFocusTarget: agentFocusTarget => set({ agentFocusTarget }),
  clearAgentFocusTarget: () => set({ agentFocusTarget: null }),
}))
