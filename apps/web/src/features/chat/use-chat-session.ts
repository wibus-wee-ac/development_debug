import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FileUIPart, UIMessage } from 'ai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { z } from 'zod'

import {
  getChatSessionsBySessionIdMessagesOptions,
  getChatSessionsBySessionIdMessagesQueryKey,
  getSessionsByIdQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import type { PublicStatus } from '~/store/chat'
import { chatSelectors, useChatStore } from '~/store/chat'

import type { ChatMessageSnapshotRow } from './chat-delta-events'
import type { ChatContinuationMode } from './chat-response-command'
import {
  cancelChatResponse,
  cancelChatSessionQueueItem,
  enqueueChatSessionQueueItem,
  listChatSessionQueue,
  reorderChatSessionQueue,
  startChatResponse,
} from './chat-response-command'
import { ChatStreamingHandler } from './chat-streaming-handler'
import { buildEventStreamFromResponse, onChatRunEvent } from './sse-chat-transport'

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

export type ChatSessionMessageRow = ChatMessageSnapshotRow
export type { ChatContinuationMode, ChatQueueItem } from './chat-response-command'

export interface SendMessageOptions {
  agentProfileId?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto' | null | undefined
  continuationMode?: ChatContinuationMode
}

/**
 * Extract subagent message snapshots, keyed by parent message and tool call.
 */
export function bucketSubagentMessagesByParentToolCall(
  rows: ChatSessionMessageRow[],
): Map<string, Map<string, UIMessage[]>> {
  const result = new Map<string, Map<string, UIMessage[]>>()
  for (const row of rows) {
    if (!row.parentMessageId || !row.parentToolCallId) {
      continue
    }
    let messageMap = result.get(row.parentMessageId)
    if (!messageMap) {
      messageMap = new Map()
      result.set(row.parentMessageId, messageMap)
    }
    const messages = messageMap.get(row.parentToolCallId) ?? []
    messages.push(row.message)
    messageMap.set(row.parentToolCallId, messages)
  }
  return result
}

export function projectMainMessagesFromSnapshotRows(rows: ChatSessionMessageRow[]): UIMessage[] {
  return rows.flatMap((row) => {
    if (row.parentToolCallId) {
      return []
    }
    return [row.message]
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

// ── Hook ────────────────────────────────────────────────────

const SNAPSHOT_SYNC_DEBOUNCE_MS = 75
const PASSIVE_STREAM_REFETCH_MS = 500
const UIMessageSchema: z.ZodType<UIMessage> = z.object({
  id: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  parts: z.array(z.unknown()),
}).passthrough() as z.ZodType<UIMessage>
const ChatMessageSnapshotRowSchema = z.object({
  messageId: z.string(),
  role: z.enum(['user', 'assistant']),
  status: z.string(),
  errorText: z.string().nullable().optional(),
  content: z.string(),
  message: UIMessageSchema,
  parentMessageId: z.string().nullable(),
  parentToolCallId: z.string().nullable(),
  taskId: z.string().nullable(),
  depth: z.number().finite(),
})
const ChatMessageSnapshotRowsSchema = z.array(ChatMessageSnapshotRowSchema)

export function useChatSession(chatSessionId: string | null) {
  const queryClient = useQueryClient()

  // Active handler ref (for the currently streaming response)
  const handlerRef = useRef<ChatStreamingHandler | null>(null)
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Selectors (fine-grained subscriptions) ──

  const messages = useChatStore(
    chatSelectors.messages(chatSessionId ?? ''),
  )
  const visibleStatus = useChatStore(
    chatSelectors.visibleStatus(chatSessionId ?? ''),
  )

  // Derive error from the last assistant message
  const lastAssistantId = useMemo(() => {
    const last = [...messages].reverse().find(m => m.role === 'assistant')
    return last?.id
  }, [messages])

  const lastError = useChatStore(
    lastAssistantId ? chatSelectors.error(lastAssistantId) : () => undefined,
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
    refetchInterval: () => {
      if (!chatSessionId) {
        return false
      }
      const meta = useChatStore.getState().sessionMetaMap.get(chatSessionId)
      return meta?.passiveStatus === 'streaming' && !meta.locallyDriving
        ? PASSIVE_STREAM_REFETCH_MS
        : false
    },
    select: data => ChatMessageSnapshotRowsSchema.parse(data),
  })

  const queueQuery = useQuery({
    queryKey: queueQueryKey,
    queryFn: () => listChatSessionQueue(chatSessionId!),
    enabled: !!chatSessionId,
    refetchInterval: () => visibleStatus === 'streaming' ? 1000 : false,
  })

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

  // ── Initial load ──

  useEffect(() => {
    if (!chatSessionId || !snapshotRowsQuery.data) {
      return
    }
    const meta = useChatStore.getState().sessionMetaMap.get(chatSessionId)
    if (meta?.locallyDriving) {
      return
    }

    const projected = projectMainMessagesFromSnapshotRows(snapshotRowsQuery.data)
    const passiveStatus = derivePassiveStatus(snapshotRowsQuery.data)
    useChatStore.getState().setMessages(chatSessionId, projected)
    useChatStore.getState().setSessionMeta(chatSessionId, {
      cancelling: meta?.cancelling && passiveStatus === 'streaming',
      passiveStatus,
    })

    // Hydrate errorMap from server-side failed messages
    for (const row of snapshotRowsQuery.data) {
      if (row.role === 'assistant' && row.status === 'failed' && row.errorText) {
        useChatStore.getState().failGeneration(row.messageId, row.errorText)
      }
    }

    // Hydrate subagent messages
    const subagentMap = bucketSubagentMessagesByParentToolCall(snapshotRowsQuery.data)
    for (const [messageId, parentMap] of subagentMap) {
      useChatStore.getState().setSubagentMessages(messageId, parentMap)
    }
  }, [chatSessionId, snapshotRowsQuery.data])

  useEffect(() => {
    return () => {
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current)
        snapshotTimerRef.current = null
      }
    }
  }, [chatSessionId])

  // ── Passive observer: SSE run events ──

  useEffect(() => {
    if (!chatSessionId) {
      return
    }

    return onChatRunEvent(chatSessionId, (data) => {
      const meta = useChatStore.getState().sessionMetaMap.get(chatSessionId)
      const isLocallyDriving = meta?.locallyDriving ?? false
      const isCancelling = meta?.cancelling ?? false

      if (data.event.type === 'run.failed') {
        if (isLocallyDriving) {
          // Let the in-band stream handler capture the error with its message
          return
        }
        useChatStore.getState().setSessionMeta(chatSessionId, { cancelling: false, locallyDriving: false, localDriverMessageId: undefined })
        useChatStore.getState().setPassiveStatus(chatSessionId, 'error')
        scheduleSnapshotRefresh(0)
        void queryClient.invalidateQueries({ queryKey: queueQueryKey })
        return
      }

      if (isCancelling && data.event.type === 'run.streaming') {
        return
      }

      if (isLocallyDriving) {
        // We're driving this stream locally — useChat handler manages state
        return
      }

      switch (data.event.type) {
        case 'run.completed':
        case 'run.aborted':
          useChatStore.getState().setSessionMeta(chatSessionId, { cancelling: false, locallyDriving: false, localDriverMessageId: undefined })
          useChatStore.getState().setPassiveStatus(chatSessionId, 'idle')
          scheduleSnapshotRefresh(0)
          void queryClient.invalidateQueries({ queryKey: queueQueryKey })
          break
        default:
          useChatStore.getState().setPassiveStatus(chatSessionId, 'streaming')
          scheduleSnapshotRefresh()
          void queryClient.invalidateQueries({ queryKey: queueQueryKey })
          break
      }
    })
  }, [chatSessionId, queryClient, queueQueryKey, scheduleSnapshotRefresh])

  // ── Send message ──

  const sendMessage = useCallback(async (
    text: string,
    opts?: SendMessageOptions,
    files: FileUIPart[] = [],
  ) => {
    const trimmedText = text.trim()
    if (!chatSessionId || (!trimmedText && files.length === 0)) {
      return
    }

    const activeStatus = useChatStore.getState().sessionMetaMap.get(chatSessionId)?.passiveStatus ?? visibleStatus
    const isBusy = activeStatus === 'streaming' || visibleStatus === 'streaming'
    if (isBusy) {
      await enqueueChatSessionQueueItem({
        sessionId: chatSessionId,
        body: {
          mode: opts?.continuationMode ?? 'queue',
          text: trimmedText,
          files,
          agentProfileId: opts?.agentProfileId ?? undefined,
          modelId: opts?.modelId ?? undefined,
          thinkingEffort: opts?.thinkingEffort === 'auto' || opts?.thinkingEffort === null ? undefined : opts?.thinkingEffort,
        },
      })
      void queryClient.invalidateQueries({ queryKey: queueQueryKey })
      return
    }

    // 1. Optimistic user message
    const userMessageId = `user-${Date.now()}`
    const userParts: UIMessage['parts'] = trimmedText ? [{ type: 'text', text: trimmedText }] : []
    userParts.push(...files)
    const userMessage: UIMessage = {
      id: userMessageId,
      role: 'user',
      parts: userParts,
    }
    useChatStore.getState().appendMessage(chatSessionId, userMessage)

    // 2. Create handler for assistant response
    const assistantMessageId = `assistant-${Date.now()}`
    const controller = new AbortController()
    const requestStartedAtMs = performance.now()
    const handler = new ChatStreamingHandler(chatSessionId, assistantMessageId, requestStartedAtMs)
    handler.start(controller)
    handlerRef.current = handler

    try {
      // 3. Initiate SSE stream
      const res = await startChatResponse({
        sessionId: chatSessionId,
        body: {
          text: trimmedText,
          files,
          agentProfileId: opts?.agentProfileId ?? undefined,
          modelId: opts?.modelId ?? undefined,
          thinkingEffort: opts?.thinkingEffort === 'auto' || opts?.thinkingEffort === null ? undefined : opts?.thinkingEffort,
        },
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Failed to start chat response: ${res.status} ${body}`)
      }

      const runId = res.headers.get('x-cradle-run-id')
      if (runId) {
        useChatStore.getState().setRunDisplayId(assistantMessageId, runId)
      }

      if (sessionBindingQueryKey) {
        void queryClient.invalidateQueries({ queryKey: sessionBindingQueryKey })
      }

      // 4. Pipe delta events to handler
      const stream = buildEventStreamFromResponse(res, chatSessionId)
      const reader = stream.getReader()

      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read()
        if (done) {
          return
        }
        handler.handleEvent(value)
        await pump()
      }

      await pump()

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
      }
    }
  }, [chatSessionId, queryClient, queueQueryKey, scheduleSnapshotRefresh, sessionBindingQueryKey, visibleStatus])

  const cancelQueueItem = useCallback(async (queueItemId: string) => {
    if (!chatSessionId) {
      return
    }
    await cancelChatSessionQueueItem({ sessionId: chatSessionId, queueItemId })
    void queryClient.invalidateQueries({ queryKey: queueQueryKey })
  }, [chatSessionId, queryClient, queueQueryKey])

  const reorderQueueItems = useCallback(async (queueItemIds: string[]) => {
    if (!chatSessionId) {
      return
    }
    await reorderChatSessionQueue({ sessionId: chatSessionId, queueItemIds })
    void queryClient.invalidateQueries({ queryKey: queueQueryKey })
  }, [chatSessionId, queryClient, queueQueryKey])

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
    }
    catch (error) {
      store.setSessionMeta(chatSessionId, { cancelling: false })
      console.warn('[useChatSession] failed to cancel server chat response', error)
    }
  }, [chatSessionId, scheduleSnapshotRefresh])

  // ── isReady (always true once hydrated) ──

  const isReady = messages.length > 0 || snapshotRowsQuery.isFetched || chatSessionId === null

  return {
    messages,
    status: visibleStatus,
    error: lastError?.message,
    sendMessage,
    stop,
    isReady,
    queueItems: queueQuery.data?.items ?? [],
    cancelQueueItem,
    reorderQueueItems,
  }
}
