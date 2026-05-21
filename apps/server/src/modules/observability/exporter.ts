import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type { ObservabilityEvent, ObservabilityIncident } from './contract'

export interface ExportObservabilityBundleInput {
  chatSessionId?: string
  runId?: string
  sinceUnix?: number
}

export interface ObservabilityBundle {
  exportedAt: number
  events: ObservabilityEvent[]
  incidents: ObservabilityIncident[]
  timeline: Array<Record<string, unknown>>
}

export function exportObservabilityBundle(
  input: ExportObservabilityBundleInput,
  deps: {
    db: BetterSQLite3Database<Record<string, unknown>>
    queryEvents: (filter: { chatSessionId?: string, runId?: string, since?: number, limit?: number }) => ObservabilityEvent[]
    queryIncidents: (filter: { chatSessionId?: string, runId?: string, limit?: number }) => ObservabilityIncident[]
  },
): ObservabilityBundle {
  const events = deps.queryEvents({
    chatSessionId: input.chatSessionId,
    runId: input.runId,
    since: input.sinceUnix,
    limit: 10000,
  })

  const incidents = deps.queryIncidents({
    chatSessionId: input.chatSessionId,
    runId: input.runId,
    limit: 2000,
  })

  return {
    exportedAt: Date.now(),
    events,
    incidents,
    timeline: [],
  }
}
