// Input: observability contract helpers, non-blocking store, rule evaluator, and devtool store
// Output: singleton-style observability service for event capture, incident projection, query, and export
// Position: local observability application service owned by src/main/observability

import type { ObservabilityDevtoolEvent } from '@cradle/ipc'

import { getDb } from '../db'
import { getObservabilityDevtoolStore } from '../devtools/observability-devtool-store'
import type { SignalBroadcaster } from '../signal/broadcaster'
import {
  createDedupeKey,
  createObservabilityEvent,
  OBSERVABILITY_CODES,
  type CreateEventInput,
  type ObservabilityEvent,
  type ObservabilityIncident,
} from './contract'
import { exportObservabilityBundle, type ExportObservabilityBundleInput, type ObservabilityBundle } from './exporter'
import { evaluateIncidentRules } from './rules'
import { createObservabilityStore, type ObservabilityIncidentFilter, type ObservabilityStore, type ObservabilityStoreOptions, type ObservabilityEventFilter } from './store'

const MAX_RECENT_EVENTS = 2000

export interface ObservabilityService {
  record: (input: CreateEventInput) => void
  bindSignalBroadcaster: (broadcaster: SignalBroadcaster) => void
  flushEvents: () => Promise<void>
  shutdown: () => Promise<void>
  getEvents: (filter?: ObservabilityEventFilter) => ObservabilityEvent[]
  getIncidents: (filter?: ObservabilityIncidentFilter) => ObservabilityIncident[]
  clearDevtoolBuffer: () => void
  getDevtoolSnapshot: () => ObservabilityDevtoolEvent[]
  exportBundle: (input: ExportObservabilityBundleInput) => ObservabilityBundle
}

export interface ObservabilityServiceDeps {
  store: ObservabilityStore
}

class LocalObservabilityService implements ObservabilityService {
  private recentEvents: ObservabilityEvent[] = []
  private incidentBroadcaster: ((incident: ObservabilityIncident) => void) | null = null

  constructor(
    private readonly store: ObservabilityStore,
  ) {}

  record(input: CreateEventInput): void {
    try {
      const dedupeKey = input.dedupeKey ?? createDedupeKey({
        code: input.code,
        chatSessionId: input.chatSessionId ?? null,
        runId: input.runId ?? null,
        handlerName: readHandlerName(input.attrs),
      })
      const event = createObservabilityEvent({
        ...input,
        dedupeKey,
      })
      this.store.enqueueEvent(event)
      getObservabilityDevtoolStore().record({ kind: 'event', payload: event })
      this.appendRecentEvent(event)
      this.applyRules(event)
    }
    catch (error) {
      console.error('[ObservabilityService] failed to record event', { input, error })
    }
  }

  bindSignalBroadcaster(broadcaster: SignalBroadcaster): void {
    this.incidentBroadcaster = (incident) => {
      broadcaster.broadcastGlobal('observability:incident', incident)
    }
  }

  async flushEvents(): Promise<void> {
    await this.store.flushEvents()
  }

  async shutdown(): Promise<void> {
    await this.store.shutdown()
  }

  getEvents(filter?: ObservabilityEventFilter): ObservabilityEvent[] {
    return this.store.queryEvents(filter)
  }

  getIncidents(filter?: ObservabilityIncidentFilter): ObservabilityIncident[] {
    return this.store.queryIncidents(filter)
  }

  clearDevtoolBuffer(): void {
    getObservabilityDevtoolStore().clear()
  }

  getDevtoolSnapshot(): ObservabilityDevtoolEvent[] {
    return getObservabilityDevtoolStore().getSnapshot()
  }

  exportBundle(input: ExportObservabilityBundleInput): ObservabilityBundle {
    return exportObservabilityBundle(input, { db: getDb(), store: this.store })
  }

  private appendRecentEvent(event: ObservabilityEvent): void {
    this.recentEvents.push(event)
    if (this.recentEvents.length > MAX_RECENT_EVENTS) {
      this.recentEvents.splice(0, this.recentEvents.length - MAX_RECENT_EVENTS)
    }
  }

  private applyRules(event: ObservabilityEvent): void {
    const results = evaluateIncidentRules({
      nowMs: Date.now(),
      incoming: event,
      recent: this.recentEvents,
    })
    for (const result of results) {
      this.store.upsertIncident(result.incident)
      const updatedIncident = this.store.queryIncidents({ dedupeKey: result.incident.dedupeKey, limit: 1 })[0]
      if (updatedIncident) {
        getObservabilityDevtoolStore().record({ kind: 'incident', payload: updatedIncident })
        this.incidentBroadcaster?.(updatedIncident)
      }
    }
  }
}

function readHandlerName(attrs: Record<string, unknown> | undefined): string | null {
  if (!attrs) {
    return null
  }
  const candidate = attrs.handlerName
  if (typeof candidate === 'string' && candidate.length > 0) {
    return candidate
  }
  return null
}

let service: ObservabilityService | null = null

export function initObservabilityService(options?: ObservabilityStoreOptions): ObservabilityService {
  const store = createObservabilityStore({
    db: getDb(),
    options,
  })
  service = new LocalObservabilityService(store)
  return service
}

export function getObservabilityService(): ObservabilityService {
  if (!service) {
    throw new Error('ObservabilityService not initialized. Call initObservabilityService() first.')
  }
  return service
}

export function recordObservabilityEvent(input: CreateEventInput): void {
  if (!service) {
    return
  }
  service.record(input)
}

export { OBSERVABILITY_CODES }
