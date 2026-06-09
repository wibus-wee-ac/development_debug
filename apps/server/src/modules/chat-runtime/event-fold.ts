import type {
  ChatRuntimeEventRecord,
  ChatRuntimeQueueStatus,
  ChatRuntimeRunStatus,
} from './events'
import { isTerminalRunEventType, readRunStatusFromEventType } from './events'

export interface ChatRuntimeFoldRun {
  id: string
  messageId: string | null
  queueItemId: string | null
  status: ChatRuntimeRunStatus
  startedAt: number | null
  finishedAt: number | null
  errorText: string | null
}

export interface ChatRuntimeFoldMessage {
  id: string
  role: 'user' | 'assistant'
  status: ChatRuntimeRunStatus | 'complete'
  runId: string | null
  createdAt: number
  payload: Record<string, unknown>
}

export interface ChatRuntimeFoldQueueItem {
  id: string
  status: ChatRuntimeQueueStatus
  runId: string | null
  position: number | null
  payload: Record<string, unknown>
}

export interface ChatRuntimeFoldState {
  streamId: string
  seq: number
  activeRun: ChatRuntimeFoldRun | null
  latestRun: ChatRuntimeFoldRun | null
  runs: Map<string, ChatRuntimeFoldRun>
  messages: Map<string, ChatRuntimeFoldMessage>
  queue: Map<string, ChatRuntimeFoldQueueItem>
  status: 'idle' | 'streaming' | 'error'
}

export function foldChatRuntimeEvents(
  streamId: string,
  events: ChatRuntimeEventRecord[],
): ChatRuntimeFoldState {
  const runs = new Map<string, ChatRuntimeFoldRun>()
  const messages = new Map<string, ChatRuntimeFoldMessage>()
  const queue = new Map<string, ChatRuntimeFoldQueueItem>()
  let latestRun: ChatRuntimeFoldRun | null = null
  let seq = 0

  for (const event of events) {
    if (event.streamId !== streamId) {
      continue
    }
    seq = Math.max(seq, event.seq)

    if (event.type === 'user_message.appended' && event.messageId) {
      messages.set(event.messageId, {
        id: event.messageId,
        role: 'user',
        status: 'complete',
        runId: event.runId,
        createdAt: event.occurredAt,
        payload: event.payload,
      })
      continue
    }

    if (event.type === 'assistant_message.created' && event.messageId) {
      messages.set(event.messageId, {
        id: event.messageId,
        role: 'assistant',
        status: 'streaming',
        runId: event.runId,
        createdAt: event.occurredAt,
        payload: event.payload,
      })
      continue
    }

    if (event.type === 'assistant_message.snapshot_recorded' && event.messageId) {
      const existing = messages.get(event.messageId)
      messages.set(event.messageId, {
        id: event.messageId,
        role: 'assistant',
        status: readSnapshotStatus(event.payload) ?? existing?.status ?? 'complete',
        runId: event.runId ?? existing?.runId ?? null,
        createdAt: existing?.createdAt ?? event.occurredAt,
        payload: event.payload,
      })
      continue
    }

    const runStatus = readRunStatusFromEventType(event.type)
    if (event.runId && runStatus) {
      const existing = runs.get(event.runId)
      const next: ChatRuntimeFoldRun = {
        id: event.runId,
        messageId: event.messageId ?? existing?.messageId ?? null,
        queueItemId: event.queueItemId ?? existing?.queueItemId ?? null,
        status: runStatus,
        startedAt: event.type === 'run.started'
          ? event.occurredAt
          : existing?.startedAt ?? null,
        finishedAt: isTerminalRunEventType(event.type)
          ? event.occurredAt
          : existing?.finishedAt ?? null,
        errorText: readErrorText(event.payload) ?? existing?.errorText ?? null,
      }
      runs.set(event.runId, next)
      latestRun = next
      if (next.messageId) {
        const message = messages.get(next.messageId)
        if (message?.role === 'assistant') {
          messages.set(next.messageId, {
            ...message,
            status: next.status,
            runId: next.id,
          })
        }
      }
      if (next.queueItemId && isTerminalRunEventType(event.type)) {
        const item = queue.get(next.queueItemId)
        if (item) {
          queue.set(next.queueItemId, {
            ...item,
            runId: next.id,
            status: next.status === 'complete'
              ? 'completed'
              : next.status === 'aborted'
                ? 'cancelled'
                : 'failed',
          })
        }
      }
      continue
    }

    if (event.type === 'queue.item_reordered') {
      const positions = readQueuePositions(event.payload)
      for (const [queueItemId, position] of positions) {
        const existing = queue.get(queueItemId)
        if (!existing) {
          continue
        }
        queue.set(queueItemId, {
          ...existing,
          position,
          payload: {
            ...existing.payload,
            updatedAt: event.payload.updatedAt,
          },
        })
      }
      continue
    }

    if (event.queueItemId && event.type.startsWith('queue.item_')) {
      const existing = queue.get(event.queueItemId)
      queue.set(event.queueItemId, {
        id: event.queueItemId,
        status: readQueueStatus(event.type) ?? existing?.status ?? 'pending',
        runId: event.runId ?? existing?.runId ?? null,
        position: readPosition(event.payload) ?? existing?.position ?? null,
        payload: {
          ...(existing?.payload ?? {}),
          ...event.payload,
        },
      })
      continue
    }

    // Run provider context events are metadata only. Provider Runtime owns
    // durable binding state, so the lifecycle fold intentionally ignores them.
  }

  const activeRun = Array.from(runs.values()).find(run => run.status === 'streaming') ?? null
  const status = activeRun
    ? 'streaming'
    : latestRun?.status === 'failed'
      ? 'error'
      : 'idle'

  return {
    streamId,
    seq,
    activeRun,
    latestRun,
    runs,
    messages,
    queue,
    status,
  }
}

function readSnapshotStatus(payload: Record<string, unknown>): ChatRuntimeFoldMessage['status'] | null {
  const value = payload.status
  return value === 'streaming' || value === 'complete' || value === 'aborted' || value === 'failed'
    ? value
    : null
}

function readErrorText(payload: Record<string, unknown>): string | null {
  return typeof payload.errorText === 'string' ? payload.errorText : null
}

function readQueueStatus(type: ChatRuntimeEventRecord['type']): ChatRuntimeQueueStatus | null {
  switch (type) {
    case 'queue.item_enqueued':
      return 'pending'
    case 'queue.item_claimed':
      return 'running'
    case 'queue.item_completed':
      return 'completed'
    case 'queue.item_failed':
      return 'failed'
    case 'queue.item_cancelled':
      return 'cancelled'
    default:
      return null
  }
}

function readPosition(payload: Record<string, unknown>): number | null {
  return typeof payload.position === 'number' && Number.isFinite(payload.position)
    ? payload.position
    : null
}

function readQueuePositions(payload: Record<string, unknown>): Array<[string, number]> {
  const raw = payload.positions
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((item): Array<[string, number]> => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }
    const record = item as Record<string, unknown>
    if (typeof record.queueItemId !== 'string') {
      return []
    }
    if (typeof record.position !== 'number' || !Number.isFinite(record.position)) {
      return []
    }
    return [[record.queueItemId, record.position]]
  })
}
