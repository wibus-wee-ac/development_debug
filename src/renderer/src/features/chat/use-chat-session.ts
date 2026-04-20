// Input: @ai-sdk/react useChat, ipc-chat-transport, ipc.chat
// Output: useChatSession — thin wrapper over AI SDK's useChat, backed by ChatEngine over IPC
// Position: Feature hook for chat feature; renderer-side view layer, no orchestration

import { useChat } from '@ai-sdk/react'
import { ipc } from '@renderer/lib/ipc'
import type { ChatStatus, UIMessage } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

export function useChatSession(chatSessionId: string | null) {
  const transport = useMemo(
    () => (chatSessionId ? createIpcChatTransport(chatSessionId) : undefined),
    [chatSessionId],
  )

  const chat = useChat<UIMessage>({
    id: chatSessionId ?? EMPTY_CHAT_ID,
    transport,
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

  // Initial load + resume if a draft is in flight
  useEffect(() => {
    if (!chatSessionId || !ipc) {
      chatRef.current.setMessages([])
      setIsReady(false)
      return
    }

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
  // on any finalize for this session while we're idle, resync from DB so content
  // matches the backend snapshot.
  useEffect(() => {
    if (!chatSessionId || !ipc) {
      return
    }
    const off = window.electron.ipcRenderer.on(
      'chat:message-finalized',
      (_: unknown, data: { chatSessionId: string }) => {
        if (data.chatSessionId !== chatSessionId) {
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
