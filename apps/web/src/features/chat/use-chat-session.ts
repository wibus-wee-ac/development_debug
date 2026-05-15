// Input: useChatStore, ChatStreamingHandler, sse-chat-transport, server HTTP API
// Output: useChatSession — hook bridging store + transport for a single chat session
// Position: Feature hook for chat feature; manages lifecycle of streaming + passive observation

import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UIMessage, UIMessageChunk } from 'ai'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import {
  getChatSessionsBySessionIdMessagesOptions,
  getChatSessionsBySessionIdMessagesQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { getServerUrl } from '~/lib/electron'
import type { PublicStatus } from '~/store/chat'
import { chatSelectors, useChatStore } from '~/store/chat'

import { ChatStreamingHandler } from './chat-streaming-handler'
import { buildChunkStreamFromResponse, onChatRunEvent } from './sse-chat-transport'

const SERVER_BASE = getServerUrl()

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

// ── Timeline Types ──────────────────────────────────────────

/**
 * Chunk group row as returned by GET /chat/sessions/:sessionId/messages.
 */
export type ChatTimelineGroupRow = {
  messageId: string
  role: 'user' | 'assistant'
  userText?: string
  status: string
  errorText?: string
  chunks: Array<{ chunk: UIMessageChunk, runId: string, [key: string]: unknown }>
}

type ReplayReasoningPart = {
  type: 'reasoning'
  text: string
  reasoning: string
  details: Array<{ type: 'text', text: string }>
  state?: string
}

type ReplayToolPart = {
  type: 'dynamic-tool'
  toolCallId: string
  toolName: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
}

// ── Replay Utility ──────────────────────────────────────────

function replayChunksToAssistantMessage(messageId: string, chunks: UIMessageChunk[]): UIMessage {
  const message: UIMessage = { id: messageId, role: 'assistant', parts: [] }
  const parts = message.parts

  let currentTextPart: { type: 'text', text: string } | null = null
  let currentReasoningPart: ReplayReasoningPart | null = null

  for (const chunk of chunks) {
    switch (chunk.type) {
      case 'text-start': {
        const meta = (chunk as unknown as { providerMetadata?: Record<string, unknown> }).providerMetadata
        currentTextPart = meta
          ? { type: 'text', text: '', providerMetadata: meta } as unknown as { type: 'text', text: string }
          : { type: 'text', text: '' }
        parts.push(currentTextPart as UIMessage['parts'][number])
        break
      }
      case 'text-delta':
        if (currentTextPart) {
          currentTextPart.text += (chunk as { delta: string }).delta
        }
        else {
          currentTextPart = { type: 'text', text: (chunk as { delta: string }).delta }
          parts.push(currentTextPart)
        }
        break
      case 'text-end':
        currentTextPart = null
        break
      case 'reasoning-start':
        currentReasoningPart = { type: 'reasoning', text: '', reasoning: '', details: [] }
        parts.push(currentReasoningPart as UIMessage['parts'][number])
        break
      case 'reasoning-delta':
        if (currentReasoningPart) {
          currentReasoningPart.reasoning += (chunk as { delta: string }).delta
          currentReasoningPart.text += (chunk as { delta: string }).delta
        }
        break
      case 'reasoning-end':
        currentReasoningPart = null
        break
      case 'tool-input-start': {
        const toolChunk = chunk as unknown as { toolCallId: string, toolName: string, providerMetadata?: Record<string, unknown> }
        const toolPart: Record<string, unknown> = {
          type: 'dynamic-tool',
          toolCallId: toolChunk.toolCallId,
          toolName: toolChunk.toolName,
          state: 'input-streaming',
          input: undefined,
        }
        if (toolChunk.providerMetadata) {
          toolPart.callProviderMetadata = toolChunk.providerMetadata
        }
        parts.push(toolPart as unknown as UIMessage['parts'][number])
        break
      }
      case 'tool-input-available': {
        const toolChunk = chunk as { toolCallId: string, input: unknown }
        const existing = findToolPart(parts, toolChunk.toolCallId)
        if (existing) {
          existing.state = 'input-available'
          existing.input = toolChunk.input
        }
        break
      }
      case 'tool-input-error': {
        const toolChunk = chunk as { toolCallId: string, input: unknown, errorText: string }
        const existing = findToolPart(parts, toolChunk.toolCallId)
        if (existing) {
          existing.state = 'output-error'
          existing.input = toolChunk.input
          existing.errorText = toolChunk.errorText
        }
        break
      }
      case 'tool-output-available': {
        const toolChunk = chunk as { toolCallId: string, output: unknown }
        const existing = findToolPart(parts, toolChunk.toolCallId)
        if (existing) {
          existing.state = 'output-available'
          existing.output = toolChunk.output
        }
        break
      }
    }
  }

  return message
}

function findToolPart(parts: UIMessage['parts'], toolCallId: string): ReplayToolPart | undefined {
  return parts.find((part): part is UIMessage['parts'][number] & ReplayToolPart => 'toolCallId' in part && part.toolCallId === toolCallId)
}

function projectTimelineGroup(group: ChatTimelineGroupRow): UIMessage {
  if (group.role === 'user') {
    return {
      id: group.messageId,
      role: 'user',
      parts: [{ type: 'text', text: group.userText ?? '' }],
    }
  }
  // Filter out subagent chunks (parentToolCallId != null) for main message replay
  const mainChunks = group.chunks
    .flatMap(c => !c.parentToolCallId ? [c.chunk] : [])
  return replayChunksToAssistantMessage(group.messageId, mainChunks)
}

/**
 * Extract subagent chunks from timeline groups, keyed by parentToolCallId.
 * Returns a map: messageId -> Map<parentToolCallId, UIMessageChunk[]>
 */
function extractSubagentChunks(
  groups: ChatTimelineGroupRow[],
): Map<string, Map<string, UIMessageChunk[]>> {
  const result = new Map<string, Map<string, UIMessageChunk[]>>()
  for (const group of groups) {
    if (group.role !== 'assistant') {
      continue
    }
    for (const row of group.chunks) {
      const parentId = row.parentToolCallId as string | null | undefined
      if (!parentId) {
        continue
      }
      let messageMap = result.get(group.messageId)
      if (!messageMap) {
        messageMap = new Map()
        result.set(group.messageId, messageMap)
      }
      let chunks = messageMap.get(parentId)
      if (!chunks) {
        chunks = []
        messageMap.set(parentId, chunks)
      }
      chunks.push(row.chunk)
    }
  }
  return result
}

function derivePassiveStatus(rows: ChatTimelineGroupRow[]): PublicStatus {
  if (rows.some(row => row.status === 'streaming')) {
    return 'streaming'
  }
  const failedAssistant = [...rows].reverse().find(row => row.role === 'assistant' && row.status === 'failed')
  if (failedAssistant) {
    return 'error'
  }
  return 'idle'
}

// ── Hook ────────────────────────────────────────────────────

const SNAPSHOT_SYNC_DEBOUNCE_MS = 75
const PASSIVE_STREAM_REFETCH_MS = 500
const EMPTY_TIMELINE_GROUPS: ChatTimelineGroupRow[] = []

function selectTimelineGroups(data: unknown): ChatTimelineGroupRow[] {
  return Array.isArray(data) ? data as ChatTimelineGroupRow[] : EMPTY_TIMELINE_GROUPS
}

export function useChatSession(chatSessionId: string | null, options?: {
  initialTimelineGroups?: ChatTimelineGroupRow[]
}) {
  const { initialTimelineGroups } = options ?? {}
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

  const timelineQueryKey = useMemo(
    () => chatSessionId
      ? getChatSessionsBySessionIdMessagesQueryKey({ path: { sessionId: chatSessionId } })
      : null,
    [chatSessionId],
  )

  const timelineQuery = useQuery({
    ...getChatSessionsBySessionIdMessagesOptions({ path: { sessionId: chatSessionId ?? '' } }),
    enabled: !!chatSessionId,
    initialData: initialTimelineGroups as unknown,
    refetchInterval: () => {
      if (!chatSessionId) {
        return false
      }
      const meta = useChatStore.getState().sessionMetaMap.get(chatSessionId)
      return meta?.passiveStatus === 'streaming' && !meta.locallyDriving
        ? PASSIVE_STREAM_REFETCH_MS
        : false
    },
    select: selectTimelineGroups,
  })

  const scheduleSnapshotRefresh = useCallback((delay = SNAPSHOT_SYNC_DEBOUNCE_MS) => {
    if (!timelineQueryKey) {
      return
    }
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current)
    }
    snapshotTimerRef.current = setTimeout(() => {
      snapshotTimerRef.current = null
      void queryClient.invalidateQueries({ queryKey: timelineQueryKey })
    }, delay)
  }, [queryClient, timelineQueryKey])

  // ── Initial load ──

  useEffect(() => {
    if (!chatSessionId || !timelineQuery.data) {
      return
    }
    const meta = useChatStore.getState().sessionMetaMap.get(chatSessionId)
    if (meta?.locallyDriving) {
      return
    }

    const projected = timelineQuery.data.map(projectTimelineGroup)
    useChatStore.getState().setMessages(chatSessionId, projected)
    useChatStore.getState().setPassiveStatus(chatSessionId, derivePassiveStatus(timelineQuery.data))

    // Hydrate errorMap from server-side failed messages
    for (const row of timelineQuery.data) {
      if (row.role === 'assistant' && row.status === 'failed' && row.errorText) {
        useChatStore.getState().failGeneration(row.messageId, row.errorText)
      }
    }

    // Hydrate subagent chunks
    const subagentMap = extractSubagentChunks(timelineQuery.data)
    for (const [messageId, parentMap] of subagentMap) {
      useChatStore.getState().setSubagentChunks(messageId, parentMap)
    }
  }, [chatSessionId, timelineQuery.data])

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

      if (data.event.type === 'run.failed') {
        if (isLocallyDriving) {
          // Let the in-band stream handler capture the error with its message
          return
        }
        useChatStore.getState().setSessionMeta(chatSessionId, { locallyDriving: false })
        useChatStore.getState().setPassiveStatus(chatSessionId, 'error')
        scheduleSnapshotRefresh(0)
        return
      }

      if (isLocallyDriving) {
        // We're driving this stream locally — useChat handler manages state
        return
      }

      switch (data.event.type) {
        case 'run.completed':
        case 'run.aborted':
          useChatStore.getState().setSessionMeta(chatSessionId, { locallyDriving: false })
          useChatStore.getState().setPassiveStatus(chatSessionId, 'idle')
          scheduleSnapshotRefresh(0)
          break
        default:
          useChatStore.getState().setPassiveStatus(chatSessionId, 'streaming')
          scheduleSnapshotRefresh()
          break
      }
    })
  }, [chatSessionId, scheduleSnapshotRefresh])

  // ── Send message ──

  const sendMessage = useCallback(async (text: string) => {
    if (!chatSessionId || !text.trim()) {
      return
    }

    // 1. Optimistic user message
    const userMessageId = `user-${Date.now()}`
    const userMessage: UIMessage = {
      id: userMessageId,
      role: 'user',
      parts: [{ type: 'text', text }],
    }
    useChatStore.getState().appendMessage(chatSessionId, userMessage)

    // 2. Create handler for assistant response
    const assistantMessageId = `assistant-${Date.now()}`
    const controller = new AbortController()
    const handler = new ChatStreamingHandler(chatSessionId, assistantMessageId)
    handler.start(controller)
    handlerRef.current = handler

    try {
      // 3. Initiate SSE stream
      const res = await fetch(`${SERVER_BASE}/chat/sessions/${chatSessionId}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Failed to start chat response: ${res.status} ${body}`)
      }

      // 4. Pipe chunks to handler
      const stream = buildChunkStreamFromResponse(res, chatSessionId)
      const reader = stream.getReader()

      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read()
        if (done) {
          return
        }
        handler.handleChunk(value)
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
      handlerRef.current = null
      useChatStore.getState().setSessionMeta(chatSessionId, { locallyDriving: false, passiveStatus: 'idle' })
      // Sync from server to get canonical message IDs
      scheduleSnapshotRefresh(0)
    }
  }, [chatSessionId, scheduleSnapshotRefresh])

  // ── Stop ──

  const stop = useCallback(async () => {
    if (!chatSessionId) {
      return
    }
    const messages = useChatStore.getState().messagesMap.get(chatSessionId) ?? []
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    if (lastAssistant) {
      await useChatStore.getState().stopGeneration(lastAssistant.id, chatSessionId)
    }
  }, [chatSessionId])

  // ── isReady (always true once hydrated) ──

  const isReady = messages.length > 0 || !!initialTimelineGroups || chatSessionId === null

  return {
    messages,
    status: visibleStatus,
    error: lastError?.message,
    sendMessage,
    stop,
    isReady,
  }
}
