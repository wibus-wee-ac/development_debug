// Input: Observability devtool preload API, ObservabilityDevtoolEvent from @cradle/ipc, Zustand
// Output: Observability devtool store for event/incident stream inspection and export actions
// Position: Core state layer for the observability pane inside the devtool feature

import type { ObservabilityDevtoolEvent } from '@cradle/ipc'
import { create } from 'zustand'

const MAX_EVENTS = 5000

interface ObservabilityDevtoolState {
  events: ObservabilityDevtoolEvent[]
  selectedIndex: number | null
  initialized: boolean
  initialize: () => Promise<void>
  clear: () => void
  flush: () => Promise<void>
  exportBundle: (input?: { chatSessionId?: string, runId?: string, sinceUnix?: number }) => Promise<string>
  selectIndex: (index: number | null) => void
}

export const useObservabilityDevtoolStore = create<ObservabilityDevtoolState>((set, get) => ({
  events: [],
  selectedIndex: null,
  initialized: false,
  initialize: async () => {
    if (get().initialized) {
      return
    }
    set({ initialized: true })
    try {
      const snapshot = (await window.ipcDevtool.getObservabilitySnapshot()) as ObservabilityDevtoolEvent[]
      if (Array.isArray(snapshot)) {
        set({ events: snapshot.slice(-MAX_EVENTS) })
      }
    }
    catch (error) {
      console.error('[devtool] getObservabilitySnapshot failed:', error)
    }

    window.ipcDevtool.onObservabilityEvent((event) => {
      const existing = get().events
      const combined = [...existing, event as ObservabilityDevtoolEvent]
      const next = combined.length > MAX_EVENTS
        ? combined.slice(combined.length - MAX_EVENTS)
        : combined
      set({ events: next })
    })
  },
  clear: () => {
    void window.ipcDevtool.clearObservability()
    set({ events: [], selectedIndex: null })
  },
  flush: async () => {
    await window.ipcDevtool.flushObservability()
  },
  exportBundle: async (input = {}) => {
    const bundle = await window.ipcDevtool.exportObservabilityBundle(input)
    return JSON.stringify(bundle, null, 2)
  },
  selectIndex: selectedIndex => set({ selectedIndex }),
}))

