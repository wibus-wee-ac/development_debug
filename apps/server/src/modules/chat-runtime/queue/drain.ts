import { chatSessionQueueItems } from '@cradle/db'
import type { FileUIPart } from 'ai'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import type { ChatContextPart } from '../context-parts'
import type { ChatRuntimeSettings } from '../runtime-provider-types'
import type { SerializedChatError } from '../run/errors'
import type { PersistedThinkingEffort } from './session-queue'
import {
  compareQueueRows,
  listPendingQueueRows,
  normalizePendingQueuePositions,
  parseQueueContextParts,
  parseQueueFiles,
  readPersistedThinkingEffort,
  readQueueItemRuntimeSettings,
  recoverOrphanedRunningQueueItems
} from './session-queue'

const drainingSessionIds = new Set<string>()
const requestedDrainSessionIds = new Set<string>()

export interface QueueDrainDeps {
  hasActiveOrPendingRun(sessionId: string): boolean
  readSessionRuntimeSettings(sessionId: string): ChatRuntimeSettings
  createQueuedRun(input: {
    sessionId: string
    text: string
    files: FileUIPart[]
    contextParts: ChatContextPart[]
    providerTargetId?: string
    modelId?: string
    thinkingEffort?: PersistedThinkingEffort
    runtimeSettings: ChatRuntimeSettings
    queueItemId: string
  }): Promise<{ runId: string }>
  serializeError(error: unknown): SerializedChatError
}

export function scheduleSessionQueueDrain(sessionId: string, deps: QueueDrainDeps): void {
  if (drainingSessionIds.has(sessionId)) {
    requestedDrainSessionIds.add(sessionId)
    return
  }

  requestedDrainSessionIds.add(sessionId)
  queueMicrotask(() => {
    void drainSessionQueue(sessionId, deps)
  })
}

async function drainSessionQueue(sessionId: string, deps: QueueDrainDeps): Promise<void> {
  if (drainingSessionIds.has(sessionId)) {
    requestedDrainSessionIds.add(sessionId)
    return
  }
  if (deps.hasActiveOrPendingRun(sessionId)) {
    return
  }

  drainingSessionIds.add(sessionId)
  requestedDrainSessionIds.delete(sessionId)
  try {
    recoverOrphanedRunningQueueItems(sessionId)
    while (!deps.hasActiveOrPendingRun(sessionId)) {
      const next = listPendingQueueRows(sessionId).sort(compareQueueRows)[0]
      if (!next) {
        return
      }

      const claimed = claimQueueItem(sessionId, next.id)
      if (!claimed) {
        continue
      }

      try {
        const runtimeSettings = readQueueItemRuntimeSettings(
          claimed,
          deps.readSessionRuntimeSettings(sessionId)
        )
        const run = await deps.createQueuedRun({
          sessionId,
          text: claimed.text,
          files: parseQueueFiles(claimed.filesJson),
          contextParts: parseQueueContextParts(claimed.contextPartsJson),
          providerTargetId: claimed.providerTargetId ?? undefined,
          modelId: claimed.modelId ?? undefined,
          thinkingEffort: readPersistedThinkingEffort(claimed.thinkingEffort) ?? undefined,
          runtimeSettings,
          queueItemId: claimed.id
        })
        markQueueItemStarted(sessionId, claimed.id, run.runId)
        normalizePendingQueuePositions(sessionId)
        return
      } catch (error) {
        if (error instanceof AppError && error.code === 'chat_run_cancelled') {
          normalizePendingQueuePositions(sessionId)
          return
        }

        if (error instanceof AppError && error.code === 'chat_run_in_progress') {
          releaseClaimedQueueItem(sessionId, claimed.id)
          return
        }

        failClaimedQueueItem(sessionId, claimed.id, deps.serializeError(error).text)
        normalizePendingQueuePositions(sessionId)
      }
    }
  } finally {
    drainingSessionIds.delete(sessionId)
    if (
      requestedDrainSessionIds.delete(sessionId) ||
      (!deps.hasActiveOrPendingRun(sessionId) && listPendingQueueRows(sessionId).length > 0)
    ) {
      scheduleSessionQueueDrain(sessionId, deps)
    }
  }
}

function claimQueueItem(sessionId: string, queueItemId: string) {
  return db()
    .update(chatSessionQueueItems)
    .set({ status: 'running', updatedAt: currentUnixSeconds() })
    .where(
      and(
        eq(chatSessionQueueItems.id, queueItemId),
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.mode, 'queue'),
        eq(chatSessionQueueItems.status, 'pending')
      )
    )
    .returning()
    .get()
}

function markQueueItemStarted(sessionId: string, queueItemId: string, runId: string): void {
  db()
    .update(chatSessionQueueItems)
    .set({
      startedRunId: runId,
      updatedAt: currentUnixSeconds()
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, queueItemId),
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.mode, 'queue'),
        eq(chatSessionQueueItems.status, 'running')
      )
    )
    .run()
}

function releaseClaimedQueueItem(sessionId: string, queueItemId: string): void {
  db()
    .update(chatSessionQueueItems)
    .set({
      status: 'pending',
      startedRunId: null,
      errorText: null,
      updatedAt: currentUnixSeconds()
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, queueItemId),
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.mode, 'queue'),
        eq(chatSessionQueueItems.status, 'running')
      )
    )
    .run()
}

function failClaimedQueueItem(sessionId: string, queueItemId: string, errorText: string): void {
  db()
    .update(chatSessionQueueItems)
    .set({
      status: 'failed',
      errorText,
      updatedAt: currentUnixSeconds()
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, queueItemId),
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.mode, 'queue'),
        eq(chatSessionQueueItems.status, 'running')
      )
    )
    .run()
}
