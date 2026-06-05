/**
 * Output: Codex turn notification stream helpers and provider-thread event fanout.
 * Input: app-server client notifications, active goal snapshots, and provider-thread subscribers.
 * Position: Codex provider package owner for single-turn stream notification orchestration.
 */

import type { ProviderThreadEvent } from '../../chat-runtime/runtime-provider-types'
import type { CodexAppServerMessage } from './app-server-client'
import {
  closeOpenCodexAppServerReasoning,
  closeOpenCodexAppServerText,
  createCodexAppServerMapperState,
  mapCodexAppServerNotificationToChunks,
} from './event-to-chunk-mapper'
import {
  getNotificationTurnId,
  getThreadId,
  getTurnId,
} from './stream-diagnostics'

const ACTIVE_GOAL_CONTINUATION_DELAY_MS = 250

interface CodexAppServerClientLike {
  request: (method: string, params?: unknown) => Promise<unknown>
  nextNotification: (signal?: AbortSignal) => Promise<CodexAppServerMessage | null>
}

interface CodexGoalLike {
  objective?: string | null
  status?: string | null
}

interface ThreadStatusChangedNotificationParams {
  status?: { type?: string }
}

interface CodexGoalUpdatedNotificationParams {
  goal?: { status?: string | null }
}

export function isCompletedGoalUpdate(notification: CodexAppServerMessage): boolean {
  if (notification.method !== 'thread/goal/updated') {
    return false
  }
  const params = notification.params as CodexGoalUpdatedNotificationParams | undefined
  return params?.goal?.status === 'complete'
}

export function publishProviderThreadEvent(
  onProviderThreadEvent: ((event: ProviderThreadEvent) => void) | undefined,
  notification: CodexAppServerMessage,
  mapperStates: Map<string, ReturnType<typeof createCodexAppServerMapperState>>,
): void {
  if (!onProviderThreadEvent) {
    return
  }
  const providerThreadId = getThreadId(notification)
  if (!providerThreadId) {
    return
  }
  try {
    let state = mapperStates.get(providerThreadId)
    if (!state) {
      state = createCodexAppServerMapperState(`provider-thread:${providerThreadId}`)
      mapperStates.set(providerThreadId, state)
    }
    const chunks = mapCodexAppServerNotificationToChunks(notification, state)
    if (notification.method === 'turn/completed') {
      chunks.push(...closeOpenCodexAppServerReasoning(state))
      chunks.push(...closeOpenCodexAppServerText(state))
      chunks.push({ type: 'finish', finishReason: 'stop' })
    }
    if (chunks.length === 0) {
      return
    }
    onProviderThreadEvent({
      providerThreadId,
      providerTurnId: getNotificationTurnId(notification),
      notification,
      chunks,
    })
  }
  catch {
    // Provider-thread subscribers must not affect the parent turn stream.
  }
}

export async function* readTurnNotifications(
  client: CodexAppServerClientLike,
  threadId: string,
  initialTurnId: string | null,
  signal: AbortSignal,
  readGoal: () => CodexGoalLike | null | undefined,
  onProviderNotification?: (notification: CodexAppServerMessage) => void,
): AsyncGenerator<CodexAppServerMessage, void, void> {
  let turnId = initialTurnId
  let turnCompleted = false
  while (!signal.aborted) {
    let notification: CodexAppServerMessage | null
    try {
      notification = await client.nextNotification(signal)
    }
    catch (error) {
      if (signal.aborted) {
        return
      }
      throw error
    }
    if (!notification) {
      return
    }
    onProviderNotification?.(notification)
    const notificationThreadId = getThreadId(notification)
    if (notificationThreadId && notificationThreadId !== threadId) {
      continue
    }
    if (notification.method === 'turn/started') {
      turnId = getTurnId(notification)
      turnCompleted = false
      yield notification
      continue
    }
    const notificationTurnId = getNotificationTurnId(notification)
    if (turnId && notificationTurnId && notificationTurnId !== turnId) {
      continue
    }
    yield notification
    if (notification.method === 'turn/completed') {
      turnCompleted = true
      if (!hasActiveGoal(readGoal())) {
        return
      }
      continue
    }
    if (turnCompleted && isIdleThreadStatus(notification)) {
      if (!hasActiveGoal(readGoal())) {
        return
      }
      if (!await continueActiveGoal(client, threadId, signal)) {
        return
      }
      turnId = null
      turnCompleted = false
    }
    if (turnCompleted) {
      if (!hasActiveGoal(readGoal())) {
        return
      }
    }
  }
}

export async function continueActiveGoal(
  client: Pick<CodexAppServerClientLike, 'request'>,
  threadId: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (!await waitForActiveGoalContinuationDelay(signal)) {
    return false
  }
  await client.request('thread/goal/set', { threadId, status: 'active' })
  return true
}

function isIdleThreadStatus(notification: CodexAppServerMessage): boolean {
  if (notification.method !== 'thread/status/changed') {
    return false
  }
  const params = notification.params as ThreadStatusChangedNotificationParams | undefined
  return params?.status?.type === 'idle'
}

function hasActiveGoal(goal: CodexGoalLike | null | undefined): boolean {
  return goal?.status === 'active' && typeof goal.objective === 'string' && goal.objective.trim().length > 0
}

function waitForActiveGoalContinuationDelay(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ACTIVE_GOAL_CONTINUATION_DELAY_MS)
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
