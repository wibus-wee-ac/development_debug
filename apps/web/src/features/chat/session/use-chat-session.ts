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
import { postChatSessionsBySessionIdCodexAppServerInvoke } from '~/api-gen/sdk.gen'
import { toastManager } from '~/components/ui/toast'
import { submitSideConversationMessage } from '~/features/browser/side-conversation-panel'
import { isSessionsQueryKey, updateSessionInSessionLists } from '~/features/workspace/use-session'
import { useBrowserPanelStore } from '~/store/browser-panel'
import type { PublicStatus } from '~/store/chat'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useLayoutStore } from '~/store/layout'
import { useSessionLayoutStore } from '~/store/session-layout'

import { runtimeUiSlotStatesQueryKey } from '../capabilities/chat-capabilities'
import { readBangCommand } from '../commands/bang-command'
import { annotateBangCommandMessage, annotateBangResultMessage } from '../commands/bang-command-metadata'
import type { ChatContinuationMode, ChatQueueItem, ChatRuntimeSettingsPatch, ChatThinkingEffort } from '../commands/chat-response-command'
import { cancelChatResponse, cancelChatSessionQueueItem, createSideChat, enqueueChatSessionQueueItem, executeBangCommand, listChatSessionQueue, readChatCommandErrorCode, reorderChatSessionQueue, resolvePlanImplementationApproval, steerChatSessionTurn, submitRuntimeUserInput } from '../commands/chat-response-command'
import { getRuntimeSessionStatus } from '../commands/runtime-session-status-command'
import { runtimeSettingsQueryKey, updateSessionRuntimeSettings } from '../commands/runtime-settings-command'
import type { ChatContextPart } from '../context/chat-context-parts'
import { runtimeSessionStatusQueryKey, useRuntimeSessionStatus } from '../runtime/use-runtime-session-status'
import { startChatResponseStream, subscribeChatSessionStreamForSession } from '../transport/chat-stream-transport'
import { ChatStreamingHandler } from '../transport/chat-streaming-handler'
import { buildOptimisticUserMessage, readCodexGoalCommandObjective } from './optimistic-chat-turn'

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
export type { ChatContinuationMode, ChatQueueItem }

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
const STEER_FALLBACK_ERROR_CODES = new Set(['chat_steer_context_mismatch', 'chat_steer_no_active_run'])
const CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX = 'PLEASE IMPLEMENT THIS PLAN:'
const CODEX_PLAN_IMPLEMENTATION_APPROVAL_PREFIX = 'implement-plan:'

interface PlanImplementationApprovalRequest {
  toolCallId: string
  planContent: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBuiltinToolCallInputPayload(value: unknown): { apiName: string, args: unknown } | null {
  if (!isRecord(value) || value.type !== 'cradle.builtin-tool-call.input.v1' || typeof value.apiName !== 'string') {
    return null
  }
  return {
    apiName: value.apiName,
    args: value.args,
  }
}

function readToolApiName(part: UIMessage['parts'][number]): string | null {
  const inputPayload = readBuiltinToolCallInputPayload((part as { input?: unknown }).input)
  if (inputPayload) {
    return inputPayload.apiName
  }
  const toolName = (part as { toolName?: unknown }).toolName
  if (typeof toolName === 'string') {
    return toolName
  }
  return part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : null
}

function readPlanContentFromInput(input: unknown): string | null {
  const inputPayload = readBuiltinToolCallInputPayload(input)
  const args = inputPayload ? inputPayload.args : input
  if (!isRecord(args) || typeof args.planContent !== 'string') {
    return null
  }
  const planContent = args.planContent.trim()
  return planContent.length > 0 ? planContent : null
}

function readPlanImplementationApprovalRequest(
  messages: UIMessage[],
  response: ToolApprovalResponseInput,
): PlanImplementationApprovalRequest | null {
  if (!response.approvalId.startsWith(CODEX_PLAN_IMPLEMENTATION_APPROVAL_PREFIX)) {
    return null
  }
  const message = messages.find(item => item.id === response.messageId)
  const part = message?.parts.find(item => isMatchingApprovalPart(item, response.approvalId))
  if (!part || !('toolCallId' in part) || typeof part.toolCallId !== 'string') {
    return null
  }
  if (part.toolCallId !== response.approvalId || readToolApiName(part) !== 'plan_implementation') {
    return null
  }
  const planContent = readPlanContentFromInput((part as { input?: unknown }).input)
  return planContent ? { toolCallId: part.toolCallId, planContent } : null
}

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

function releaseStaleSessionStreamingState(sessionId: string): void {
  const state = useChatStore.getState()
  const meta = state.sessionMetaMap.get(sessionId)
  const messageIds = new Set((state.messagesMap.get(sessionId) ?? []).map(message => message.id))
  if (meta?.localDriverMessageId) {
    messageIds.add(meta.localDriverMessageId)
  }

  for (const messageId of messageIds) {
    if (
      state.generatingMessageIds.has(messageId)
      || state.passiveStreamingMessageIds.has(messageId)
      || meta?.localDriverMessageId === messageId
    ) {
      state.finishGeneration(messageId)
    }
  }
  state.setPassiveStreamingMessageIds(sessionId, [])
  state.setSessionMeta(sessionId, {
    cancelling: false,
    locallyDriving: false,
    localDriverMessageId: undefined,
    passiveStatus: 'idle',
  })
}

function releasePassiveSessionStreamingState(sessionId: string): void {
  const state = useChatStore.getState()
  const meta = state.sessionMetaMap.get(sessionId)
  const messageIds = new Set((state.messagesMap.get(sessionId) ?? []).map(message => message.id))

  for (const messageId of messageIds) {
    if (state.passiveStreamingMessageIds.has(messageId)) {
      state.finishGeneration(messageId)
    }
  }
  state.setPassiveStreamingMessageIds(sessionId, [])
  state.setSessionMeta(sessionId, {
    cancelling: meta?.cancelling && meta.locallyDriving,
    passiveStatus: 'idle',
  })
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
  }, [chatSessionId, queryClient, sessionBindingQueryKey, snapshotRowsQueryKey])

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
  }, [chatSessionId, queryClient, queueQueryKey])

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

export function useChatSessionDriver(chatSessionId: string | null, active = true): void {
  const {
    scheduleSnapshotRefresh,
    refreshQueue,
  } = useChatSessionRuntimeControls(chatSessionId)
  const driverEnabled = active && !!chatSessionId
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
    enabled: driverEnabled,
    select: data => data as ChatSessionMessageRow[],
  })
  const runtimeStatusQuery = useRuntimeSessionStatus(driverEnabled ? chatSessionId : null)
  const snapshotRows = snapshotRowsQuery.data
  const runtimeStatus = runtimeStatusQuery.data
  const passiveStreamRef = useRef<{
    sessionId: string
    messageId: string
    controller: AbortController
    handler: ChatStreamingHandler
  } | null>(null)
  const requestedRuntimeActiveRunMessageRef = useRef<string | null>(null)
  const runtimeQueueSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    if (driverEnabled) {
      return
    }
    if (passiveStreamRef.current) {
      passiveStreamRef.current.controller.abort()
      passiveStreamRef.current.handler.dispose()
      passiveStreamRef.current = null
    }
    if (chatSessionId) {
      releasePassiveSessionStreamingState(chatSessionId)
    }
    requestedRuntimeActiveRunMessageRef.current = null
    runtimeQueueSignatureRef.current = null
  }, [chatSessionId, driverEnabled])

  useLayoutEffect(() => {
    if (!driverEnabled || !chatSessionId || !snapshotRows) {
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
  }, [chatSessionId, driverEnabled, snapshotRows])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId || !snapshotRowsQuery.isError) {
      return
    }
    useChatStore.getState().setSessionHydrated(chatSessionId, true)
    useChatStore.getState().setPassiveStatus(chatSessionId, 'error')
  }, [chatSessionId, driverEnabled, snapshotRowsQuery.isError])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId || !runtimeStatus || runtimeStatus.status !== 'idle' || runtimeStatus.activeRun) {
      return
    }

    const state = useChatStore.getState()
    const meta = state.sessionMetaMap.get(chatSessionId)
    const sessionMessages = state.messagesMap.get(chatSessionId) ?? []
    const hasStaleStreamingState = Boolean(meta?.locallyDriving || meta?.passiveStatus === 'streaming')
      || sessionMessages.some(
        message => state.generatingMessageIds.has(message.id) || state.passiveStreamingMessageIds.has(message.id),
      )
    if (!hasStaleStreamingState) {
      return
    }

    if (passiveStreamRef.current?.sessionId === chatSessionId) {
      passiveStreamRef.current.controller.abort()
      passiveStreamRef.current.handler.dispose()
      passiveStreamRef.current = null
    }
    releaseStaleSessionStreamingState(chatSessionId)
    scheduleSnapshotRefresh(0)
    refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
  }, [chatSessionId, driverEnabled, refreshQueue, runtimeStatus, scheduleSnapshotRefresh, snapshotRows])

  useEffect(() => {
    return () => {
      if (passiveStreamRef.current) {
        passiveStreamRef.current.controller.abort()
        passiveStreamRef.current.handler.dispose()
        passiveStreamRef.current = null
      }
      requestedRuntimeActiveRunMessageRef.current = null
      runtimeQueueSignatureRef.current = null
    }
  }, [chatSessionId])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId || !runtimeStatus) {
      runtimeQueueSignatureRef.current = null
      return
    }

    const queueSignature = [
      runtimeStatus.queue.pending,
      runtimeStatus.queue.running,
      runtimeStatus.pendingQueueItemId ?? '',
      runtimeStatus.activeRun?.queueItemId ?? '',
    ].join(':')
    if (runtimeQueueSignatureRef.current === queueSignature) {
      return
    }
    runtimeQueueSignatureRef.current = queueSignature

    if (
      runtimeStatus.queue.pending > 0
      || runtimeStatus.queue.running > 0
      || runtimeStatus.pendingQueueItemId
      || runtimeStatus.activeRun?.queueItemId
    ) {
      refreshQueue(0)
    }
  }, [chatSessionId, driverEnabled, refreshQueue, runtimeStatus])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId) {
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
  }, [chatSessionId, driverEnabled, runtimeStatus?.activeRun?.messageId, scheduleSnapshotRefresh, snapshotRows])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId || !snapshotRows) {
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
  }, [chatSessionId, driverEnabled, refreshQueue, scheduleSnapshotRefresh, snapshotRows])
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
  const runtimeStatusQuery = useRuntimeSessionStatus(chatSessionId)
  const runtimeStatus = runtimeStatusQuery.data
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
    const codexGoalObjective = files.length === 0 && contextParts.length === 0
      ? readCodexGoalCommandObjective(text)
      : null
    const canonicalRuntimeStatus = await queryClient.fetchQuery({
      queryKey: runtimeSessionStatusQueryKey(chatSessionId),
      queryFn: () => getRuntimeSessionStatus(chatSessionId),
      staleTime: 0,
    }).catch(() => runtimeStatus ?? null)
    const isBusy = Boolean(
      canonicalRuntimeStatus
      && (
        canonicalRuntimeStatus.status === 'streaming'
        || canonicalRuntimeStatus.status === 'pending'
        || canonicalRuntimeStatus.status === 'cancelling'
        || canonicalRuntimeStatus.activeRun
      ),
    )

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

        const ownerId = useLayoutStore.getState().activeBrowserPanelOwnerId
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

    const startNewResponse = async () => {
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

      const assistantMessageId = `assistant-${Date.now()}`
      const controller = new AbortController()
      const requestStartedAtMs = performance.now()
      const handler = new ChatStreamingHandler(chatSessionId, assistantMessageId, requestStartedAtMs)
      handler.start(controller)
      handlerRef.current = handler
      let acceptedByServer = false

      try {
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
        acceptedByServer = true

        scheduleSnapshotRefresh(0)

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
        else if (!acceptedByServer) {
          const store = useChatStore.getState()
          store.finishGeneration(assistantMessageId)
          store.removeMessage(chatSessionId, assistantMessageId)
          store.removeMessage(chatSessionId, userMessageId)
          throw err
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
        if (!wasLocallyAborted && acceptedByServer) {
          scheduleSnapshotRefresh(0)
          void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(chatSessionId) })
          void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey(chatSessionId) })
          refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
        }
      }
    }

    if (isBusy) {
      if (codexGoalObjective) {
        const latestRuntimeStatus = canonicalRuntimeStatus ?? await queryClient.fetchQuery({
          queryKey: runtimeSessionStatusQueryKey(chatSessionId),
          queryFn: () => getRuntimeSessionStatus(chatSessionId),
          staleTime: 0,
        })
        if (latestRuntimeStatus && latestRuntimeStatus.runtimeKind === 'codex') {
          const threadId = latestRuntimeStatus.providerSessionId
          if (!threadId) {
            throw new Error('Cannot update Codex goal before the provider thread is available.')
          }

          await postChatSessionsBySessionIdCodexAppServerInvoke({
            path: { sessionId: chatSessionId },
            body: {
              method: 'thread/goal/set',
              params: {
                threadId,
                objective: codexGoalObjective,
                status: 'active',
              },
              providerTargetId: opts?.providerTargetId ?? undefined,
              modelId: opts?.modelId ?? undefined,
            },
            throwOnError: true,
          })
          scheduleSnapshotRefresh(0)
          void queryClient.invalidateQueries({ queryKey: runtimeSessionStatusQueryKey(chatSessionId) })
          void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(chatSessionId) })
          refreshSessionLists()
          return
        }
      }

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
        const steerBody = {
          text: body.text,
          files: body.files,
          contextParts: body.contextParts,
          providerTargetId: body.providerTargetId,
        }
        try {
          const steer = await steerChatSessionTurn({
            sessionId: chatSessionId,
            body: steerBody,
          })
          useChatStore.getState().insertLiveSteerMessage(chatSessionId, steer.message)
          scheduleSnapshotRefresh(0)
        }
        catch (error) {
          const errorCode = readChatCommandErrorCode(error)
          if (!STEER_FALLBACK_ERROR_CODES.has(errorCode ?? '')) {
            throw error
          }

          if (errorCode === 'chat_steer_no_active_run') {
            const runtimeStatus = await queryClient.fetchQuery({
              queryKey: runtimeSessionStatusQueryKey(chatSessionId),
              queryFn: () => getRuntimeSessionStatus(chatSessionId),
              staleTime: 0,
            }).catch(() => null)
            releaseStaleSessionStreamingState(chatSessionId)
            void queryClient.invalidateQueries({ queryKey: runtimeSessionStatusQueryKey(chatSessionId) })
            if (
              !runtimeStatus
              || (runtimeStatus.status === 'idle'
                && !runtimeStatus.activeRun
                && runtimeStatus.queue.pending === 0
                && runtimeStatus.queue.running === 0)
            ) {
              await startNewResponse()
              return
            }

            scheduleSnapshotRefresh(0)
            await enqueueChatSessionQueueItem({
              sessionId: chatSessionId,
              body,
            })
            refreshQueue()
            return
          }

          await enqueueChatSessionQueueItem({
            sessionId: chatSessionId,
            body,
          })
          refreshQueue()
          toastManager.add({
            type: 'info',
            title: 'Added to queue',
            description: 'Live guidance did not match the active provider turn, so it was queued instead.',
          })
        }
        return
      }

      await enqueueChatSessionQueueItem({
        sessionId: chatSessionId,
        body,
      })
      refreshQueue()
      return
    }

    await startNewResponse()
  }, [chatSessionId, queryClient, refreshQueue, refreshSessionLists, runtimeKind, runtimeStatus, scheduleSnapshotRefresh, sessionBindingQueryKey])

  const respondToToolApproval = useCallback(async (response: ToolApprovalResponseInput) => {
    if (!chatSessionId) {
      return
    }

    const store = useChatStore.getState()
    const currentMessages = store.messagesMap.get(chatSessionId) ?? []
    const planImplementationRequest = readPlanImplementationApprovalRequest(currentMessages, response)
    if (planImplementationRequest) {
      const result = await resolvePlanImplementationApproval({
        sessionId: chatSessionId,
        messageId: response.messageId,
        approvalId: response.approvalId,
        approved: response.approved,
      })
      useChatStore.getState().updateMessage(
        chatSessionId,
        response.messageId,
        () => result.message,
        { dirtyToolCallIds: new Set([planImplementationRequest.toolCallId]) },
      )
      scheduleSnapshotRefresh(0)
      if (response.approved) {
        await updateSessionRuntimeSettings({
          sessionId: chatSessionId,
          patch: { interactionMode: 'default' },
        })
        void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey(chatSessionId) })
        await sendMessage(CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX, {
          runtimeSettings: { interactionMode: 'default' },
        })
      }
      return
    }

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

      scheduleSnapshotRefresh(0)

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
  }, [chatSessionId, queryClient, refreshQueue, refreshSessionLists, scheduleSnapshotRefresh, sendMessage, sessionBindingQueryKey])

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
