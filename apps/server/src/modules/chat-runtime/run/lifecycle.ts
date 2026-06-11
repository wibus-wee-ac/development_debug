import type { BackendRun } from '@cradle/db'
import { backendRuns, chatSessionQueueItems } from '@cradle/db'
import { and, eq } from 'drizzle-orm'

import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'

export type PersistableChatRunStatus = Extract<BackendRun['status'], 'complete' | 'aborted' | 'failed'>

export interface FinalizeBackendRunInput {
  runId: string
  sessionId: string
  queueItemId?: string | null
  status: PersistableChatRunStatus
  errorText: string | null
}

export function finalizeBackendRun(input: FinalizeBackendRunInput): void {
  const stopReason = readStopReason(input.status)
  db()
    .update(backendRuns)
    .set({
      status: input.status,
      stopReason,
      errorText: input.errorText,
      finishedAt: currentUnixSeconds()
    })
    .where(eq(backendRuns.id, input.runId))
    .run()
  if (input.queueItemId) {
    db()
      .update(chatSessionQueueItems)
      .set({
        status:
          input.status === 'complete'
            ? 'completed'
            : input.status === 'aborted'
              ? 'cancelled'
              : 'failed',
        errorText: input.errorText,
        startedRunId: input.runId,
        updatedAt: currentUnixSeconds()
      })
      .where(
        and(
          eq(chatSessionQueueItems.id, input.queueItemId),
          eq(chatSessionQueueItems.sessionId, input.sessionId),
          eq(chatSessionQueueItems.status, 'running')
        )
      )
      .run()
  }
}

function readStopReason(status: PersistableChatRunStatus): string {
  return status === 'complete'
    ? 'response.completed'
    : status === 'aborted'
      ? 'response.cancelled'
      : 'response.failed'
}
