// Input: Chat/session rows, backend runs, and persisted timeline events from SQLite
// Output: Chat read-side helpers for timeline hydration and assistant text extraction
// Position: Chat query module consumed by IPC adapters, exports, and search/index rebuild paths

import { desc, eq, inArray } from 'drizzle-orm'

import { decodeTimelineInputEvent } from '../backend-control-plane/timeline-events'
import { getDb } from '../db'
import {
  backendRuns,
  backendTimelineEvents,
  messages,
} from '../db/schema'

type BackendTimelineEvent = import('../backend-control-plane/timeline-events').BackendTimelineEvent

export type ChatMessageStatus = 'streaming' | 'complete' | 'aborted' | 'failed'

export interface ChatTimelineGroup {
  messageId: string
  role: 'user' | 'assistant'
  events: Array<Record<string, unknown>>
  userText?: string
  status: ChatMessageStatus
  errorText?: string
}

type DrizzleDb = ReturnType<typeof getDb>
type BackendRunRow = typeof backendRuns.$inferSelect

type BackendTimelineRow = typeof backendTimelineEvents.$inferSelect

export interface ChatTimelineQuery {
  getSessionTimeline: (chatSessionId: string) => ChatTimelineGroup[]
}

export function createChatTimelineQuery(db: DrizzleDb = getDb()): ChatTimelineQuery {
  return {
    getSessionTimeline(chatSessionId) {
      const rows = db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, chatSessionId))
        .orderBy(messages.createdAt)
        .all()

      const assistantMessageIds = rows
        .filter(row => row.role === 'assistant')
        .map(row => row.id)

      const latestRunByMessageId = loadLatestRunsByMessageId(db, assistantMessageIds)
      const timelineByRunId = loadTimelineByRunId(
        db,
        [...new Set(Array.from(latestRunByMessageId.values(), run => run.id))],
      )

      return rows.map((row): ChatTimelineGroup => {
        if (row.role === 'user') {
          return {
            messageId: row.id,
            role: 'user',
            events: [],
            userText: row.content,
            status: row.status,
            errorText: row.errorText ?? undefined,
          }
        }

        const runId = latestRunByMessageId.get(row.id)?.id
        return {
          messageId: row.id,
          role: 'assistant',
          events: runId ? timelineByRunId.get(runId) ?? [] : [],
          status: row.status,
          errorText: row.errorText ?? undefined,
        }
      })
    },
  }
}

function loadLatestRunsByMessageId(
  db: DrizzleDb,
  assistantMessageIds: string[],
): Map<string, BackendRunRow> {
  if (assistantMessageIds.length === 0) {
    return new Map()
  }

  const runs = db
    .select()
    .from(backendRuns)
    .where(inArray(backendRuns.messageId, assistantMessageIds))
    .orderBy(desc(backendRuns.startedAt))
    .all()

  const latestRunByMessageId = new Map<string, BackendRunRow>()
  for (const run of runs) {
    if (!run.messageId || latestRunByMessageId.has(run.messageId)) {
      continue
    }
    latestRunByMessageId.set(run.messageId, run)
  }

  return latestRunByMessageId
}

function loadTimelineByRunId(
  db: DrizzleDb,
  runIds: string[],
): Map<string, Array<Record<string, unknown>>> {
  if (runIds.length === 0) {
    return new Map()
  }

  const rows = db
    .select()
    .from(backendTimelineEvents)
    .where(inArray(backendTimelineEvents.runId, runIds))
    .orderBy(backendTimelineEvents.sequenceNumber)
    .all()

  const timelineByRunId = new Map<string, BackendTimelineEvent[]>()
  for (const row of rows) {
    const decoded = decodeBackendTimelineRow(row)
    const bucket = timelineByRunId.get(row.runId) ?? []
    bucket.push(decoded)
    timelineByRunId.set(row.runId, bucket)
  }

  for (const bucket of timelineByRunId.values()) {
    bucket.sort((left, right) => left.sequenceNumber - right.sequenceNumber)
  }

  return new Map(
    Array.from(timelineByRunId.entries(), ([runId, events]) => [runId, events as unknown as Array<Record<string, unknown>>]),
  )
}

function decodeBackendTimelineRow(row: BackendTimelineRow): BackendTimelineEvent {
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
    schemaVersion: row.schemaVersion as BackendTimelineEvent['schemaVersion'],
    createdAt: row.createdAt,
    ...event,
  }
}

export function listAssistantTimelineEventsByMessageId(
  db: DrizzleDb,
  assistantMessageId: string,
): BackendTimelineEvent[] {
  const run = db
    .select({ id: backendRuns.id })
    .from(backendRuns)
    .where(eq(backendRuns.messageId, assistantMessageId))
    .orderBy(desc(backendRuns.startedAt))
    .get()

  if (!run) {
    return []
  }

  return db
    .select()
    .from(backendTimelineEvents)
    .where(eq(backendTimelineEvents.runId, run.id))
    .orderBy(backendTimelineEvents.sequenceNumber)
    .all()
    .map(decodeBackendTimelineRow)
}

export function extractAssistantTextFromTimelineEvents(
  events: Array<{ type: string, delta?: string }>,
): string {
  return events
    .filter(event => event.type === 'assistant.text.delta')
    .map(event => event.delta ?? '')
    .join('')
}

export function extractAssistantTextByMessageId(
  db: DrizzleDb,
  assistantMessageId: string,
): string {
  return extractAssistantTextFromTimelineEvents(listAssistantTimelineEventsByMessageId(db, assistantMessageId))
}

