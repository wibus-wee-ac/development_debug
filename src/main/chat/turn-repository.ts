// Input: SQLite chat/control-plane tables, timeline codecs, and projected assistant snapshots
// Output: Injectable turn persistence repository with debounced writes for delta events
// Position: Chat feature write-side repository — single source of truth for timeline event persistence

import { randomUUID } from 'node:crypto'

import { and, desc, eq, inArray } from 'drizzle-orm'

import type { BackendTimelineEvent, TimelineInputEvent } from '../backend-control-plane/timeline-events'
import {
  decodeTimelineInputEvent,
  encodeTimelineInputEvent,
  TIMELINE_SCHEMA_VERSION,
} from '../backend-control-plane/timeline-events'
import {
  backendRuns,
  backendTimelineEvents,
  messages,
  sessions,
} from '../db/schema'

// ── Types ─────────────────────────────────────────────────────────────────────

type DrizzleDb = ReturnType<typeof import('../db').getDb>

export interface PersistEventInput {
  chatSessionId: string
  messageId: string
  runId: string
  event: TimelineInputEvent
  messageStatus: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText: string | null
  runCompletion?: {
    status: 'complete' | 'aborted' | 'failed'
    stopReason: string | null
    errorText: string | null
  }
}

export interface TurnRepository {
  /**
   * Persist a timeline event, message snapshot, and optional run completion atomically.
   * For delta events during streaming, writes may be buffered and flushed periodically.
   * For structural events (run.*, command.*, approval.*), writes are immediate.
   */
  persistEvent: (input: PersistEventInput) => BackendTimelineEvent

  /**
   * Force flush any buffered writes. Call this when the turn completes or is cancelled.
   */
  flush: () => void

  /**
   * Crash recovery: mark all stranded 'streaming' messages as 'aborted'
   * and bump their parent sessions' updatedAt timestamps.
   * Should be called once at application startup.
   */
  recoverStrandedRuns: () => void
}

export interface TurnRepositoryDeps {
  db: DrizzleDb
}

// ── Implementation ────────────────────────────────────────────────────────────

/** Events that require immediate persistence (structural boundaries). */
const IMMEDIATE_FLUSH_TYPES = new Set<TimelineInputEvent['type']>([
  'run.started',
  'run.completed',
  'run.aborted',
  'run.failed',
  'command.started',
  'command.completed',
  'approval.requested',
  'approval.resolved',
  'assistant.message.started',
  'assistant.message.completed',
  'reasoning.started',
  'reasoning.completed',
])

const DEBOUNCE_INTERVAL_MS = 150

export function createTurnRepository(deps: TurnRepositoryDeps): TurnRepository {
  const { db } = deps

  // Debounce state: buffer delta events and flush periodically as a batch
  let pendingWrites: PersistEventInput[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let lastFlushedResult: BackendTimelineEvent | null = null

  function commitEvent(input: PersistEventInput): BackendTimelineEvent {
    return db.transaction((tx) => {
      const now = nowUnix()
      const lastRow = tx
        .select()
        .from(backendTimelineEvents)
        .where(eq(backendTimelineEvents.runId, input.runId))
        .orderBy(desc(backendTimelineEvents.sequenceNumber))
        .get()

      const sequenceNumber = (lastRow?.sequenceNumber ?? -1) + 1
      const encoded = encodeTimelineInputEvent(input.event)

      const row = tx.insert(backendTimelineEvents)
        .values({
          id: randomUUID(),
          runId: input.runId,
          chatSessionId: input.chatSessionId,
          sequenceNumber,
          eventType: encoded.eventType,
          schemaVersion: TIMELINE_SCHEMA_VERSION,
          payloadJson: encoded.payloadJson,
          sourceJson: encoded.sourceJson,
          createdAt: now,
        })
        .returning()
        .get()

      tx.update(messages)
        .set({
          status: input.messageStatus,
          errorText: input.errorText,
          updatedAt: now,
        })
        .where(and(eq(messages.id, input.messageId), eq(messages.sessionId, input.chatSessionId)))
        .run()

      tx.update(sessions)
        .set({ updatedAt: now })
        .where(eq(sessions.id, input.chatSessionId))
        .run()

      if (input.runCompletion) {
        tx.update(backendRuns)
          .set({
            status: input.runCompletion.status,
            stopReason: input.runCompletion.stopReason,
            errorText: input.runCompletion.errorText,
            finishedAt: now,
          })
          .where(eq(backendRuns.id, input.runId))
          .run()
      }

      const event = decodeTimelineInputEvent({
        eventType: row.eventType,
        payloadJson: row.payloadJson,
        sourceJson: row.sourceJson,
      })

      return {
        id: row.id,
        runId: row.runId,
        chatSessionId: row.chatSessionId,
        sequenceNumber: row.sequenceNumber,
        schemaVersion: row.schemaVersion as typeof TIMELINE_SCHEMA_VERSION,
        createdAt: row.createdAt,
        ...event,
      }
    })
  }

  function flushPending(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (pendingWrites.length > 0) {
      for (const input of pendingWrites) {
        lastFlushedResult = commitEvent(input)
      }
      pendingWrites = []
    }
  }

  function scheduleFlush(): void {
    if (flushTimer !== null) {
      return
    }
    flushTimer = setTimeout(flushPending, DEBOUNCE_INTERVAL_MS)
  }

  return {
    persistEvent(input: PersistEventInput): BackendTimelineEvent {
      const isImmediate = IMMEDIATE_FLUSH_TYPES.has(input.event.type)

      if (isImmediate) {
        // Flush any pending delta write first, then commit this event immediately
        flushPending()
        const result = commitEvent(input)
        lastFlushedResult = result
        return result
      }

      // Delta event: buffer it for batch flush
      pendingWrites.push(input)
      scheduleFlush()

      // Return a synthetic BackendTimelineEvent from the input for the caller's broadcast needs.
      // The actual DB row will be committed on flush, but the caller needs something to broadcast now.
      const encoded = encodeTimelineInputEvent(input.event)
      const decoded = decodeTimelineInputEvent({
        eventType: encoded.eventType,
        payloadJson: encoded.payloadJson,
        sourceJson: encoded.sourceJson,
      })
      return {
        id: `pending-${randomUUID()}`,
        runId: input.runId,
        chatSessionId: input.chatSessionId,
        sequenceNumber: lastFlushedResult ? lastFlushedResult.sequenceNumber + 1 : 0,
        schemaVersion: TIMELINE_SCHEMA_VERSION,
        createdAt: nowUnix(),
        ...decoded,
      }
    },

    flush(): void {
      flushPending()
    },

    recoverStrandedRuns(): void {
      const strandedSessionIds = db
        .select({ sessionId: messages.sessionId })
        .from(messages)
        .where(eq(messages.status, 'streaming'))
        .all()
        .map(row => row.sessionId)
      const uniqueSessionIds = [...new Set(strandedSessionIds)]

      if (uniqueSessionIds.length === 0) {
        return
      }

      db.transaction((tx) => {
        tx.update(messages)
          .set({
            status: 'aborted',
            errorText: 'Interrupted by app restart',
            updatedAt: nowUnix(),
          })
          .where(eq(messages.status, 'streaming'))
          .run()
        tx.update(sessions)
          .set({ updatedAt: nowUnix() })
          .where(inArray(sessions.id, uniqueSessionIds))
          .run()
      })
    },
  }
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}
