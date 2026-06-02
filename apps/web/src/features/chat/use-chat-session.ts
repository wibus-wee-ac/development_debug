import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FileUIPart, UIMessage } from 'ai'
import { lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'

import {
  getChatSessionsBySessionIdMessagesOptions,
  getChatSessionsBySessionIdMessagesQueryKey,
  getSessionsByIdQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { isSessionsQueryKey, updateSessionInSessionLists } from '~/features/workspace/use-session'
import type { PublicStatus } from '~/store/chat'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useSessionLayoutStore } from '~/store/session-layout'

import { runtimeUiSlotStatesQueryKey } from './chat-capabilities'
import type { ChatContextPart } from './chat-context-parts'
import { toOrderedUserMessageParts } from './chat-context-parts'
import { createContinuationUserMessage } from './chat-continuation-metadata'
import type { ChatContinuationMode, ChatPermissionMode, ChatQueueItem } from './chat-response-command'
import {
  cancelChatResponse,
  cancelChatSessionQueueItem,
  enqueueChatSessionQueueItem,
  listChatSessionQueue,
  reorderChatSessionQueue,
  switchChatPermissionMode,
} from './chat-response-command'
import { startChatResponseStream, subscribeChatSessionStreamForSession } from './chat-stream-transport'
import { ChatStreamingHandler } from './chat-streaming-handler'

// ── Compatibility Exports (used by tests) ───────────────────

type ChatSnapshotState = { status: PublicStatus, error?: string }

export function derivePassiveChatState(
  rows: Array<{ role: string, status: string, errorText?: string | null }>,
): ChatSnapshotState {
  if (rows.some(row => row.status === 'streaming')) {
    return { status: 'streaming' }
  }
  const failedAssistant = [...rows]
    .reverse()
    .find(row => row.role === 'assistant' && row.status === 'failed')
  if (failedAssistant) {
    return { status: 'error', error: failedAssistant.errorText ?? undefined }
  }
  return { status: 'idle' }
}

export function resolveVisibleChatState(
  liveStatus: PublicStatus,
  passiveStatus: PublicStatus,
): PublicStatus {
  if (liveStatus === 'streaming' || liveStatus === 'error') {
    return liveStatus
  }
  return passiveStatus
}

export async function stopChatTurn(args: {
  chatSessionId: string | null
  chatStop: () => Promise<void> | void
}): Promise<void> {
  await Promise.resolve(args.chatStop())
}

// ── Message Snapshot Types ──────────────────────────────────

export interface ChatSessionMessageRow {
  messageId: string
  role: 'user' | 'assistant'
  status: string
  errorText?: string | null
  content: string
  message: UIMessage
  parentMessageId: string | null
  parentToolCallId: string | null
  taskId: string | null
  depth: number
}
export type { ChatContinuationMode, ChatQueueItem } from './chat-response-command'
export type { ChatPermissionMode } from './chat-response-command'

export interface SendMessageOptions {
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto' | null | undefined
  permissionMode?: ChatPermissionMode
  continuationMode?: ChatContinuationMode
}

export interface ToolApprovalResponseInput {
  messageId: string
  approvalId: string
  approved: boolean
  reason?: string
}

export function projectMainMessagesFromSnapshotRows(rows: ChatSessionMessageRow[]): UIMessage[] {
  return rows.flatMap((row) => {
    if (row.parentToolCallId) {
      return []
    }
    return [row.message]
  })
}

function projectStreamingMainAssistantMessageIds(rows: ChatSessionMessageRow[]): string[] {
  return rows.flatMap((row) => {
    if (row.role !== 'assistant' || row.status !== 'streaming' || row.parentToolCallId) {
      return []
    }
    return [row.messageId]
  })
}

function derivePassiveStatus(rows: ChatSessionMessageRow[]): PublicStatus {
  if (rows.some(row => row.status === 'streaming')) {
    return 'streaming'
  }
  const latestAssistant = [...rows].reverse().find(row => row.role === 'assistant')
  if (latestAssistant?.status === 'failed') {
    return 'error'
  }
  return 'idle'
}

function readLatestFailedMainAssistantRow(rows: ChatSessionMessageRow[]): ChatSessionMessageRow | undefined {
  const latestAssistant = [...rows]
    .reverse()
    .find(row => row.role === 'assistant' && !row.parentToolCallId)
  return latestAssistant?.status === 'failed' ? latestAssistant : undefined
}

function isMatchingApprovalPart(part: UIMessage['parts'][number], approvalId: string): boolean {
  if (!(part.type === 'dynamic-tool' || part.type.startsWith('tool-'))) {
    return false
  }
  const approval = (part as { approval?: { id?: unknown } }).approval
  return typeof approval?.id === 'string' && approval.id === approvalId
}

// ── Hook ────────────────────────────────────────────────────

const SNAPSHOT_SYNC_DEBOUNCE_MS = 75
const QUEUE_DRAIN_SYNC_DELAY_MS = 150
const EMPTY_QUEUE_ITEMS: ChatQueueItem[] = []

function readCodexGoalCommandObjective(text: string): string | null {
  const normalized = text.trimStart()
  if (!normalized.startsWith('/goal')) {
    return null
  }
  const nextChar = normalized.charAt('/goal'.length)
  if (nextChar && nextChar !== ' ' && nextChar !== '\t') {
    return null
  }
  const objective = normalized.slice('/goal'.length).trim()
  return objective.length > 0 ? objective : null
}

function annotateCodexGoalMessage(message: UIMessage, objective: string): UIMessage {
  const metadata = message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
    ? message.metadata as Record<string, unknown>
    : {}
  const cradleMetadata = metadata.cradle && typeof metadata.cradle === 'object' && !Array.isArray(metadata.cradle)
    ? metadata.cradle as Record<string, unknown>
    : {}
  return {
    ...message,
    metadata: {
      ...metadata,
      cradle: {
        ...cradleMetadata,
        goal: { objective },
      },
    },
  } as UIMessage
}

export function useChatSession(chatSessionId: string | null) {
  const queryClient = useQueryClient()

  // Active handler ref (for the currently streaming response)
  const handlerRef = useRef<ChatStreamingHandler | null>(null)
  const passiveStreamRef = useRef<{
    sessionId: string
    messageId: string
    controller: AbortController
    handler: ChatStreamingHandler
  } | null>(null)
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Selectors (fine-grained subscriptions) ──

  const messageIds = useChatStore(
    useShallow(chatSelectors.messageIds(chatSessionId ?? '')),
  )
  const visibleStatus = useChatStore(
    chatSelectors.visibleStatus(chatSessionId ?? ''),
  )
  const isStreaming = useChatStore(
    chatSelectors.isSessionStreaming(chatSessionId ?? ''),
  )

  const latestError = useChatStore(
    chatSessionId ? chatSelectors.latestError(chatSessionId) : () => undefined,
  )

  // ── Hydration from server ──

  const snapshotRowsQueryKey = useMemo(
    () => chatSessionId
      ? getChatSessionsBySessionIdMessagesQueryKey({ path: { sessionId: chatSessionId } })
      : null,
    [chatSessionId],
  )
  const sessionBindingQueryKey = useMemo(
    () => chatSessionId
      ? getSessionsByIdQueryKey({ path: { id: chatSessionId } })
      : null,
    [chatSessionId],
  )

  const generatedSnapshotRowsOptions = useMemo(
    () => getChatSessionsBySessionIdMessagesOptions({ path: { sessionId: chatSessionId ?? '' } }),
    [chatSessionId],
  )
  const queueQueryKey = useMemo(
    () => ['chat', 'session-queue', chatSessionId ?? 'none'] as const,
    [chatSessionId],
  )

  const snapshotRowsQuery = useQuery<
    unknown,
    Error,
    ChatSessionMessageRow[],
    ReturnType<typeof getChatSessionsBySessionIdMessagesQueryKey>
  >({
    queryKey: generatedSnapshotRowsOptions.queryKey,
    queryFn: generatedSnapshotRowsOptions.queryFn,
    enabled: !!chatSessionId,
    select: data => data as ChatSessionMessageRow[],
  })

  const queueQuery = useQuery({
    queryKey: queueQueryKey,
    queryFn: () => listChatSessionQueue(chatSessionId!),
    enabled: !!chatSessionId,
    refetchInterval: query => visibleStatus === 'streaming'
      || query.state.data?.items.some(item => item.status === 'pending' || item.status === 'running')
      ? 1000
      : false,
  })

  const runtimeKind = useSessionLayoutStore(
    useShallow(state => chatSessionId ? state.sessions[chatSessionId]?.runtimeKind ?? null : null),
  )

  const scheduleSnapshotRefresh = useCallback((delay = SNAPSHOT_SYNC_DEBOUNCE_MS) => {
    if (!snapshotRowsQueryKey && !sessionBindingQueryKey) {
      return
    }
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current)
    }
    snapshotTimerRef.current = setTimeout(() => {
      snapshotTimerRef.current = null
      if (snapshotRowsQueryKey) {
        void queryClient.invalidateQueries({ queryKey: snapshotRowsQueryKey })
      }
      if (sessionBindingQueryKey) {
        void queryClient.invalidateQueries({ queryKey: sessionBindingQueryKey })
      }
    }, delay)
  }, [queryClient, sessionBindingQueryKey, snapshotRowsQueryKey])

  const refreshSessionLists = useCallback(() => {
    void queryClient.invalidateQueries({ predicate: query => isSessionsQueryKey(query.queryKey) })
  }, [queryClient])

  const refreshQueue = useCallback((delay = 0) => {
    if (delay <= 0) {
      void queryClient.invalidateQueries({ queryKey: queueQueryKey })
      void queryClient.refetchQueries({ queryKey: queueQueryKey, type: 'active' })
      return
    }

    window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: queueQueryKey })
      void queryClient.refetchQueries({ queryKey: queueQueryKey, type: 'active' })
    }, delay)
  }, [queryClient, queueQueryKey])

  // ── Initial load ──

  useLayoutEffect(() => {
    if (!chatSessionId || !snapshotRowsQuery.data) {
      return
    }
    const meta = useChatStore.getState().sessionMetaMap.get(chatSessionId)
    if (meta?.locallyDriving) {
      return
    }

    const projected = projectMainMessagesFromSnapshotRows(snapshotRowsQuery.data)
    const passiveStreamingMessageIds = projectStreamingMainAssistantMessageIds(snapshotRowsQuery.data)
    const passiveStatus = derivePassiveStatus(snapshotRowsQuery.data)
    useChatStore.getState().setMessages(chatSessionId, projected)
    useChatStore.getState().setPassiveStreamingMessageIds(chatSessionId, passiveStreamingMessageIds)
    useChatStore.getState().clearSessionErrors(chatSessionId)
    useChatStore.getState().setSessionMeta(chatSessionId, {
      cancelling: meta?.cancelling && passiveStatus === 'streaming',
      passiveStatus,
    })

    const failedRow = readLatestFailedMainAssistantRow(snapshotRowsQuery.data)
    if (failedRow?.errorText) {
      useChatStore.getState().failGeneration(failedRow.messageId, failedRow.errorText)
    }
  }, [chatSessionId, snapshotRowsQuery.data])

  useEffect(() => {
    return () => {
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current)
        snapshotTimerRef.current = null
      }
      if (passiveStreamRef.current) {
        passiveStreamRef.current.controller.abort()
        passiveStreamRef.current.handler.dispose()
        passiveStreamRef.current = null
      }
    }
  }, [chatSessionId])

  // ── Passive observer: join active run stream after snapshot hydration ──

  useEffect(() => {
    if (!chatSessionId || !snapshotRowsQuery.data) {
      return
    }

    const meta = useChatStore.getState().sessionMetaMap.get(chatSessionId)
    if (meta?.locallyDriving) {
      return
    }

    const streamingMessageId = projectStreamingMainAssistantMessageIds(snapshotRowsQuery.data)[0]
    if (!streamingMessageId) {
      if (passiveStreamRef.current?.sessionId === chatSessionId) {
        passiveStreamRef.current.controller.abort()
        passiveStreamRef.current.handler.dispose()
        passiveStreamRef.current = null
      }
      return
    }

    const current = passiveStreamRef.current
    if (current?.sessionId === chatSessionId && current.messageId === streamingMessageId) {
      return
    }
    if (current) {
      current.controller.abort()
      current.handler.dispose()
      passiveStreamRef.current = null
    }

    const controller = new AbortController()
    const handler = new ChatStreamingHandler(
      chatSessionId,
      streamingMessageId,
      performance.now(),
      { mode: 'passive', useStoredMessageSnapshot: false },
    )
    handler.start(controller)
    passiveStreamRef.current = {
      sessionId: chatSessionId,
      messageId: streamingMessageId,
      controller,
      handler,
    }

    void (async () => {
      try {
        const transport = await subscribeChatSessionStreamForSession({
          sessionId: chatSessionId,
          signal: controller.signal,
        })
        if (transport.runId) {
          useChatStore.getState().setRunDisplayId(streamingMessageId, transport.runId)
        }

        await handler.consume(transport.stream)
        handler.finish()
      }
      catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          handler.fail(err instanceof Error ? err.message : 'Stream failed')
        }
      }
      finally {
        handler.dispose()
        if (passiveStreamRef.current?.controller === controller) {
          passiveStreamRef.current = null
        }
        scheduleSnapshotRefresh(0)
        refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
      }
    })()

    return undefined
  }, [chatSessionId, refreshQueue, scheduleSnapshotRefresh, snapshotRowsQuery.data])

  // ── Send message ──

  const sendMessage = useCallback(async (
    text: string,
    opts?: SendMessageOptions,
    files: FileUIPart[] = [],
    contextParts: ChatContextPart[] = [],
  ) => {
    const trimmedText = text.trim()
    if (!chatSessionId || (!trimmedText && files.length === 0 && contextParts.length === 0)) {
      return
    }
    const goalObjective = runtimeKind === 'codex' ? readCodexGoalCommandObjective(trimmedText) : null
    const optimisticText = goalObjective ?? trimmedText

    const activeStatus = useChatStore.getState().sessionMetaMap.get(chatSessionId)?.passiveStatus ?? visibleStatus
    const isBusy = activeStatus === 'streaming' || visibleStatus === 'streaming'
    if (isBusy) {
      const continuationMode = opts?.continuationMode ?? 'queue'
      const queueItem = await enqueueChatSessionQueueItem({
        sessionId: chatSessionId,
        body: {
          mode: continuationMode,
          text: trimmedText,
          files,
          contextParts,
          providerTargetId: opts?.providerTargetId ?? undefined,
          modelId: opts?.modelId ?? undefined,
          thinkingEffort: opts?.thinkingEffort === 'auto' || opts?.thinkingEffort === null ? undefined : opts?.thinkingEffort,
          permissionMode: opts?.permissionMode,
        },
      })
      if (queueItem.mode === 'steer' && queueItem.status === 'completed') {
        useChatStore.getState().insertLiveSteerMessage(chatSessionId, createContinuationUserMessage({
          queueItem,
          fallbackText: trimmedText,
          fallbackContextParts: contextParts,
          fallbackFiles: files,
        }))
        scheduleSnapshotRefresh(0)
      }
      refreshQueue()
      return
    }

    // 1. Optimistic user message
    const userMessageId = `user-${Date.now()}`
    const userParts = toOrderedUserMessageParts(optimisticText, contextParts, text) as UIMessage['parts']
    userParts.push(...files)
    const userMessage: UIMessage = goalObjective ? annotateCodexGoalMessage({
      id: userMessageId,
      role: 'user',
      parts: userParts,
    }, goalObjective) : {
      id: userMessageId,
      role: 'user',
      parts: userParts,
    }
    useChatStore.getState().appendMessage(chatSessionId, userMessage)
    updateSessionInSessionLists(queryClient, { id: chatSessionId }, { promote: true })

    // 2. Create handler for assistant response
    const assistantMessageId = `assistant-${Date.now()}`
    const controller = new AbortController()
    const requestStartedAtMs = performance.now()
    const handler = new ChatStreamingHandler(chatSessionId, assistantMessageId, requestStartedAtMs)
    handler.start(controller)
    handlerRef.current = handler

    try {
      // 3. Initiate SSE stream
      const transport = await startChatResponseStream({
        sessionId: chatSessionId,
        body: {
          text: trimmedText,
          files,
          contextParts,
          providerTargetId: opts?.providerTargetId ?? undefined,
          modelId: opts?.modelId ?? undefined,
          thinkingEffort: opts?.thinkingEffort === 'auto' || opts?.thinkingEffort === null ? undefined : opts?.thinkingEffort,
          permissionMode: opts?.permissionMode,
        },
        signal: controller.signal,
      })

      if (transport.runId) {
        useChatStore.getState().setRunDisplayId(assistantMessageId, transport.runId)
      }

      if (sessionBindingQueryKey) {
        void queryClient.invalidateQueries({ queryKey: sessionBindingQueryKey })
      }
      refreshSessionLists()

      await handler.consume(transport.stream)

      handler.finish()
    }
    catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        handler.finish()
      }
      else {
        handler.fail(err instanceof Error ? err.message : 'Stream failed')
      }
    }
    finally {
      const wasLocallyAborted = controller.signal.aborted
      handlerRef.current = null
      const currentPassiveStatus = useChatStore.getState().sessionMetaMap.get(chatSessionId)?.passiveStatus
      useChatStore.getState().setSessionMeta(chatSessionId, {
        locallyDriving: false,
        localDriverMessageId: undefined,
        passiveStatus: currentPassiveStatus === 'streaming' ? 'streaming' : 'idle',
      })
      if (!wasLocallyAborted) {
        // Sync from server to get canonical message IDs
        scheduleSnapshotRefresh(0)
        void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(chatSessionId) })
        refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
      }
    }
  }, [chatSessionId, queryClient, refreshQueue, refreshSessionLists, runtimeKind, scheduleSnapshotRefresh, sessionBindingQueryKey, visibleStatus])

  const respondToToolApproval = useCallback(async (response: ToolApprovalResponseInput) => {
    if (!chatSessionId) {
      return
    }

    const store = useChatStore.getState()
    store.updateMessage(chatSessionId, response.messageId, message => ({
      ...message,
      parts: message.parts.map(part =>
        isMatchingApprovalPart(part, response.approvalId)
          ? {
              ...part,
              state: 'approval-responded',
              approval: {
                id: response.approvalId,
                approved: response.approved,
                ...(response.reason ? { reason: response.reason } : {}),
              },
            } as UIMessage['parts'][number]
          : part),
    }))

    const messagesForContinuation = useChatStore.getState().messagesMap.get(chatSessionId) ?? []
    if (!lastAssistantMessageIsCompleteWithApprovalResponses({ messages: messagesForContinuation })) {
      return
    }

    const controller = new AbortController()
    const requestStartedAtMs = performance.now()
    const handler = new ChatStreamingHandler(chatSessionId, response.messageId, requestStartedAtMs)
    handler.start(controller)
    handlerRef.current = handler

    try {
      const transport = await startChatResponseStream({
        sessionId: chatSessionId,
        body: {
          text: '',
          messages: messagesForContinuation,
        },
        signal: controller.signal,
      })

      if (transport.runId) {
        useChatStore.getState().setRunDisplayId(response.messageId, transport.runId)
      }

      if (sessionBindingQueryKey) {
        void queryClient.invalidateQueries({ queryKey: sessionBindingQueryKey })
      }
      refreshSessionLists()

      await handler.consume(transport.stream)
      handler.finish()
    }
    catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        handler.finish()
      }
      else {
        handler.fail(err instanceof Error ? err.message : 'Approval continuation failed')
      }
    }
    finally {
      handlerRef.current = null
      const currentPassiveStatus = useChatStore.getState().sessionMetaMap.get(chatSessionId)?.passiveStatus
      useChatStore.getState().setSessionMeta(chatSessionId, {
        locallyDriving: false,
        localDriverMessageId: undefined,
        passiveStatus: currentPassiveStatus === 'streaming' ? 'streaming' : 'idle',
      })
      if (!controller.signal.aborted) {
        scheduleSnapshotRefresh(0)
        void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(chatSessionId) })
        refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
      }
    }
  }, [chatSessionId, queryClient, refreshQueue, refreshSessionLists, scheduleSnapshotRefresh, sessionBindingQueryKey])

  const cancelQueueItem = useCallback(async (queueItemId: string) => {
    if (!chatSessionId) {
      return
    }
    await cancelChatSessionQueueItem({ sessionId: chatSessionId, queueItemId })
    refreshQueue()
  }, [chatSessionId, refreshQueue])

  const reorderQueueItems = useCallback(async (queueItemIds: string[]) => {
    if (!chatSessionId) {
      return
    }
    await reorderChatSessionQueue({ sessionId: chatSessionId, queueItemIds })
    refreshQueue()
  }, [chatSessionId, refreshQueue])

  const setPermissionMode = useCallback(async (mode: ChatPermissionMode) => {
    if (!chatSessionId) {
      return false
    }
    return await switchChatPermissionMode({ sessionId: chatSessionId, mode })
  }, [chatSessionId])

  // ── Stop ──

  const stop = useCallback(async () => {
    if (!chatSessionId) {
      return
    }
    const store = useChatStore.getState()
    const messages = store.messagesMap.get(chatSessionId) ?? []
    const activeAssistant = [...messages].reverse().find(m => m.role === 'assistant' && store.generatingMessageIds.has(m.id))
    const localDriverMessageId = store.sessionMetaMap.get(chatSessionId)?.localDriverMessageId
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    const messageId = activeAssistant?.id ?? localDriverMessageId ?? lastAssistant?.id
    if (messageId) {
      store.stopGeneration(messageId, chatSessionId)
    }
    store.setSessionMeta(chatSessionId, { cancelling: true, locallyDriving: false, localDriverMessageId: undefined, passiveStatus: 'idle' })

    try {
      await cancelChatResponse(chatSessionId)
      scheduleSnapshotRefresh(0)
      refreshQueue()
      refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
    }
    catch (error) {
      store.setSessionMeta(chatSessionId, { cancelling: false })
      console.warn('[useChatSession] failed to cancel server chat response', error)
    }
  }, [chatSessionId, refreshQueue, scheduleSnapshotRefresh])

  // ── isReady (always true once hydrated) ──

  const messageCount = messageIds.length
  const isReady = messageCount > 0 || snapshotRowsQuery.isFetched || chatSessionId === null

  useEffect(() => {
    if (latestError) {
      console.error(`[useChatSession] error for session ${chatSessionId}:`, latestError)
    }
  }, [chatSessionId, latestError])

  return {
    messageIds,
    messageCount,
    status: visibleStatus,
    isStreaming,
    isBusy: isStreaming,
    canStop: isStreaming,
    error: latestError?.message,
    sendMessage,
    respondToToolApproval,
    stop,
    isReady,
    queueItems: queueQuery.data?.items ?? EMPTY_QUEUE_ITEMS,
    cancelQueueItem,
    reorderQueueItems,
    setPermissionMode,
  }
}
