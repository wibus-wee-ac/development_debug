// Input: observability store, canonical event helper, and in-memory fake DB adapter
// Output: Queue flush persistence and incident upsert behavior coverage without native SQLite dependency
// Position: Observability store regression tests

import { describe, expect, it } from 'vitest'

import { observabilityEvents, observabilityIncidents } from '../../db/schema'
import { createObservabilityEvent } from '../contract'
import { createObservabilityStore } from '../store'

type EventRow = typeof observabilityEvents.$inferSelect
type IncidentRow = typeof observabilityIncidents.$inferSelect

function createFakeDb() {
  const eventRows: EventRow[] = []
  const incidentRows: IncidentRow[] = []
  let failInsert = false

  const db = {
    select() {
      return {
        from(table: unknown) {
          let rows = table === observabilityEvents ? [...eventRows] : [...incidentRows]
          return {
            where() {
              return this
            },
            orderBy() {
              rows = [...rows].reverse()
              return this
            },
            limit(size: number) {
              rows = rows.slice(0, size)
              return this
            },
            all() {
              return rows
            },
            get() {
              return rows[0]
            },
          }
        },
      }
    },
    insert(table: unknown) {
      return {
        values(value: Record<string, unknown> | Array<Record<string, unknown>>) {
          const batch = Array.isArray(value) ? value : [value]
          return {
            run() {
              if (failInsert) {
                throw new Error('insert failed')
              }
              if (table === observabilityEvents) {
                eventRows.push(...batch as EventRow[])
                return
              }
              if (table === observabilityIncidents) {
                incidentRows.push(...batch as IncidentRow[])
              }
            },
          }
        },
      }
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              return {
                run() {
                  if (table === observabilityIncidents && incidentRows.length > 0) {
                    Object.assign(incidentRows[0], values)
                  }
                },
              }
            },
          }
        },
      }
    },
  }

  return {
    db: db as unknown as ReturnType<typeof import('../../db').getDb>,
    setInsertFailure(next: boolean) {
      failInsert = next
    },
    eventRows,
    incidentRows,
  }
}

describe('createObservabilityStore', () => {
  it('persists queued events on flush and supports query by chatSessionId', async () => {
    const fake = createFakeDb()
    const store = createObservabilityStore({
      db: fake.db,
      options: { batchSize: 10, flushIntervalMs: 1_000 },
    })

    store.enqueueEvent(createObservabilityEvent({
      source: 'chat-engine',
      code: 'TURN_STREAM_FAILED',
      severity: 'error',
      category: 'chat',
      message: 'stream failed',
      chatSessionId: 'chat-1',
      runId: 'run-1',
      dedupeKey: 'TURN_STREAM_FAILED:chat-1:run-1:-',
    }))
    store.enqueueEvent(createObservabilityEvent({
      source: 'chat-engine',
      code: 'TURN_STREAM_FAILED',
      severity: 'error',
      category: 'chat',
      message: 'stream failed #2',
      chatSessionId: 'chat-2',
      runId: 'run-2',
      dedupeKey: 'TURN_STREAM_FAILED:chat-2:run-2:-',
    }))

    await store.flushEvents()

    const chat1Events = store.queryEvents({ chatSessionId: 'chat-1' })
    expect(chat1Events).toHaveLength(1)
    expect(chat1Events[0].code).toBe('TURN_STREAM_FAILED')
  })

  it('upserts incident by dedupe key and increments count', () => {
    const fake = createFakeDb()
    const store = createObservabilityStore({ db: fake.db })
    const event = createObservabilityEvent({
      source: 'domain-event-bus',
      code: 'DOMAIN_EVENT_HANDLER_FAILED',
      severity: 'error',
      category: 'event-bus',
      message: 'handler failed',
      dedupeKey: 'DOMAIN_EVENT_HANDLER_FAILED:-:-:handler-a',
    })

    store.upsertIncident({
      id: 'incident-1',
      dedupeKey: 'DOMAIN_EVENT_HANDLER_FAILED:-:-:handler-a',
      code: 'DOMAIN_EVENT_HANDLER_FAILED',
      severity: 'error',
      status: 'open',
      source: 'domain-event-bus',
      message: 'handler failed',
      firstOccurredAt: event.occurredAt,
      lastOccurredAt: event.occurredAt,
      lastRecordedAt: event.recordedAt,
      count: 1,
      lastEventId: event.id,
    })
    store.upsertIncident({
      id: 'incident-2',
      dedupeKey: 'DOMAIN_EVENT_HANDLER_FAILED:-:-:handler-a',
      code: 'DOMAIN_EVENT_HANDLER_FAILED',
      severity: 'fatal',
      status: 'open',
      source: 'domain-event-bus',
      message: 'handler failed again',
      firstOccurredAt: event.occurredAt + 1,
      lastOccurredAt: event.occurredAt + 1,
      lastRecordedAt: event.recordedAt + 1,
      count: 1,
      lastEventId: event.id,
    })

    const incidents = store.queryIncidents({ dedupeKey: 'DOMAIN_EVENT_HANDLER_FAILED:-:-:handler-a' })
    expect(incidents).toHaveLength(1)
    expect(incidents[0].count).toBe(2)
    expect(incidents[0].severity).toBe('fatal')
  })

  it('does not throw when persistence fails during flush', async () => {
    const fake = createFakeDb()
    const store = createObservabilityStore({
      db: fake.db,
      options: { batchSize: 1, flushIntervalMs: 1 },
    })
    store.enqueueEvent(createObservabilityEvent({
      source: 'chat-engine',
      code: 'TURN_STREAM_FAILED',
      severity: 'error',
      category: 'chat',
      message: 'stream failed',
      dedupeKey: 'TURN_STREAM_FAILED:-:-:-',
    }))

    fake.setInsertFailure(true)
    await expect(store.flushEvents()).resolves.toBeUndefined()
  })
})
