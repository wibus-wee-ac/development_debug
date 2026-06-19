import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { chatSelectors, useChatStore } from '~/store/chat'
import { useSessionLayoutStore } from '~/store/session-layout'

import { listChatSessionQueue } from '../commands/chat-response-command'
import { useRuntimeSessionStatus } from '../runtime/use-runtime-session-status'
import { useChatActions } from './use-chat-actions'
import { useChatQueue } from './use-chat-queue'
import { useChatSessionRuntimeControls } from './use-chat-session-runtime-controls'
import { EMPTY_QUEUE_ITEMS } from './use-chat-session-types'

// Re-export types and utilities for public API compatibility
export type {
  ChatContinuationMode,
  ChatQueueItem,
  ChatSessionMessageRow,
  RuntimeUserInputSubmitInput,
  SendMessageOptions,
  SendMessageResult,
  ToolApprovalResponseInput,
} from './use-chat-session-types'
export { projectMainMessagesFromSnapshotRows } from './use-chat-session-types'

// Re-export the driver hook
export { useChatSessionDriver } from './use-chat-session-driver'

// ── Facade Hook ────────────────────────────────────────────

export function useChatSession(chatSessionId: string | null, active = true) {
  const controls = useChatSessionRuntimeControls(chatSessionId)
  const { queueQueryKey } = controls
  const queryEnabled = active && !!chatSessionId

  const messageIds = useChatStore(
    useShallow(chatSelectors.messageIds(chatSessionId ?? '')),
  )
  const visibleStatus = useChatStore(
    chatSelectors.visibleStatus(chatSessionId ?? ''),
  )
  const isStreaming = useChatStore(
    chatSelectors.isSessionStreaming(chatSessionId ?? ''),
  )
  const isHydrated = useChatStore(
    chatSessionId ? chatSelectors.isSessionHydrated(chatSessionId) : () => true,
  )

  const latestError = useChatStore(
    chatSessionId ? chatSelectors.latestError(chatSessionId) : () => undefined,
  )
  const queueQuery = useQuery({
    queryKey: queueQueryKey,
    queryFn: () => listChatSessionQueue(chatSessionId!),
    enabled: queryEnabled,
    refetchInterval: query => visibleStatus === 'streaming'
      || query.state.data?.items.some(item => item.status === 'pending' || item.status === 'running')
      ? 1000
      : false,
  })
  const runtimeStatusQuery = useRuntimeSessionStatus(queryEnabled ? chatSessionId : null)
  const runtimeStatus = runtimeStatusQuery.data
  const runtimeKind = useSessionLayoutStore(
    useShallow(state => chatSessionId ? state.sessions[chatSessionId]?.runtimeKind ?? null : null),
  )

  const { sendMessage, respondToToolApproval, submitPendingUserInput, stop } = useChatActions({
    chatSessionId,
    controls,
    runtimeStatus,
    runtimeKind,
  })

  const { cancelQueueItem, reorderQueueItems } = useChatQueue(chatSessionId, controls)

  // ── isReady (always true once hydrated) ──

  const messageCount = messageIds.length
  const isReady = messageCount > 0 || isHydrated || chatSessionId === null
  const serverBusy = Boolean(
    runtimeStatus
    && (
      runtimeStatus.status === 'streaming'
      || runtimeStatus.status === 'pending'
      || runtimeStatus.status === 'cancelling'
      || runtimeStatus.activeRun
    ),
  )
  const serverStreaming = Boolean(runtimeStatus && (runtimeStatus.status === 'streaming' || runtimeStatus.activeRun))
  const resolvedStreaming = serverStreaming || (!runtimeStatus && isStreaming)

  useEffect(() => {
    if (latestError) {
      console.error(`[useChatSession] error for session ${chatSessionId}:`, latestError)
    }
  }, [chatSessionId, latestError])

  return {
    messageIds,
    messageCount,
    status: visibleStatus,
    isStreaming: resolvedStreaming,
    isBusy: serverBusy || (!runtimeStatus && isStreaming),
    canStop: serverStreaming || (!runtimeStatus && isStreaming),
    error: latestError?.message,
    sendMessage,
    respondToToolApproval,
    submitPendingUserInput,
    stop,
    isReady,
    queueItems: queueQuery.data?.items ?? EMPTY_QUEUE_ITEMS,
    cancelQueueItem,
    reorderQueueItems,
  }
}
