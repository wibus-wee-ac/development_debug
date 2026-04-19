// Input: ipc.chat IPC surface, chat:* events on electron.ipcRenderer, ai/readUIMessageStream
// Output: useChatSession — reactive subscriber that mirrors the main-process ChatEngine
// Position: Feature hook for chat feature; pure view layer, no orchestration

import { ipc } from '@renderer/lib/ipc'
import type { UIMessage, UIMessageChunk } from 'ai'
import { readUIMessageStream } from 'ai'
import { useCallback, useEffect, useRef, useState } from 'react'

type ChatStatus = 'idle' | 'streaming' | 'error'

interface MessageCreatedPayload {
  chatSessionId: string
  message: {
    id: string
    role: 'user' | 'assistant'
    status: 'streaming' | 'complete' | 'aborted' | 'failed'
    content: string
  }
}

interface MessageChunkPayload {
  chatSessionId: string
  messageId: string
  chunk: UIMessageChunk
}

interface MessageFinalizedPayload {
  chatSessionId: string
  messageId: string
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText: string | null
}

function parseMessage(content: string, fallbackId: string, fallbackRole: 'user' | 'assistant'): UIMessage {
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

export function useChatSession(chatSessionId: string | null) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [error, setError] = useState<string | undefined>()
  const [isReady, setIsReady] = useState(false)

  // Per-draft controller for streaming messages.
  const controllersRef = useRef(new Map<string, ReadableStreamDefaultController<UIMessageChunk>>())
  // Message IDs for which we've already observed a chat:message-finalized.
  // Guards against the race where finalize fires before the initial getMessages
  // response opens a draft stream — without this, openDraftStream would leak a
  // controller that never gets closed.
  const finalizedIdsRef = useRef(new Set<string>())

  const upsertMessage = useCallback((next: UIMessage) => {
    setMessages((prev) => {
      const idx = prev.findIndex(m => m.id === next.id)
      if (idx < 0) {
        return [...prev, next]
      }
      const copy = [...prev]
      copy[idx] = next
      return copy
    })
  }, [])

  const openDraftStream = useCallback(
    (message: UIMessage) => {
      const controllers = controllersRef.current
      if (controllers.has(message.id) || finalizedIdsRef.current.has(message.id)) {
        return
      }

      const stream = new ReadableStream<UIMessageChunk>({
        start(controller) {
          controllers.set(message.id, controller)
        },
      })

      void (async () => {
        try {
          for await (const snap of readUIMessageStream<UIMessage>({
            message,
            stream,
          })) {
            upsertMessage(snap)
          }
        }
        catch {
          // readUIMessageStream throws on cancel/close; ignore
        }
        finally {
          controllers.delete(message.id)
        }
      })()
    },
    [upsertMessage],
  )

  // ── Initial load ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!chatSessionId || !ipc) {
      setMessages([])
      setStatus('idle')
      setError(undefined)
      setIsReady(false)
      return
    }

    // Reset per-session tracking when the target session changes
    finalizedIdsRef.current.clear()

    let cancelled = false
    ipc.chat
      .getMessages(chatSessionId)
      .then((rows) => {
        if (cancelled) {
          return
        }
        const hydrated = rows.map(row => parseMessage(row.content, row.id, row.role))
        setMessages(hydrated)
        const streamingRow = rows.find(r => r.status === 'streaming')
        if (streamingRow) {
          const msg = hydrated.find(m => m.id === streamingRow.id)
          if (msg) {
            openDraftStream(msg)
          }
          setStatus('streaming')
        }
        else {
          const failedRow = rows.find(r => r.status === 'failed')
          setStatus(failedRow ? 'error' : 'idle')
          setError(failedRow?.errorText ?? undefined)
        }
        setIsReady(true)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setIsReady(false)
      })

    return () => {
      cancelled = true
    }
  }, [chatSessionId, openDraftStream])

  // ── Event subscription ───────────────────────────────────────────────────

  useEffect(() => {
    if (!chatSessionId) {
      return
    }
    const controllers = controllersRef.current

    const offCreated = window.electron.ipcRenderer.on(
      'chat:message-created',
      (_event: unknown, data: MessageCreatedPayload) => {
        if (data.chatSessionId !== chatSessionId) {
          return
        }
        const msg = parseMessage(data.message.content, data.message.id, data.message.role)
        upsertMessage(msg)
        if (data.message.role === 'assistant' && data.message.status === 'streaming') {
          openDraftStream(msg)
          setStatus('streaming')
          setError(undefined)
        }
      },
    )

    const offChunk = window.electron.ipcRenderer.on(
      'chat:message-chunk',
      (_event: unknown, data: MessageChunkPayload) => {
        if (data.chatSessionId !== chatSessionId) {
          return
        }
        const controller = controllers.get(data.messageId)
        if (controller) {
          try {
            controller.enqueue(data.chunk)
          }
          catch {
            // controller already closed
          }
        }
      },
    )

    const offFinal = window.electron.ipcRenderer.on(
      'chat:message-finalized',
      (_event: unknown, data: MessageFinalizedPayload) => {
        if (data.chatSessionId !== chatSessionId) {
          return
        }
        // Record finalize so a subsequent openDraftStream call (from a racing
        // initial-load response) won't leak a controller that no chunk ever feeds.
        finalizedIdsRef.current.add(data.messageId)
        const controller = controllers.get(data.messageId)
        if (controller) {
          try {
            controller.close()
          }
          catch {
            // already closed
          }
        }
        if (data.status === 'failed') {
          setStatus('error')
          setError(data.errorText ?? '发送失败，请重试')
        }
        else {
          setStatus('idle')
          setError(undefined)
        }
      },
    )

    return () => {
      offCreated()
      offChunk()
      offFinal()
      // Close any remaining controllers on unmount
      for (const c of controllers.values()) {
        try {
          c.close()
        }
        catch {
          // noop
        }
      }
      controllers.clear()
      finalizedIdsRef.current.clear()
    }
  }, [chatSessionId, openDraftStream, upsertMessage])

  // ── Commands ─────────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string) => {
      if (!chatSessionId || !ipc) {
        return
      }
      await ipc.chat.send(chatSessionId, text)
    },
    [chatSessionId],
  )

  const stop = useCallback(async () => {
    if (!chatSessionId || !ipc) {
      return
    }
    await ipc.chat.abort(chatSessionId)
  }, [chatSessionId])

  return {
    messages,
    status,
    error,
    sendMessage,
    stop,
    isReady,
  }
}
