import { chatSessionQueueItems } from '@cradle/db'
import type { FileUIPart } from 'ai'

import { AppError } from '../../../errors/app-error'
import { currentUnixSeconds } from '../../../helpers/time'
import type { ChatContextPart } from '../context-parts'
import type { ChatRuntimeSettings } from '../runtime-provider-types'
import type { SerializedChatError } from '../run/errors'
import type { PersistedThinkingEffort } from './session-queue'
import {
  compareQueueRows,
  listPendingQueueRows,
  parseQueueContextParts,
  parseQueueFiles,
  readPersistedThinkingEffort,
  readQueueItemRuntimeSettings,
} from './session-queue'

const drainingSessionIds = new Set<string>()
const requestedDrainSessionIds = new Set<string>()

export interface QueueDrainDeps {
  hasActiveOrPendingRun(sessionId: string): boolean
  readSessionRuntimeSettings(sessionId: string): ChatRuntimeSettings
  onQueueItemClaimed(input: { sessionId: string, row: typeof chatSessionQueueItems.$inferSelect }): typeof chatSessionQueueItems.$inferSelect | undefined
  onQueueItemReleased(input: { sessionId: string, row: typeof chatSessionQueueItems.$inferSelect }): typeof chatSessionQueueItems.$inferSelect | undefined
  onQueueItemFailed(input: { sessionId: string, row: typeof chatSessionQueueItems.$inferSelect }): typeof chatSessionQueueItems.$inferSelect | undefined
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
    while (!deps.hasActiveOrPendingRun(sessionId)) {
      const next = listPendingQueueRows(sessionId).sort(compareQueueRows)[0]
      if (!next) {
        return
      }

      const claimed = claimQueueItem(next)
      if (!claimed) {
        continue
      }
      deps.onQueueItemClaimed({ sessionId, row: claimed })

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
        return
      } catch (error) {
        if (error instanceof AppError && error.code === 'chat_run_cancelled') {
          return
        }

        if (error instanceof AppError && error.code === 'chat_run_in_progress') {
          deps.onQueueItemReleased({ sessionId, row: releaseClaimedQueueItem(claimed) })
          return
        }

        deps.onQueueItemFailed({
          sessionId,
          row: failClaimedQueueItem(claimed, deps.serializeError(error).text),
        })
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

function claimQueueItem(row: typeof chatSessionQueueItems.$inferSelect) {
  return {
    ...row,
    status: 'running' as const,
    updatedAt: currentUnixSeconds(),
  }
}

function releaseClaimedQueueItem(row: typeof chatSessionQueueItems.$inferSelect) {
  return {
    ...row,
    status: 'pending' as const,
    startedRunId: null,
    errorText: null,
    updatedAt: currentUnixSeconds(),
  }
}

function failClaimedQueueItem(row: typeof chatSessionQueueItems.$inferSelect, errorText: string) {
  return {
    ...row,
    status: 'failed' as const,
    errorText,
    updatedAt: currentUnixSeconds(),
  }
}
