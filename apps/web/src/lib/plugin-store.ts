import { create } from 'zustand'
import type { PanelRegistration, CommandRegistration } from '@cradle/plugin-sdk/web'

interface PluginStoreState {
  panels: PanelRegistration[]
  commands: CommandRegistration[]
}

interface PluginStoreActions {
  registerPanel(panel: PanelRegistration): () => void
  registerCommand(cmd: CommandRegistration): () => void
}

export const usePluginStore = create<PluginStoreState & PluginStoreActions>((set) => ({
  panels: [],
  commands: [],
  registerPanel(panel) {
    set((s) => ({ panels: [...s.panels, panel] }))
    return () => set((s) => ({ panels: s.panels.filter((p) => p.id !== panel.id) }))
  },
  registerCommand(cmd) {
    set((s) => ({ commands: [...s.commands, cmd] }))
    return () => set((s) => ({ commands: s.commands.filter((c) => c.id !== cmd.id) }))
  },
}))
