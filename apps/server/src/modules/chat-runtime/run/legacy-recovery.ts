import type { BackendRun } from '@cradle/db'
import { backendRunSnapshots, backendRuns, chatSessionQueueItems, messages, sessions } from '@cradle/db'
import { and, eq, or } from 'drizzle-orm'

import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'

const ORPHANED_STREAMING_RUN_STOP_REASON = 'response.interrupted'
const ORPHANED_STREAMING_RUN_ERROR_TEXT =
  'Response interrupted because the Cradle server process exited while the run was streaming.'

type TerminalRunProjectionStatus = Extract<BackendRun['status'], 'complete' | 'aborted' | 'failed'>

interface TerminalRunProjectionRepairOptions {
  persistBackendRun?: boolean
}

export function failLegacyOrphanedPersistedRun(run: BackendRun): void {
  if (run.status !== 'streaming') {
    repairLegacyTerminalRunProjection(run)
    return
  }

  const now = currentUnixSeconds()
  repairLegacyTerminalRunProjection(
    {
      ...run,
      status: 'failed',
      stopReason: ORPHANED_STREAMING_RUN_STOP_REASON,
      errorText: ORPHANED_STREAMING_RUN_ERROR_TEXT,
      finishedAt: now,
    },
    { persistBackendRun: true },
  )
}

export function failLegacyOrphanedPersistedStreamingSession(sessionId: string): void {
  repairLegacyTerminalRunProjections({ sessionId })

  const streamingRuns = db()
    .select()
    .from(backendRuns)
    .where(and(eq(backendRuns.chatSessionId, sessionId), eq(backendRuns.status, 'streaming')))
    .all()

  if (streamingRuns.length > 0) {
    for (const run of streamingRuns) {
      failLegacyOrphanedPersistedRun(run)
    }
    markLegacyPersistedStreamingMessages(sessionId, 'failed', ORPHANED_STREAMING_RUN_ERROR_TEXT)
    return
  }

  markLegacyPersistedStreamingMessages(sessionId, 'failed', ORPHANED_STREAMING_RUN_ERROR_TEXT)
}

export function repairLegacyTerminalRunProjections(input: { sessionId?: string } = {}): number {
  const terminalStatusPredicate = or(
    eq(backendRuns.status, 'complete'),
    eq(backendRuns.status, 'aborted'),
    eq(backendRuns.status, 'failed'),
  )
  const terminalRuns = db()
    .select()
    .from(backendRuns)
    .where(
      input.sessionId
        ? and(eq(backendRuns.chatSessionId, input.sessionId), terminalStatusPredicate)
        : terminalStatusPredicate,
    )
    .all()

  return terminalRuns.reduce(
    (count, run) => (repairLegacyTerminalRunProjection(run) ? count + 1 : count),
    0,
  )
}

export function repairLegacyTerminalRunProjection(
  run: BackendRun,
  options: TerminalRunProjectionRepairOptions = {},
): boolean {
  const status = readLegacyTerminalRunProjectionStatus(run.status)
  if (!status) {
    return false
  }

  const now = currentUnixSeconds()
  const finishedAt = run.finishedAt ?? now
  let changed = false
  const messagePredicate = run.messageId
    ? and(
        eq(messages.sessionId, run.chatSessionId),
        eq(messages.status, 'streaming'),
        or(eq(messages.id, run.messageId), eq(messages.parentMessageId, run.messageId)),
      )
    : and(eq(messages.sessionId, run.chatSessionId), eq(messages.status, 'streaming'))

  db().transaction((tx) => {
    if (options.persistBackendRun) {
      const runResult = tx
        .update(backendRuns)
        .set({
          status,
          stopReason: readLegacyTerminalRunCompletionReason(run, status),
          errorText: run.errorText,
          finishedAt,
        })
        .where(eq(backendRuns.id, run.id))
        .run()
      changed = changed || runResult.changes > 0
    }

    const messageResult = tx
      .update(messages)
      .set({
        status,
        errorText: run.errorText,
        updatedAt: now,
      })
      .where(messagePredicate)
      .run()
    changed = changed || messageResult.changes > 0

    const queueResult = tx
      .update(chatSessionQueueItems)
      .set({
        status: toLegacyQueueTerminalStatus(status),
        errorText: run.errorText,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatSessionQueueItems.startedRunId, run.id),
          eq(chatSessionQueueItems.mode, 'queue'),
          eq(chatSessionQueueItems.status, 'running'),
        ),
      )
      .run()
    changed = changed || queueResult.changes > 0

    const snapshotResult = tx
      .update(backendRunSnapshots)
      .set({
        status,
        completedAt: finishedAt * 1000,
        completionReason: readLegacyTerminalRunCompletionReason(run, status),
        errorText: run.errorText,
      })
      .where(and(eq(backendRunSnapshots.runId, run.id), eq(backendRunSnapshots.status, 'running')))
      .run()
    changed = changed || snapshotResult.changes > 0

    if (changed) {
      tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, run.chatSessionId)).run()
    }
  })

  return changed
}

export function readLegacyTerminalRunProjectionStatus(
  status: BackendRun['status'],
): TerminalRunProjectionStatus | null {
  return status === 'complete' || status === 'aborted' || status === 'failed' ? status : null
}

function toLegacyQueueTerminalStatus(status: TerminalRunProjectionStatus) {
  return status === 'complete' ? 'completed' : status === 'aborted' ? 'cancelled' : 'failed'
}

function readLegacyTerminalRunCompletionReason(
  run: BackendRun,
  status: TerminalRunProjectionStatus,
): string {
  if (run.stopReason) {
    return run.stopReason
  }
  return status === 'complete'
    ? 'response.completed'
    : status === 'aborted'
      ? 'response.cancelled'
      : 'response.failed'
}

function markLegacyPersistedStreamingMessages(
  sessionId: string,
  status: TerminalRunProjectionStatus,
  errorText: string | null,
): void {
  const now = currentUnixSeconds()
  db().transaction((tx) => {
    tx.update(messages)
      .set({
        status,
        errorText,
        updatedAt: now,
      })
      .where(and(eq(messages.sessionId, sessionId), eq(messages.status, 'streaming')))
      .run()

    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, sessionId)).run()
  })
}
