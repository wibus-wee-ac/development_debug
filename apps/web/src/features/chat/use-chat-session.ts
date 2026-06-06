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
import { submitSideConversationMessage } from '~/features/browser/side-conversation-panel'
import { isSessionsQueryKey, updateSessionInSessionLists } from '~/features/workspace/use-session'
import { useBrowserPanelStore } from '~/store/browser-panel'
import type { PublicStatus } from '~/store/chat'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useLayoutStore } from '~/store/layout'
import { useSessionLayoutStore } from '~/store/session-layout'

import { readBangCommand } from './bang-command'
import { annotateBangCommandMessage, annotateBangResultMessage } from './bang-command-metadata'
import { runtimeUiSlotStatesQueryKey } from './chat-capabilities'
import type { ChatContextPart } from './chat-context-parts'
import type { ChatContinuationMode, ChatQueueItem, ChatRuntimeSettingsPatch, ChatThinkingEffort } from './chat-response-command'
import {
  cancelChatResponse,
  cancelChatSessionQueueItem,
  createSideChat,
  enqueueChatSessionQueueItem,
  executeBangCommand,
  listChatSessionQueue,
  reorderChatSessionQueue,
  steerChatSessionTurn,
  submitRuntimeUserInput,
} from './chat-response-command'
import { startChatResponseStream, subscribeChatSessionStreamForSession } from './chat-stream-transport'
import { ChatStreamingHandler } from './chat-streaming-handler'
import { buildOptimisticUserMessage } from './optimistic-chat-turn'
import { runtimeSettingsQueryKey } from './runtime-settings-command'
import { useRuntimeSessionStatus } from './use-runtime-session-status'

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

export interface SendMessageOptions {
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: ChatThinkingEffort | null | undefined
  runtimeSettings?: ChatRuntimeSettingsPatch
  continuationMode?: ChatContinuationMode
}

export type SendMessageResult = void | {
  kind: 'side-conversation'
  sideConversationId: string
  parentSessionId: string
}

export interface ToolApprovalResponseInput {
  messageId: string
  approvalId: string
  approved: boolean
  reason?: string
}

export interface RuntimeUserInputSubmitInput {
  messageId: string
  toolCallId: string
  answers: Record<string, string[]>
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

function isMatchingToolPart(part: UIMessage['parts'][number], toolCallId: string): boolean {
  return (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
    && (part as { toolCallId?: unknown }).toolCallId === toolCallId
}

function readRuntimeUserInputRequestId(toolCallId: string): string {
  return toolCallId.startsWith('server-request-')
    ? toolCallId.slice('server-request-'.length)
    : toolCallId
}

// ── Hook ────────────────────────────────────────────────────

const SNAPSHOT_SYNC_DEBOUNCE_MS = 75
const QUEUE_DRAIN_SYNC_DELAY_MS = 150
const EMPTY_QUEUE_ITEMS: ChatQueueItem[] = []
const BANG_COMMAND_DRIVER_PREFIX = 'bang-command'

function readSideChatCommand(text: string): string | null {
  const normalized = text.trimStart()
  if (!normalized.startsWith('/side')) {
    return null
  }
  const nextChar = normalized.charAt('/side'.length)
  if (nextChar && nextChar !== ' ' && nextChar !== '\t') {
    return null
  }
  return normalized.slice('/side'.length).trim()
}

interface ChatSessionRuntimeControls {
  queryClient: ReturnType<typeof useQueryClient>
  snapshotRowsQueryKey: ReturnType<typeof getChatSessionsBySessionIdMessagesQueryKey> | null
  sessionBindingQueryKey: ReturnType<typeof getSessionsByIdQueryKey> | null
  queueQueryKey: readonly ['chat', 'session-queue', string]
  scheduleSnapshotRefresh: (delay?: number) => void
  refreshSessionLists: () => void
  refreshQueue: (delay?: number) => void
}

function useChatSessionRuntimeControls(chatSessionId: string | null): ChatSessionRuntimeControls {
  const queryClient = useQueryClient()
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const queueQueryKey = useMemo(
    () => ['chat', 'session-queue', chatSessionId ?? 'none'] as const,
    [chatSessionId],
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

  useEffect(() => {
    return () => {
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current)
        snapshotTimerRef.current = null
      }
    }
  }, [chatSessionId])

  return {
    queryClient,
    snapshotRowsQueryKey,
    sessionBindingQueryKey,
    queueQueryKey,
    scheduleSnapshotRefresh,
    refreshSessionLists,
    refreshQueue,
  }
}

export function useChatSessionDriver(chatSessionId: string | null): void {
  const {
    scheduleSnapshotRefresh,
    refreshQueue,
  } = useChatSessionRuntimeControls(chatSessionId)
  const generatedSnapshotRowsOptions = useMemo(
    () => getChatSessionsBySessionIdMessagesOptions({ path: { sessionId: chatSessionId ?? '' } }),
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
  const runtimeStatusQuery = useRuntimeSessionStatus(chatSessionId)
  const snapshotRows = snapshotRowsQuery.data
  const runtimeStatus = runtimeStatusQuery.data
  const passiveStreamRef = useRef<{
    sessionId: string
    messageId: string
    controller: AbortController
    handler: ChatStreamingHandler
  } | null>(null)
  const requestedRuntimeActiveRunMessageRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!chatSessionId || !snapshotRows) {
      return
    }
    const meta = useChatStore.getState().sessionMetaMap.get(chatSessionId)
    if (meta?.locallyDriving) {
      return
    }
    if (passiveStreamRef.current?.sessionId === chatSessionId) {
      return
    }

    const projected = projectMainMessagesFromSnapshotRows(snapshotRows)
    const passiveStreamingMessageIds = projectStreamingMainAssistantMessageIds(snapshotRows)
    const passiveStatus = derivePassiveStatus(snapshotRows)
    useChatStore.getState().setMessages(chatSessionId, projected)
    useChatStore.getState().setSessionHydrated(chatSessionId, true)
    useChatStore.getState().setPassiveStreamingMessageIds(chatSessionId, passiveStreamingMessageIds)
    useChatStore.getState().clearSessionErrors(chatSessionId)
    useChatStore.getState().setSessionMeta(chatSessionId, {
      cancelling: meta?.cancelling && passiveStatus === 'streaming',
      passiveStatus,
    })

    const failedRow = readLatestFailedMainAssistantRow(snapshotRows)
    if (failedRow?.errorText) {
      useChatStore.getState().failGeneration(failedRow.messageId, failedRow.errorText)
    }
  }, [chatSessionId, snapshotRows])

  useEffect(() => {
    if (!chatSessionId || !snapshotRowsQuery.isError) {
      return
    }
    useChatStore.getState().setSessionHydrated(chatSessionId, true)
    useChatStore.getState().setPassiveStatus(chatSessionId, 'error')
  }, [chatSessionId, snapshotRowsQuery.isError])

  useEffect(() => {
    return () => {
      if (passiveStreamRef.current) {
        passiveStreamRef.current.controller.abort()
        passiveStreamRef.current.handler.dispose()
        passiveStreamRef.current = null
      }
      requestedRuntimeActiveRunMessageRef.current = null
    }
  }, [chatSessionId])

  useEffect(() => {
    if (!chatSessionId) {
      return
    }

    const activeRunMessageId = runtimeStatus?.activeRun?.messageId
    if (!activeRunMessageId) {
      requestedRuntimeActiveRunMessageRef.current = null
      return
    }
    const snapshotHasMessage = (snapshotRows ?? []).some(row => row.messageId === activeRunMessageId)
    const storeHasMessage = (useChatStore.getState().messagesMap.get(chatSessionId) ?? []).some(message => message.id === activeRunMessageId)
    if (snapshotHasMessage || storeHasMessage) {
      requestedRuntimeActiveRunMessageRef.current = null
      return
    }
    if (requestedRuntimeActiveRunMessageRef.current === activeRunMessageId) {
      return
    }

    requestedRuntimeActiveRunMessageRef.current = activeRunMessageId
    scheduleSnapshotRefresh(0)
  }, [chatSessionId, runtimeStatus?.activeRun?.messageId, scheduleSnapshotRefresh, snapshotRows])

  useEffect(() => {
    if (!chatSessionId || !snapshotRows) {
      return
    }

    const meta = useChatStore.getState().sessionMetaMap.get(chatSessionId)
    if (meta?.locallyDriving) {
      return
    }

    const streamingMessageId = projectStreamingMainAssistantMessageIds(snapshotRows)[0]
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
  }, [chatSessionId, refreshQueue, scheduleSnapshotRefresh, snapshotRows])
}

export function useChatSession(chatSessionId: string | null) {
  const {
    queryClient,
    sessionBindingQueryKey,
    queueQueryKey,
    scheduleSnapshotRefresh,
    refreshSessionLists,
    refreshQueue,
  } = useChatSessionRuntimeControls(chatSessionId)

  const handlerRef = useRef<ChatStreamingHandler | null>(null)

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
    enabled: !!chatSessionId,
    refetchInterval: query => visibleStatus === 'streaming'
      || query.state.data?.items.some(item => item.status === 'pending' || item.status === 'running')
      ? 1000
      : false,
  })
  const runtimeKind = useSessionLayoutStore(
    useShallow(state => chatSessionId ? state.sessions[chatSessionId]?.runtimeKind ?? null : null),
  )

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
    const bangCommand = files.length === 0 && contextParts.length === 0 ? readBangCommand(text) : null
    const sideChatMessage = readSideChatCommand(trimmedText)
    const activeStatus = useChatStore.getState().sessionMetaMap.get(chatSessionId)?.passiveStatus ?? visibleStatus
    const isBusy = activeStatus === 'streaming' || visibleStatus === 'streaming'

    if (sideChatMessage !== null) {
      const controller = new AbortController()
      const driverMessageId = `side-chat-${Date.now()}`
      const store = useChatStore.getState()
      store.appendMessage(chatSessionId, {
        id: driverMessageId,
        role: 'user',
        parts: [{ type: 'text', text: trimmedText }],
      })
      if (!isBusy) {
        store.startGeneration(chatSessionId, driverMessageId, controller)
      }

      try {
        const result = await createSideChat({
          sessionId: chatSessionId,
          providerTargetId: opts?.providerTargetId ?? undefined,
          modelId: opts?.modelId ?? undefined,
          signal: controller.signal,
        })
        useChatStore.getState().removeMessage(chatSessionId, driverMessageId)

        const ownerId = `chat:${chatSessionId}`
        useBrowserPanelStore.getState().openSideConversationTab({
          parentSessionId: chatSessionId,
          sideConversationId: result.sideConversationId,
          providerSessionId: result.providerSessionId,
          title: result.title,
          ownerId,
        })
        useLayoutStore.getState().setBrowserPanelOpen(true, ownerId)

        if (sideChatMessage || files.length > 0 || contextParts.length > 0) {
          await submitSideConversationMessage({
            sideConversationId: result.sideConversationId,
            text: sideChatMessage,
            files,
            contextParts,
            modelId: opts?.modelId ?? undefined,
            thinkingEffort: opts?.thinkingEffort,
            runtimeSettings: opts?.runtimeSettings,
          })
        }

        return {
          kind: 'side-conversation' as const,
          sideConversationId: result.sideConversationId,
          parentSessionId: chatSessionId,
        }
      }
      catch (error) {
        useChatStore.getState().failGeneration(driverMessageId, error instanceof Error ? error.message : 'Failed to create side chat')
        throw error
      }
    }

    if (bangCommand) {
      const controller = new AbortController()
      const driverMessageId = `${BANG_COMMAND_DRIVER_PREFIX}-${Date.now()}`
      const store = useChatStore.getState()
      store.appendMessage(chatSessionId, annotateBangCommandMessage(
        {
          id: driverMessageId,
          role: 'user',
          parts: [{ type: 'text', text: `!${bangCommand}` }],
        },
        bangCommand,
      ))
      if (!isBusy) {
        store.startGeneration(chatSessionId, driverMessageId, controller)
      }
      updateSessionInSessionLists(queryClient, { id: chatSessionId }, { promote: true })

      try {
        const result = await executeBangCommand({
          sessionId: chatSessionId,
          command: bangCommand,
          signal: controller.signal,
        })
        useChatStore.getState().removeMessage(chatSessionId, driverMessageId)
        const latestMessages = useChatStore.getState().messagesMap.get(chatSessionId) ?? []
        const userMessage = annotateBangCommandMessage(result.userMessage, result.command)
        const resultMessage = annotateBangResultMessage(result.resultMessage, {
          command: result.command,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          truncated: result.truncated,
        })
        if (latestMessages.some(message => message.id === userMessage.id)) {
          useChatStore.getState().updateMessage(chatSessionId, userMessage.id, current => annotateBangCommandMessage(current, result.command))
        }
        else {
          useChatStore.getState().appendMessage(chatSessionId, userMessage)
        }
        if (latestMessages.some(message => message.id === resultMessage.id)) {
          useChatStore.getState().updateMessage(chatSessionId, resultMessage.id, current => annotateBangResultMessage(current, {
            command: result.command,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            timedOut: result.timedOut,
            truncated: result.truncated,
          }))
        }
        else {
          useChatStore.getState().appendMessage(chatSessionId, resultMessage)
        }
        useChatStore.getState().finishGeneration(driverMessageId)
        scheduleSnapshotRefresh(0)
        refreshSessionLists()
      }
      catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (!isBusy) {
            useChatStore.getState().finishGeneration(driverMessageId)
          }
        }
        else {
          const errorMessage = err instanceof Error ? err.message : 'Bang command failed'
          if (isBusy) {
            useChatStore.getState().updateMessage(chatSessionId, driverMessageId, message => ({
              ...message,
              parts: [{ type: 'text', text: `!${bangCommand}\n\n${errorMessage}` }],
            }))
          }
          else {
            useChatStore.getState().failGeneration(driverMessageId, errorMessage)
          }
        }
      }
      finally {
        if (!isBusy) {
          const currentPassiveStatus = useChatStore.getState().sessionMetaMap.get(chatSessionId)?.passiveStatus
          useChatStore.getState().setSessionMeta(chatSessionId, {
            cancelling: false,
            locallyDriving: false,
            localDriverMessageId: undefined,
            passiveStatus: currentPassiveStatus === 'streaming' ? 'streaming' : 'idle',
          })
        }
      }
      return
    }

    if (isBusy) {
      const continuationMode = opts?.continuationMode ?? 'queue'
      const body = {
        text: trimmedText,
        files,
        contextParts,
        providerTargetId: opts?.providerTargetId ?? undefined,
        modelId: opts?.modelId ?? undefined,
        thinkingEffort: opts?.thinkingEffort === null ? undefined : opts?.thinkingEffort,
        runtimeSettings: opts?.runtimeSettings,
      }
      if (continuationMode === 'steer') {
        const steer = await steerChatSessionTurn({
          sessionId: chatSessionId,
          body,
        })
        useChatStore.getState().insertLiveSteerMessage(chatSessionId, steer.message)
        scheduleSnapshotRefresh(0)
        return
      }

      await enqueueChatSessionQueueItem({
        sessionId: chatSessionId,
        body,
      })
      refreshQueue()
      return
    }

    // 1. Optimistic user message
    const userMessageId = `user-${Date.now()}`
    useChatStore.getState().appendMessage(chatSessionId, buildOptimisticUserMessage({
      messageId: userMessageId,
      text: trimmedText,
      sourceText: text,
      files,
      contextParts,
      runtimeKind,
    }))
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
          thinkingEffort: opts?.thinkingEffort === null ? undefined : opts?.thinkingEffort,
          runtimeSettings: opts?.runtimeSettings,
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
        void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey(chatSessionId) })
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
        void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey(chatSessionId) })
        refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
      }
    }
  }, [chatSessionId, queryClient, refreshQueue, refreshSessionLists, scheduleSnapshotRefresh, sessionBindingQueryKey])

  const submitPendingUserInput = useCallback(async (response: RuntimeUserInputSubmitInput) => {
    if (!chatSessionId) {
      return
    }

    const requestId = readRuntimeUserInputRequestId(response.toolCallId)
    const result = await submitRuntimeUserInput({
      sessionId: chatSessionId,
      requestId,
      answers: response.answers,
    })

    useChatStore.getState().updateMessage(chatSessionId, response.messageId, message => ({
      ...message,
      parts: message.parts.map(part =>
        isMatchingToolPart(part, response.toolCallId)
          ? {
              ...part,
              state: 'output-available',
              output: {
                type: 'cradle.runtime-user-input.resolved.v1',
                requestId: result.requestId,
                answers: result.answers,
                acceptedAt: Math.floor(Date.now() / 1000),
              },
            } as UIMessage['parts'][number]
          : part),
    }), { dirtyToolCallIds: new Set([response.toolCallId]) })

    scheduleSnapshotRefresh(0)
  }, [chatSessionId, scheduleSnapshotRefresh])

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
  const isReady = messageCount > 0 || isHydrated || chatSessionId === null

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
    submitPendingUserInput,
    stop,
    isReady,
    queueItems: queueQuery.data?.items ?? EMPTY_QUEUE_ITEMS,
    cancelQueueItem,
    reorderQueueItems,
  }
}
