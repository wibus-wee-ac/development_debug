// Input: canonical observability contracts, Drizzle DB tables, and queue settings
// Output: non-blocking observability queue store with batch persistence and incident upsert APIs
// Position: apps/server observability persistence boundary

import type { ObservabilityEventRow, ObservabilityIncidentRow } from '@cradle/db'
import { observabilityEvents, observabilityIncidents } from '@cradle/db'
import { desc, eq } from 'drizzle-orm'
import { inject, injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'
import type { ObservabilityEvent, ObservabilityIncident } from './contract'

export interface ObservabilityEventFilter {
  chatSessionId?: string
  runId?: string
  code?: string
  severity?: string
  since?: number
  until?: number
  limit?: number
}

export interface ObservabilityIncidentFilter {
  dedupeKey?: string
  code?: string
  status?: 'open' | 'resolved'
  chatSessionId?: string
  runId?: string
  limit?: number
}

const DEFAULT_BATCH_SIZE = 100
const DEFAULT_FLUSH_INTERVAL_MS = 400
const DEFAULT_MAX_QUEUE_SIZE = 5000

@injectable()
export class ObservabilityStore {
  private readonly queue: ObservabilityEvent[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private activeFlush: Promise<void> | null = null
  private closed = false
  private droppedEvents = 0

  constructor(@inject(DbAccessor) private readonly dbAccessor: DbAccessor) {}

  enqueueEvent(event: ObservabilityEvent): void {
    if (this.closed) {
      return
    }

    if (this.queue.length >= DEFAULT_MAX_QUEUE_SIZE) {
      this.droppedEvents += 1
      if (this.droppedEvents % 100 === 1) {
        console.error('[ObservabilityStore] queue is full; dropping new observability events', {
          maxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
          droppedTotal: this.droppedEvents,
        })
      }
      return
    }

    this.queue.push(event)
    if (this.queue.length >= DEFAULT_BATCH_SIZE) {
      this.scheduleFlush(0)
      return
    }
    this.scheduleFlush(DEFAULT_FLUSH_INTERVAL_MS)
  }

  async flushEvents(): Promise<void> {
    if (this.closed && this.queue.length === 0) {
      return
    }
    if (this.activeFlush) {
      return this.activeFlush
    }

    this.activeFlush = Promise.resolve().then(() => {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, DEFAULT_BATCH_SIZE)
        try {
          this.persistBatch(batch)
        }
        catch (error) {
          this.droppedEvents += batch.length
          console.error('[ObservabilityStore] failed to persist batch; dropping events', {
            droppedBatch: batch.length,
            droppedTotal: this.droppedEvents,
            error,
          })
        }
      }
    }).finally(() => {
      this.activeFlush = null
    })

    return this.activeFlush
  }

  queryEvents(filter: ObservabilityEventFilter = {}): ObservabilityEvent[] {
    const rows = this.dbAccessor.get().select().from(observabilityEvents).orderBy(desc(observabilityEvents.recordedAt)).all()

    return rows
      .filter((row) => {
        if (filter.chatSessionId && row.chatSessionId !== filter.chatSessionId) {
          return false
        }
        if (filter.runId && row.runId !== filter.runId) {
          return false
        }
        if (filter.code && row.code !== filter.code) {
          return false
        }
        if (filter.severity && row.severity !== filter.severity) {
          return false
        }
        if (filter.since !== undefined && row.recordedAt < filter.since) {
          return false
        }
        if (filter.until !== undefined && row.recordedAt > filter.until) {
          return false
        }
        return true
      })
      .slice(0, filter.limit ?? 2000)
      .map(toObservabilityEvent)
  }

  upsertIncident(incident: ObservabilityIncident): void {
    const db = this.dbAccessor.get()
    const existing = db.select()
      .from(observabilityIncidents)
      .where(eq(observabilityIncidents.dedupeKey, incident.dedupeKey))
      .get()

    if (!existing) {
      db.insert(observabilityIncidents)
        .values({
          id: incident.id,
          dedupeKey: incident.dedupeKey,
          code: incident.code,
          severity: incident.severity,
          status: incident.status,
          source: incident.source,
          message: incident.message,
          chatSessionId: incident.chatSessionId ?? null,
          runId: incident.runId ?? null,
          messageId: incident.messageId ?? null,
          firstOccurredAt: incident.firstOccurredAt,
          lastOccurredAt: incident.lastOccurredAt,
          lastRecordedAt: incident.lastRecordedAt,
          count: incident.count,
          lastEventId: null,
          attrsJson: incident.attrs ? JSON.stringify(incident.attrs) : null,
        })
        .run()
      return
    }

    db.update(observabilityIncidents)
      .set({
        severity: mergeSeverity(existing.severity, incident.severity),
        status: incident.status,
        source: incident.source,
        message: incident.message,
        chatSessionId: incident.chatSessionId ?? existing.chatSessionId,
        runId: incident.runId ?? existing.runId,
        messageId: incident.messageId ?? existing.messageId,
        firstOccurredAt: Math.min(existing.firstOccurredAt, incident.firstOccurredAt),
        lastOccurredAt: Math.max(existing.lastOccurredAt, incident.lastOccurredAt),
        lastRecordedAt: Math.max(existing.lastRecordedAt, incident.lastRecordedAt),
        count: existing.count + 1,
        lastEventId: null,
        attrsJson: incident.attrs ? JSON.stringify(incident.attrs) : existing.attrsJson,
      })
      .where(eq(observabilityIncidents.id, existing.id))
      .run()
  }

  queryIncidents(filter: ObservabilityIncidentFilter = {}): ObservabilityIncident[] {
    const rows = this.dbAccessor.get().select().from(observabilityIncidents).orderBy(desc(observabilityIncidents.lastRecordedAt)).all()

    return rows
      .filter((row) => {
        if (filter.dedupeKey && row.dedupeKey !== filter.dedupeKey) {
          return false
        }
        if (filter.code && row.code !== filter.code) {
          return false
        }
        if (filter.status && row.status !== filter.status) {
          return false
        }
        if (filter.chatSessionId && row.chatSessionId !== filter.chatSessionId) {
          return false
        }
        if (filter.runId && row.runId !== filter.runId) {
          return false
        }
        return true
      })
      .slice(0, filter.limit ?? 2000)
      .map(toObservabilityIncident)
  }

  async shutdown(): Promise<void> {
    this.closed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.flushEvents()
  }

  onApplicationShutdown(): Promise<void> {
    return this.shutdown()
  }

  private scheduleFlush(delayMs: number): void {
    if (this.closed || this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flushEvents()
    }, delayMs)
  }

  private persistBatch(batch: ObservabilityEvent[]): void {
    if (batch.length === 0) {
      return
    }

    this.dbAccessor.get().insert(observabilityEvents)
      .values(batch.map(event => ({
        id: event.id,
        schemaVersion: event.schemaVersion,
        source: event.source,
        code: event.code,
        severity: event.severity,
        category: event.category,
        message: event.message,
        attrsJson: event.attrs ? JSON.stringify(event.attrs) : null,
        chatSessionId: event.chatSessionId ?? null,
        runId: event.runId ?? null,
        messageId: event.messageId ?? null,
        traceId: event.traceId ?? null,
        dedupeKey: event.dedupeKey ?? null,
        parentEventId: event.parentEventId ?? null,
        occurredAt: event.occurredAt,
        recordedAt: event.recordedAt,
      })))
      .run()
  }
}

function mergeSeverity(current: string, next: string): ObservabilityIncident['severity'] {
  return severityPriority(next) >= severityPriority(current)
    ? (next as ObservabilityIncident['severity'])
    : (current as ObservabilityIncident['severity'])
}

function severityPriority(value: string): number {
  switch (value) {
    case 'fatal':
      return 5
    case 'error':
      return 4
    case 'warn':
      return 3
    case 'info':
      return 2
    case 'debug':
    default:
      return 1
  }
}

function toObservabilityEvent(row: ObservabilityEventRow): ObservabilityEvent {
  return {
    id: row.id,
    schemaVersion: row.schemaVersion,
    source: row.source as ObservabilityEvent['source'],
    code: row.code,
    severity: row.severity as ObservabilityEvent['severity'],
    category: row.category as ObservabilityEvent['category'],
    message: row.message,
    attrs: row.attrsJson ? safeJsonParse(row.attrsJson) : undefined,
    chatSessionId: row.chatSessionId ?? undefined,
    runId: row.runId ?? undefined,
    messageId: row.messageId ?? undefined,
    traceId: row.traceId ?? undefined,
    dedupeKey: row.dedupeKey ?? undefined,
    parentEventId: row.parentEventId ?? undefined,
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
  }
}

function toObservabilityIncident(row: ObservabilityIncidentRow): ObservabilityIncident {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    code: row.code,
    severity: row.severity as ObservabilityIncident['severity'],
    status: row.status as ObservabilityIncident['status'],
    source: row.source as ObservabilityIncident['source'],
    message: row.message,
    chatSessionId: row.chatSessionId ?? undefined,
    runId: row.runId ?? undefined,
    messageId: row.messageId ?? undefined,
    firstOccurredAt: row.firstOccurredAt,
    lastOccurredAt: row.lastOccurredAt,
    lastRecordedAt: row.lastRecordedAt,
    count: row.count,
    lastEventId: row.lastEventId ?? undefined,
    attrs: row.attrsJson ? safeJsonParse(row.attrsJson) : undefined,
  }
}

function safeJsonParse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>
    }
    return { value: parsed }
  }
  catch {
    return { parseError: true }
  }
}