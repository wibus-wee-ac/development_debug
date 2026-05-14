import { create } from 'zustand'

import { getServerUrl } from '~/lib/electron'

const SERVER_BASE = getServerUrl()

interface ObservabilityEvent {
  id: string
  source: string
  code: string
  severity: string
  category: string
  message: string
  attrs?: Record<string, unknown>
  chatSessionId?: string
  runId?: string
  occurredAt: number
  recordedAt: number
}

interface ObservabilityIncident {
  id: string
  dedupeKey: string
  code: string
  severity: string
  status: 'open' | 'resolved'
  source: string
  message: string
  chatSessionId?: string
  runId?: string
  firstOccurredAt: number
  lastOccurredAt: number
  lastRecordedAt: number
  count: number
}

export type ObservabilityEntry
  = | { kind: 'event', payload: ObservabilityEvent }
    | { kind: 'incident', payload: ObservabilityIncident }

interface ObservabilityDevtoolState {
  entries: ObservabilityEntry[]
  selectedIndex: number | null
  loading: boolean
  error: string | null
  load: () => Promise<void>
  selectIndex: (index: number | null) => void
  clear: () => void
}

export const useObservabilityDevtoolStore = create<ObservabilityDevtoolState>(set => ({
  entries: [],
  selectedIndex: null,
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null })
    try {
      const [eventsRes, incidentsRes] = await Promise.all([
        fetch(`${SERVER_BASE}/observability/events?limit=200`),
        fetch(`${SERVER_BASE}/observability/incidents?limit=50`),
      ])
      const events: ObservabilityEvent[] = eventsRes.ok ? await eventsRes.json() : []
      const incidents: ObservabilityIncident[] = incidentsRes.ok ? await incidentsRes.json() : []

      const entries: ObservabilityEntry[] = [
        ...events.map(e => ({ kind: 'event' as const, payload: e })),
        ...incidents.map(i => ({ kind: 'incident' as const, payload: i })),
      ].sort((a, b) => {
        const aTime = a.kind === 'event' ? a.payload.recordedAt : a.payload.lastRecordedAt
        const bTime = b.kind === 'event' ? b.payload.recordedAt : b.payload.lastRecordedAt
        return bTime - aTime
      })

      set({ entries, loading: false })
    }
    catch (err) {
      set({ error: String(err), loading: false })
    }
  },
  selectIndex: selectedIndex => set({ selectedIndex }),
  clear: () => set({ entries: [], selectedIndex: null }),
}))
