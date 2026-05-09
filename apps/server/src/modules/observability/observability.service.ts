// Input: observability store, contract helpers, rule evaluator, and bundle exporter
// Output: injectable observability service for event capture, incident projection, query, and export
// Position: apps/server observability application service

import { inject, injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'
import {
  createDedupeKey,
  createObservabilityEvent,
  type CreateEventInput,
  type ObservabilityEvent,
  type ObservabilityIncident,
} from './contract'
import { exportObservabilityBundle, type ExportObservabilityBundleInput, type ObservabilityBundle } from './exporter'
import { evaluateIncidentRules } from './rules'
import { ObservabilityStore, type ObservabilityEventFilter, type ObservabilityIncidentFilter } from './store'

const MAX_RECENT_EVENTS = 2000

@injectable()
export class ObservabilityService {
  private readonly recentEvents: ObservabilityEvent[] = []

  constructor(
    @inject(ObservabilityStore) private readonly store: ObservabilityStore,
    @inject(DbAccessor) private readonly dbAccessor: DbAccessor,
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
      this.applyRules(event)
      this.appendRecentEvent(event)
    }
    catch (error) {
      console.error('[ObservabilityService] failed to record event', { input, error })
    }
  }

  async flushEvents(): Promise<void> {
    await this.store.flushEvents()
  }

  getEvents(filter?: ObservabilityEventFilter): ObservabilityEvent[] {
    return this.store.queryEvents(filter)
  }

  getIncidents(filter?: ObservabilityIncidentFilter): ObservabilityIncident[] {
    return this.store.queryIncidents(filter)
  }

  exportBundle(input: ExportObservabilityBundleInput): ObservabilityBundle {
    return exportObservabilityBundle(input, {
      db: this.dbAccessor.get(),
      store: this.store,
    })
  }

  async shutdown(): Promise<void> {
    await this.store.shutdown()
  }

  onApplicationShutdown(): Promise<void> {
    return this.shutdown()
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