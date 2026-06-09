import { desc, eq, sql } from 'drizzle-orm'

import { backendRuns } from '@cradle/db'

import { db } from '../../infra'
import { foldChatRuntimeEvents } from './event-fold'
import { readChatRuntimeEvents } from './event-store'

export interface EventDerivedRuntimeState {
  hasEvents: boolean
  status: 'idle' | 'streaming' | 'error'
  activeRunId: string | null
  latestRunId: string | null
  latestRunStatus: 'streaming' | 'complete' | 'aborted' | 'failed' | null
  queue: {
    pending: number
    running: number
  }
}

export function readEventDerivedRuntimeState(sessionId: string): EventDerivedRuntimeState {
  const events = readChatRuntimeEvents(sessionId)
  if (events.length === 0) {
    return readLegacyRuntimeState(sessionId)
  }

  const state = foldChatRuntimeEvents(sessionId, events)
  return {
    hasEvents: true,
    status: state.status,
    activeRunId: state.activeRun?.id ?? null,
    latestRunId: state.latestRun?.id ?? null,
    latestRunStatus: state.latestRun?.status ?? null,
    queue: Array.from(state.queue.values()).reduce(
      (counts, item) => {
        if (item.status === 'pending') {
          return { ...counts, pending: counts.pending + 1 }
        }
        if (item.status === 'running') {
          return { ...counts, running: counts.running + 1 }
        }
        return counts
      },
      { pending: 0, running: 0 },
    ),
  }
}

function readLegacyRuntimeState(sessionId: string): EventDerivedRuntimeState {
  const latestRun = db()
    .select({
      id: backendRuns.id,
      status: backendRuns.status,
    })
    .from(backendRuns)
    .where(eq(backendRuns.chatSessionId, sessionId))
    .orderBy(desc(backendRuns.startedAt), desc(sql`backend_runs.rowid`))
    .get()

  return {
    hasEvents: false,
    status: latestRun?.status === 'streaming'
      ? 'streaming'
      : latestRun?.status === 'failed'
        ? 'error'
        : 'idle',
    activeRunId: latestRun?.status === 'streaming' ? latestRun.id : null,
    latestRunId: latestRun?.id ?? null,
    latestRunStatus: latestRun?.status ?? null,
    queue: { pending: 0, running: 0 },
  }
}
