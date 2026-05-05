// Input: SQLite chat/control-plane tables, timeline codecs, and projected assistant snapshots
// Output: Transactional persistence helper for timeline events, message snapshots, and terminal run state
// Position: Chat feature write-side helper ensuring backend facts and chat projections commit together

import { randomUUID } from 'node:crypto'

import { and, desc, eq } from 'drizzle-orm'

import { getDb } from '../db'
import {
  backendRuns,
  backendTimelineEvents,
  messages,
  sessions,
} from '../db/schema'
import type { BackendTimelineEvent, TimelineInputEvent } from '../backend-control-plane/timeline-events'
import {
  decodeTimelineInputEvent,
  encodeTimelineInputEvent,
  TIMELINE_SCHEMA_VERSION,
} from '../backend-control-plane/timeline-events'

export interface PersistProjectedTimelineEventInput {
  chatSessionId: string
  messageId: string
  runId: string
  event: TimelineInputEvent
  messageJson: string
  messageStatus: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText: string | null
  runCompletion?: {
    status: 'complete' | 'aborted' | 'failed'
    stopReason: string | null
    errorText: string | null
  }
}

export function persistProjectedTimelineEvent(
  input: PersistProjectedTimelineEventInput,
): BackendTimelineEvent {
  const db = getDb()

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
        content: input.messageJson,
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

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}
