import { randomUUID } from 'node:crypto'

import { chatRuntimeEvents } from '@cradle/db'
import { and, asc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import type { ChatRuntimeEventRecord, NewChatRuntimeEvent } from './events'
import {
  ChatRuntimeEventTypeSchema,
  parseChatRuntimeEventPayload,
  stringifyChatRuntimeEventPayload,
  validateNewChatRuntimeEvent,
} from './events'

export interface AppendChatRuntimeEventsInput {
  streamId: string
  expectedSeq: number
  commandId?: string | null
  events: NewChatRuntimeEvent[]
}

export function readChatRuntimeEvents(streamId: string): ChatRuntimeEventRecord[] {
  return db()
    .select()
    .from(chatRuntimeEvents)
    .where(eq(chatRuntimeEvents.streamId, streamId))
    .orderBy(asc(chatRuntimeEvents.seq))
    .all()
    .map(toChatRuntimeEventRecord)
}

export function appendChatRuntimeEvents(input: AppendChatRuntimeEventsInput): ChatRuntimeEventRecord[] {
  if (input.events.length === 0) {
    return []
  }

  return db().transaction((tx) => {
    if (input.commandId) {
      const existing = tx
        .select()
        .from(chatRuntimeEvents)
        .where(and(
          eq(chatRuntimeEvents.streamId, input.streamId),
          eq(chatRuntimeEvents.commandId, input.commandId),
        ))
        .orderBy(asc(chatRuntimeEvents.seq))
        .all()
      if (existing.length > 0) {
        return existing.map(toChatRuntimeEventRecord)
      }
    }

    for (const event of input.events) {
      try {
        validateNewChatRuntimeEvent(event)
      }
      catch (error) {
        throw new AppError({
          code: 'chat_runtime_event_invalid',
          status: 400,
          message: 'Chat runtime event is missing required semantic fields',
          details: {
            streamId: input.streamId,
            type: event.type,
            issues: readValidationIssues(error),
          },
        })
      }
    }

    const currentSeq = readCurrentSeq(input.streamId, tx)
    if (currentSeq !== input.expectedSeq) {
      throw new AppError({
        code: 'chat_runtime_event_sequence_conflict',
        status: 409,
        message: 'Chat runtime event stream changed while appending events',
        details: {
          streamId: input.streamId,
          expectedSeq: input.expectedSeq,
          actualSeq: currentSeq,
        },
      })
    }

    const rows = input.events.map((event, index) => ({
      id: event.id ?? randomUUID(),
      streamId: input.streamId,
      seq: input.expectedSeq + index + 1,
      type: event.type,
      commandId: input.commandId ?? null,
      actorKind: event.actorKind ?? null,
      actorId: event.actorId ?? null,
      runId: event.runId ?? null,
      messageId: event.messageId ?? null,
      queueItemId: event.queueItemId ?? null,
      occurredAt: event.occurredAt ?? currentUnixSeconds(),
      payloadJson: stringifyChatRuntimeEventPayload(event.payload),
    }))

    tx.insert(chatRuntimeEvents).values(rows).run()
    return rows.map(row => toChatRuntimeEventRecord(row))
  })
}

function readValidationIssues(error: unknown): unknown {
  if (error && typeof error === 'object' && 'issues' in error) {
    return (error as { issues: unknown }).issues
  }
  return error instanceof Error ? error.message : String(error)
}

function readCurrentSeq(
  streamId: string,
  source: Pick<ReturnType<typeof db>, 'select'> = db(),
): number {
  const row = source
    .select({ seq: chatRuntimeEvents.seq })
    .from(chatRuntimeEvents)
    .where(eq(chatRuntimeEvents.streamId, streamId))
    .orderBy(asc(chatRuntimeEvents.seq))
    .all()
    .at(-1)
  return row?.seq ?? 0
}

function toChatRuntimeEventRecord(row: {
  id: string
  streamId: string
  seq: number
  type: string
  commandId: string | null
  actorKind: string | null
  actorId: string | null
  runId: string | null
  messageId: string | null
  queueItemId: string | null
  occurredAt: number
  payloadJson: string
}): ChatRuntimeEventRecord {
  return {
    id: row.id,
    streamId: row.streamId,
    seq: row.seq,
    type: ChatRuntimeEventTypeSchema.parse(row.type),
    commandId: row.commandId,
    actorKind: parseActorKind(row.actorKind),
    actorId: row.actorId,
    runId: row.runId,
    messageId: row.messageId,
    queueItemId: row.queueItemId,
    occurredAt: row.occurredAt,
    payload: parseChatRuntimeEventPayload(row.payloadJson),
  }
}

function parseActorKind(value: string | null): ChatRuntimeEventRecord['actorKind'] {
  if (
    value === 'user'
    || value === 'agent'
    || value === 'system'
    || value === 'runtime'
    || value === 'provider'
  ) {
    return value
  }
  return null
}
