// Input: observability service queries and backend timeline tables
// Output: portable observability bundle for local debugging and incident sharing
// Position: apps/server observability exporter used by HTTP methods

import { backendTimelineEvents } from '@cradle/db'
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

  const timelineRows = deps.db.select()
    .from(backendTimelineEvents)
    .all()
    .filter((row) => {
      if (input.chatSessionId && row.chatSessionId !== input.chatSessionId) {
        return false
      }
      if (input.runId && row.runId !== input.runId) {
        return false
      }
      if (input.sinceUnix !== undefined && row.createdAt < input.sinceUnix) {
        return false
      }
      return true
    })
    .map(row => ({
      id: row.id,
      runId: row.runId,
      chatSessionId: row.chatSessionId,
      sequenceNumber: row.sequenceNumber,
      eventType: row.eventType,
      createdAt: row.createdAt,
      payload: safeParseJson(row.payloadJson),
      source: safeParseJson(row.sourceJson),
    }))

  return {
    exportedAt: Date.now(),
    events,
    incidents,
    timeline: timelineRows,
  }
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  }
  catch {
    return value
  }
}
