import { create } from 'zustand'

import { markCradlePerformance } from '~/lib/perf-monitor'

const SETTINGS_AGENTS_SECTION = 'agents'
const SETTINGS_APPEARANCE_SECTION = 'appearance'
const SETTINGS_CHRONICLE_SECTION = 'chronicle'
const SETTINGS_DESKTOP_SECTION = 'desktop'
const SETTINGS_JARVIS_SECTION = 'jarvis'
const SETTINGS_PROVIDERS_SECTION = 'providers'
const SETTINGS_SKILLS_SECTION = 'skills'
const SETTINGS_SUPPORT_SECTION = 'support'

function markSettingsSectionRenderRequested(section: string): void {
  if (section === SETTINGS_APPEARANCE_SECTION) {
    markCradlePerformance('cradle:settings-appearance-render-requested')
    return
  }

  if (section === SETTINGS_AGENTS_SECTION) {
    markCradlePerformance('cradle:settings-agents-render-requested')
    return
  }

  if (section === SETTINGS_CHRONICLE_SECTION) {
    markCradlePerformance('cradle:settings-chronicle-render-requested')
    return
  }

  if (section === SETTINGS_DESKTOP_SECTION) {
    markCradlePerformance('cradle:settings-desktop-render-requested')
    return
  }

  if (section === SETTINGS_JARVIS_SECTION) {
    markCradlePerformance('cradle:settings-jarvis-render-requested')
    return
  }

  if (section === SETTINGS_PROVIDERS_SECTION) {
    markCradlePerformance('cradle:settings-providers-render-requested')
    return
  }

  if (section === SETTINGS_SKILLS_SECTION) {
    markCradlePerformance('cradle:settings-skills-render-requested')
    return
  }

  if (section === SETTINGS_SUPPORT_SECTION) {
    markCradlePerformance('cradle:settings-support-render-requested')
  }
}

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
  openSettings: settingsTabId => set((state) => {
    markSettingsSectionRenderRequested(state.settingsSection)
    return { settingsTabId }
  }),
  closeSettings: () => set({ settingsTabId: null }),
  setSettingsSection: settingsSection => {
    markSettingsSectionRenderRequested(settingsSection)
    set({ settingsSection })
  },
  setChronicleFocusTarget: chronicleFocusTarget => set({ chronicleFocusTarget }),
  clearChronicleFocusTarget: () => set({ chronicleFocusTarget: null }),
}))
