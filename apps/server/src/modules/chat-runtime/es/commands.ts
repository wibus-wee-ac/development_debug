import type { BackendRun, ChatSessionQueueItem, Message } from '@cradle/db'
import { backendRuns, chatSessionQueueItems, messages } from '@cradle/db'
import { and, eq, isNull, or } from 'drizzle-orm'

import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import { parseStoredMessageSnapshot } from '../ui-message'
import type { ChatMessageStatus } from '../run/stream-chunks'
import { appendSessionEvent, readAllSessionEvents, readSessionEvents } from './event-store'
import type { ChatSessionEvent, QueueProjectionStatus, TerminalRunEventType } from './events'
import { projectSessionEvent } from './projectors'
import { reduceChatSessionEvents } from './aggregate'
import { runSessionActorTask } from './session-actor'

const INTERRUPTED_RUN_STOP_REASON = 'response.interrupted'
const INTERRUPTED_RUN_ERROR_TEXT =
  'Response interrupted because the Cradle server process exited while the run was streaming.'

export function commitSessionEvents(sessionId: string, events: ChatSessionEvent[]): Promise<void> {
  if (events.length === 0) {
    return Promise.resolve()
  }
  return runSessionActorTask(sessionId, () => {
    commitSessionEventsInTransaction(sessionId, events)
  })
}

function commitSessionEventsInTransaction(sessionId: string, events: ChatSessionEvent[]): void {
  db().transaction((tx) => {
    for (const event of events) {
      const stored = appendSessionEvent(tx, {
        aggregateId: sessionId,
        event
      })
      projectSessionEvent(tx, stored)
    }
  })
}

export function readRunTerminalEventType(
  status: Exclude<ChatMessageStatus, 'streaming'>
): TerminalRunEventType {
  return status === 'complete' ? 'RunCompleted' : status === 'aborted' ? 'RunAborted' : 'RunFailed'
}

export function readRunStopReason(status: Exclude<ChatMessageStatus, 'streaming'>): string {
  return status === 'complete'
    ? 'response.completed'
    : status === 'aborted'
      ? 'response.cancelled'
      : 'response.failed'
}

export function readQueueTerminalStatus(
  status: Exclude<ChatMessageStatus, 'streaming'>
): QueueProjectionStatus {
  return status === 'complete' ? 'completed' : status === 'aborted' ? 'cancelled' : 'failed'
}

export async function claimSessionQueueItem(
  sessionId: string,
  queueItemId: string
): Promise<ChatSessionQueueItem | undefined> {
  return await runSessionActorTask(sessionId, () => {
    return db().transaction((tx) => {
      const row = tx
        .select()
        .from(chatSessionQueueItems)
        .where(
          and(
            eq(chatSessionQueueItems.id, queueItemId),
            eq(chatSessionQueueItems.sessionId, sessionId),
            eq(chatSessionQueueItems.mode, 'queue'),
            eq(chatSessionQueueItems.status, 'pending')
          )
        )
        .get()
      if (!row) {
        return undefined
      }
      const updatedAt = currentUnixSeconds()
      const stored = appendSessionEvent(tx, {
        aggregateId: sessionId,
        event: {
          type: 'QueueItemClaimed',
          payload: {
            queueItemId,
            sessionId,
            updatedAt
          }
        }
      })
      projectSessionEvent(tx, stored)
      return {
        ...row,
        status: 'running',
        errorText: null,
        updatedAt
      }
    })
  })
}

export async function releaseSessionQueueItem(
  sessionId: string,
  queueItemId: string
): Promise<void> {
  const updatedAt = currentUnixSeconds()
  await commitSessionEvents(sessionId, [
    {
      type: 'QueueItemReleased',
      payload: { queueItemId, sessionId, updatedAt }
    }
  ])
}

export async function failSessionQueueItem(
  sessionId: string,
  queueItemId: string,
  errorText: string
): Promise<void> {
  const updatedAt = currentUnixSeconds()
  await commitSessionEvents(sessionId, [
    {
      type: 'QueueItemFailed',
      payload: { queueItemId, sessionId, errorText, updatedAt }
    }
  ])
}

export async function recoverOrphanedQueueItemClaims(sessionId: string): Promise<number> {
  return await runSessionActorTask(sessionId, () => {
    return db().transaction((tx) => {
      const rows = tx
        .select()
        .from(chatSessionQueueItems)
        .where(
          and(
            eq(chatSessionQueueItems.sessionId, sessionId),
            eq(chatSessionQueueItems.mode, 'queue'),
            eq(chatSessionQueueItems.status, 'running'),
            isNull(chatSessionQueueItems.startedRunId)
          )
        )
        .all()
      if (rows.length === 0) {
        return 0
      }

      const updatedAt = currentUnixSeconds()
      for (const row of rows) {
        const stored = appendSessionEvent(tx, {
          aggregateId: sessionId,
          event: {
            type: 'QueueItemReleased',
            payload: {
              queueItemId: row.id,
              sessionId,
              updatedAt
            }
          }
        })
        projectSessionEvent(tx, stored)
      }
      return rows.length
    })
  })
}

export async function normalizeSessionQueuePositions(sessionId: string): Promise<number> {
  return await runSessionActorTask(sessionId, () => {
    return db().transaction((tx) => {
      const pendingRows = tx
        .select()
        .from(chatSessionQueueItems)
        .where(
          and(
            eq(chatSessionQueueItems.sessionId, sessionId),
            eq(chatSessionQueueItems.mode, 'queue'),
            eq(chatSessionQueueItems.status, 'pending')
          )
        )
        .orderBy(chatSessionQueueItems.position, chatSessionQueueItems.createdAt)
        .all()

      const updatedAt = currentUnixSeconds()
      let changed = 0
      pendingRows.forEach((row, index) => {
        const position = index + 1
        if (row.position === position) {
          return
        }
        const stored = appendSessionEvent(tx, {
          aggregateId: sessionId,
          event: {
            type: 'QueueItemReordered',
            payload: {
              queueItemId: row.id,
              sessionId,
              position,
              updatedAt
            }
          }
        })
        projectSessionEvent(tx, stored)
        changed += 1
      })
      return changed
    })
  })
}

export async function cancelQueuedSessionItem(
  sessionId: string,
  queueItemId: string
): Promise<ChatSessionQueueItem | undefined> {
  return await runSessionActorTask(sessionId, () => {
    return db().transaction((tx) => {
      const row = tx
        .select()
        .from(chatSessionQueueItems)
        .where(
          and(
            eq(chatSessionQueueItems.id, queueItemId),
            eq(chatSessionQueueItems.sessionId, sessionId),
            eq(chatSessionQueueItems.mode, 'queue')
          )
        )
        .get()
      const cancellable =
        row !== undefined &&
        (row.status === 'pending' || (row.status === 'running' && row.startedRunId === null))
      if (!row || !cancellable) {
        return row
      }
      const updatedAt = currentUnixSeconds()
      const stored = appendSessionEvent(tx, {
        aggregateId: sessionId,
        event: {
          type: 'QueueItemCancelled',
          payload: { queueItemId, sessionId, updatedAt }
        }
      })
      projectSessionEvent(tx, stored)
      return {
        ...row,
        status: 'cancelled',
        errorText: null,
        updatedAt
      }
    })
  })
}

export async function recordQueuePositions(
  sessionId: string,
  rows: Array<Pick<ChatSessionQueueItem, 'id' | 'sessionId' | 'status' | 'position'>>
): Promise<void> {
  const updatedAt = currentUnixSeconds()
  const events = rows.map(
    (row, index): ChatSessionEvent => ({
      type: 'QueueItemReordered',
      payload: {
        queueItemId: row.id,
        sessionId,
        position: index + 1,
        updatedAt
      }
    })
  )
  await commitSessionEvents(sessionId, events)
}

export async function finalizeInterruptedSessionEventStreams(): Promise<number> {
  const grouped = new Map<string, ReturnType<typeof readSessionEvents>>()
  for (const event of readAllSessionEvents()) {
    const current = grouped.get(event.aggregateId) ?? []
    current.push(event)
    grouped.set(event.aggregateId, current)
  }

  let recovered = 0
  for (const [sessionId, events] of grouped) {
    const state = reduceChatSessionEvents(events)
    if (!state.activeRun) {
      continue
    }
    if (await finalizeInterruptedRun(sessionId, state.activeRun.runId)) {
      recovered += 1
    }
  }
  for (const run of readStreamingRuns()) {
    if (await finalizeInterruptedRun(run.chatSessionId, run.id)) {
      recovered += 1
    }
  }
  return recovered
}

export async function finalizeInterruptedSessionEventStream(sessionId: string): Promise<boolean> {
  return await runSessionActorTask(sessionId, () =>
    finalizeInterruptedSessionEventStreamInActor(sessionId)
  )
}

function finalizeInterruptedSessionEventStreamInActor(sessionId: string): boolean {
  const state = reduceChatSessionEvents(readSessionEvents(sessionId))
  if (!state.activeRun) {
    return readStreamingRuns(sessionId).reduce(
      (changed, run) => finalizeInterruptedRunInActor(sessionId, run.id) || changed,
      false
    )
  }
  return finalizeInterruptedRunInActor(sessionId, state.activeRun.runId)
}

export async function projectTerminalRunFactsForSession(sessionId: string): Promise<number> {
  let count = 0
  for (const run of readTerminalRuns(sessionId)) {
    if (await projectTerminalRunFact(run)) {
      count += 1
    }
  }
  return count
}

export async function projectTerminalRunFact(run: BackendRun): Promise<boolean> {
  return await runSessionActorTask(run.chatSessionId, () =>
    projectTerminalRunFactInActor(run.chatSessionId, run.id)
  )
}

function projectTerminalRunFactInActor(sessionId: string, runId: string): boolean {
  const run = readRun(sessionId, runId)
  if (!run || run.status === 'streaming') {
    return false
  }
  if (hasTerminalRunFact(sessionId, run.id)) {
    return false
  }
  const message = run.messageId ? readMessage(run.chatSessionId, run.messageId) : null
  const finishedAt = run.finishedAt ?? currentUnixSeconds()
  const events: ChatSessionEvent[] = []
  if (message) {
    events.push({
      type: 'AssistantMessageCompleted',
      payload: {
        message: {
          id: message.id,
          sessionId: run.chatSessionId,
          content: message.content,
          messageJson: normalizeTerminalMessageJson(message),
          status: run.status,
          errorText: run.errorText,
          updatedAt: finishedAt
        }
      }
    })
  }
  events.push({
    type: readRunTerminalEventType(run.status),
    payload: {
      runId: run.id,
      sessionId: run.chatSessionId,
      queueItemId: readRunQueueItemId(run.chatSessionId, run.id),
      ...(run.bindingId !== null ? { bindingId: run.bindingId } : {}),
      status: run.status,
      stopReason: run.stopReason ?? readRunStopReason(run.status),
      errorText: run.errorText,
      finishedAt
    }
  })
  commitSessionEventsInTransaction(run.chatSessionId, events)
  return true
}

function hasTerminalRunFact(sessionId: string, runId: string): boolean {
  return readSessionEvents(sessionId).some((event) => {
    if (
      event.type !== 'RunCompleted' &&
      event.type !== 'RunFailed' &&
      event.type !== 'RunAborted'
    ) {
      return false
    }
    return event.payload.runId === runId
  })
}

export async function finalizeInterruptedRun(sessionId: string, runId: string): Promise<boolean> {
  return await runSessionActorTask(sessionId, () =>
    finalizeInterruptedRunInActor(sessionId, runId)
  )
}

function finalizeInterruptedRunInActor(sessionId: string, runId: string): boolean {
  const run = readRun(sessionId, runId)
  if (!run || run.status !== 'streaming') {
    return false
  }

  const message = run.messageId ? readMessage(sessionId, run.messageId) : null
  const finishedAt = currentUnixSeconds()
  const events: ChatSessionEvent[] = []
  if (message) {
    events.push({
      type: 'AssistantMessageCompleted',
      payload: {
        message: {
          id: message.id,
          sessionId,
          content: message.content,
          messageJson: normalizeTerminalMessageJson(message),
          status: 'failed',
          errorText: INTERRUPTED_RUN_ERROR_TEXT,
          updatedAt: finishedAt
        }
      }
    })
  }
  events.push({
    type: 'RunFailed',
    payload: {
      runId,
      sessionId,
      queueItemId: readRunQueueItemId(sessionId, runId),
      ...(run.bindingId !== null ? { bindingId: run.bindingId } : {}),
      status: 'failed',
      stopReason: INTERRUPTED_RUN_STOP_REASON,
      errorText: INTERRUPTED_RUN_ERROR_TEXT,
      finishedAt
    }
  })
  commitSessionEventsInTransaction(sessionId, events)
  return true
}

export async function abortProjectedStreamingRun(run: BackendRun): Promise<boolean> {
  return await runSessionActorTask(run.chatSessionId, () =>
    abortProjectedStreamingRunInActor(run.chatSessionId, run.id)
  )
}

function abortProjectedStreamingRunInActor(sessionId: string, runId: string): boolean {
  const run = readRun(sessionId, runId)
  if (!run || run.status !== 'streaming') {
    return false
  }
  const finishedAt = currentUnixSeconds()
  const message = run.messageId ? readMessage(run.chatSessionId, run.messageId) : null
  const events: ChatSessionEvent[] = []
  if (message) {
    events.push({
      type: 'AssistantMessageCompleted',
      payload: {
        message: {
          id: message.id,
          sessionId: run.chatSessionId,
          content: message.content,
          messageJson: normalizeTerminalMessageJson(message),
          status: 'aborted',
          errorText: null,
          updatedAt: finishedAt
        }
      }
    })
  }
  events.push({
    type: 'RunAborted',
    payload: {
      runId: run.id,
      sessionId: run.chatSessionId,
      queueItemId: readRunQueueItemId(run.chatSessionId, run.id),
      ...(run.bindingId !== null ? { bindingId: run.bindingId } : {}),
      status: 'aborted',
      stopReason: 'response.cancelled',
      errorText: null,
      finishedAt
    }
  })
  commitSessionEventsInTransaction(run.chatSessionId, events)
  return true
}

function readRun(sessionId: string, runId: string): BackendRun | undefined {
  return db()
    .select()
    .from(backendRuns)
    .where(and(eq(backendRuns.id, runId), eq(backendRuns.chatSessionId, sessionId)))
    .get()
}

function readStreamingRuns(sessionId?: string): BackendRun[] {
  const predicate = sessionId
    ? and(eq(backendRuns.chatSessionId, sessionId), eq(backendRuns.status, 'streaming'))
    : eq(backendRuns.status, 'streaming')
  return db().select().from(backendRuns).where(predicate).all()
}

function readTerminalRuns(sessionId: string): BackendRun[] {
  return db()
    .select()
    .from(backendRuns)
    .where(
      and(
        eq(backendRuns.chatSessionId, sessionId),
        or(
          eq(backendRuns.status, 'complete'),
          eq(backendRuns.status, 'aborted'),
          eq(backendRuns.status, 'failed')
        )
      )
    )
    .all()
}

function readMessage(sessionId: string, messageId: string): Message | undefined {
  return db()
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.sessionId, sessionId)))
    .get()
}

function readRunQueueItemId(sessionId: string, runId: string): string | null {
  return (
    db()
      .select({ id: chatSessionQueueItems.id })
      .from(chatSessionQueueItems)
      .where(
        and(
          eq(chatSessionQueueItems.sessionId, sessionId),
          eq(chatSessionQueueItems.mode, 'queue'),
          eq(chatSessionQueueItems.startedRunId, runId)
        )
      )
      .get()?.id ?? null
  )
}

function normalizeTerminalMessageJson(message: Message): string {
  try {
    const parsed = parseStoredMessageSnapshot(message.messageJson)
    return JSON.stringify(parsed)
  } catch {
    return message.messageJson
  }
}
