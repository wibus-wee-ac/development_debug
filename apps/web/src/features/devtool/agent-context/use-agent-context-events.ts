// Input: Agent Context devtool preload API, AgentContextEvent from @cradle/ipc, Zustand
// Output: Agent Context devtool store for the devtool pane
// Position: Core state layer for the Agent Context pane inside the devtool feature

import type { AgentContextEvent } from '@cradle/ipc'
import { create } from 'zustand'

const MAX_EVENTS = 500

interface AgentContextDevtoolState {
  events: AgentContextEvent[]
  selectedEventId: string | null
  initialized: boolean
  initialize: () => Promise<void>
  clear: () => void
  selectEvent: (eventId: string | null) => void
}

export const useAgentContextDevtoolStore = create<AgentContextDevtoolState>((set, get) => ({
  events: [],
  selectedEventId: null,
  initialized: false,

  initialize: async () => {
    if (get().initialized) {
      return
    }
    set({ initialized: true })

    try {
      const snapshot = (await window.ipcDevtool.getAgentContextSnapshot()) as AgentContextEvent[]
      if (Array.isArray(snapshot)) {
        set({ events: snapshot.slice(-MAX_EVENTS) })
      }
    }
    catch (error) {
      console.error('[devtool] getAgentContextSnapshot failed:', error)
    }

    window.ipcDevtool.onAgentContextEvent((event) => {
      const existing = get().events
      const combined = [...existing, event as AgentContextEvent]
      const next = combined.length > MAX_EVENTS
        ? combined.slice(combined.length - MAX_EVENTS)
        : combined
      set({ events: next })
    })
  },

  clear: () => {
    void window.ipcDevtool.clearAgentContext()
    set({ events: [], selectedEventId: null })
  },

  selectEvent: selectedEventId => set({ selectedEventId }),
}))
