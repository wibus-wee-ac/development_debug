// Input: @ai-sdk/react useChat, ipc-chat-transport, ipc.chat
// Output: useChatSession — thin wrapper over AI SDK's useChat, backed by ChatEngine over IPC
// Position: Feature hook for chat feature; renderer-side view layer, no orchestration

import { useChat } from '@ai-sdk/react'
import { ipc } from '@renderer/lib/ipc'
import type { ChatStatus, UIMessage } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Raw message row as returned by `ipc.chat.getMessages`. */
export type ChatMessageRow = Awaited<ReturnType<NonNullable<typeof ipc>['chat']['getMessages']>>[number]

import { createIpcChatTransport } from './ipc-chat-transport'

type PublicStatus = 'idle' | 'streaming' | 'error'

function parseMessage(
  content: string,
  fallbackId: string,
  fallbackRole: 'user' | 'assistant',
): UIMessage {
  try {
    const parsed = JSON.parse(content) as { id?: string, role?: string, parts?: unknown[] }
    if (parsed.parts && Array.isArray(parsed.parts)) {
      return {
        id: parsed.id ?? fallbackId,
        role: (parsed.role as UIMessage['role']) ?? fallbackRole,
        parts: parsed.parts as UIMessage['parts'],
      }
    }
  }
  catch {
    // fall through
  }
  return {
    id: fallbackId,
    role: fallbackRole,
    parts: [{ type: 'text', text: content }],
  }
}

function mapStatus(status: ChatStatus): PublicStatus {
  if (status === 'streaming' || status === 'submitted') {
    return 'streaming'
  }
  if (status === 'error') {
    return 'error'
  }
  return 'idle'
}

/**
 * Stable, recognisable placeholder id used when no chat session is selected.
 * useChat needs an id on every render; we just avoid feeding it null/undefined
 * that would cause internal regeneration each render.
 */
const EMPTY_CHAT_ID = '__cradle_empty_chat__'
const STREAM_RENDER_THROTTLE_MS = 50

export function useChatSession(chatSessionId: string | null, options?: {
  /**
   * Pre-loaded message rows from a TanStack Router loader or similar source.
   * When provided, `isReady` is true immediately (no empty-state flash) and
   * the hook still re-fetches in the background for streaming + freshness.
   */
  initialMessageRows?: ChatMessageRow[]
}) {
  const { initialMessageRows } = options ?? {}

  const transport = useMemo(
    () => (chatSessionId ? createIpcChatTransport(chatSessionId) : undefined),
    [chatSessionId],
  )

  // Parsed UIMessages for useChat initialisation — captured once per session.
  // Intentionally keyed on chatSessionId (not initialMessageRows) so that the
  // same session's stale loader data doesn't trigger a useChat re-initialisation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cachedInitialMessages = useMemo(
    () => initialMessageRows?.map(r => parseMessage(r.content, r.id, r.role)),
    [chatSessionId],
  )

  const chat = useChat<UIMessage>({
    id: chatSessionId ?? EMPTY_CHAT_ID,
    transport,
    messages: cachedInitialMessages,
    // AI SDK emits one React update per chunk by default. Our chat view renders
    // markdown, motion, and tool blocks, so throttling prevents render storms.
    experimental_throttle: STREAM_RENDER_THROTTLE_MS,
    onError: (error) => {
      console.error('[useChatSession] useChat stream failed', {
        chatSessionId,
        error,
        message: error.message,
        stack: error.stack,
      })
    },
  })

  // useChat's helpers close over the latest state; stash in a ref so background
  // IPC callbacks always call the current versions without stale closures.
  const chatRef = useRef(chat)
  useEffect(() => {
    chatRef.current = chat
  }, [chat])

  const [isReady, setIsReady] = useState(false)

  // Initial load + resume if a draft is in flight.
  // If initialMessageRows were pre-loaded (e.g. from a route loader), mark
  // ready immediately so the UI shows content without waiting for this fetch.
  // The fetch still runs to hydrate fresh data and check for active streams.
  useEffect(() => {
    if (!chatSessionId || !ipc) {
      chatRef.current.setMessages([])
      setIsReady(false)
      return
    }

    // Pre-loaded data → already ready. No flash.
    // No pre-loaded data → reset so the UI shows the loading state until fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialMessageRows changes with chatSessionId
    setIsReady(!!initialMessageRows)

    let cancelled = false
    ipc.chat
      .getMessages(chatSessionId)
      .then((rows) => {
        if (cancelled) {
          return
        }
        const hydrated = rows.map(r => parseMessage(r.content, r.id, r.role))
        chatRef.current.setMessages(hydrated)
        setIsReady(true)
        if (rows.some(r => r.status === 'streaming')) {
          void chatRef.current.resumeStream()
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsReady(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [chatSessionId])

  // Covers the "another window finishes a stream we weren't locally driving" case:
  // on any Turn-end for this session while we're idle, resync from DB so content
  // matches the backend snapshot.
  useEffect(() => {
    if (!chatSessionId || !ipc) {
      return
    }
    const off = window.electron.ipcRenderer.on(
      'chat:response-event',
      (_: unknown, data: { chatSessionId: string, event: { type: string } }) => {
        if (data.chatSessionId !== chatSessionId) {
          return
        }
        if (data.event.type !== 'response.completed' && data.event.type !== 'response.failed') {
          return
        }
        const currentStatus = chatRef.current.status
        if (currentStatus === 'streaming' || currentStatus === 'submitted') {
          // Locally driving — useChat is already assembling this turn
          return
        }
        ipc?.chat.getMessages(chatSessionId).then((rows) => {
          const hydrated = rows.map(r => parseMessage(r.content, r.id, r.role))
          chatRef.current.setMessages(hydrated)
        })
      },
    )
    return () => {
      off()
    }
  }, [chatSessionId])

  useEffect(() => {
    if (!chat.error) {
      return
    }
    console.error('[useChatSession] chat.error updated', {
      chatSessionId,
      error: chat.error,
      message: chat.error.message,
      stack: chat.error.stack,
    })
  }, [chatSessionId, chat.error])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!chatSessionId) {
        return
      }
      await chat.sendMessage({ text })
    },
    [chatSessionId, chat],
  )

  const stop = useCallback(() => {
    chat.stop()
  }, [chat])

  return {
    messages: chat.messages,
    status: mapStatus(chat.status),
    error: chat.error?.message,
    sendMessage,
    stop,
    isReady,
  }
}
