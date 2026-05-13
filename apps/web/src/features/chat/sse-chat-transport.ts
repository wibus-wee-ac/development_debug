// Input: chatSessionId + server HTTP API
// Output: SseChatTransportHandle — ChatTransport backed by single POST /response SSE endpoint
// Position: apps/web/src/features/chat/sse-chat-transport.ts

import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

const SERVER_BASE: string = (import.meta.env as Record<string, string>).VITE_SERVER_URL ?? 'http://localhost:21423'

// ── Per-session run event emitter ───────────────────────────

/** Payload shape for chat timeline / run lifecycle events. */
export interface ChatTimelineEventPayload {
  chatSessionId: string
  messageId: string
  event: Record<string, unknown>
}

type RunEventHandler = (data: ChatTimelineEventPayload) => void

const sessionHandlers = new Map<string, Set<RunEventHandler>>()

/**
 * Subscribe to chat run events for a specific session.
 * Returns an unsubscribe function.
 */
export function onChatRunEvent(sessionId: string, handler: RunEventHandler): () => void {
  let handlers = sessionHandlers.get(sessionId)
  if (!handlers) {
    handlers = new Set()
    sessionHandlers.set(sessionId, handlers)
  }
  handlers.add(handler)
  return () => {
    handlers!.delete(handler)
    if (handlers!.size === 0) sessionHandlers.delete(sessionId)
  }
}

function emitRunEvent(data: ChatTimelineEventPayload): void {
  const handlers = sessionHandlers.get(data.chatSessionId)
  if (!handlers) return
  for (const fn of handlers) {
    fn(data)
  }
}

export interface SseChatTransportHandle {
  transport: ChatTransport<UIMessage>
  abort: () => Promise<void>
}

/** Minimal shape of a StoredChunk as delivered by the SSE stream. */
type StoredChunkShape = {
  runId: string
  chatSessionId: string
  chunk: UIMessageChunk
  [key: string]: unknown
}

export function buildChunkStreamFromResponse(
  response: Response,
  chatSessionId: string,
): ReadableStream<UIMessageChunk> {
  let ctrl: ReadableStreamDefaultController<UIMessageChunk> = null!
  let closed = false

  const readable = new ReadableStream<UIMessageChunk>({
    start(controller) {
      ctrl = controller
    },
  })

  const closeCleanly = () => {
    if (closed) {
      return
    }
    closed = true
    try {
      ctrl.close()
    }
    catch { /* Already closed */ }
  }

  const closeWithError = (err: unknown) => {
    if (closed) {
      return
    }
    closed = true
    try {
      ctrl.error(err)
    }
    catch { /* Already closed */ }
  }

  const safeEnqueue = (chunk: UIMessageChunk) => {
    if (closed) {
      return
    }
    try {
      ctrl.enqueue(chunk)
    }
    catch { /* Stream closed by consumer */ }
  }

  void (async () => {
    try {
      if (!response.body) {
        throw new Error('SSE stream has no body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue
          }
          const data = line.slice(6).trim()
          if (!data) {
            continue
          }

          let stored: StoredChunkShape
          try {
            stored = JSON.parse(data) as StoredChunkShape
          }
          catch { continue }

          emitRunEvent({
            chatSessionId,
            messageId: stored.runId,
            // eslint-disable-next-line ts/no-explicit-any
            event: stored as any,
          })

          safeEnqueue(stored.chunk)

          const chunkType = stored.chunk.type
          if (chunkType === 'finish' || chunkType === 'abort') {
            closeCleanly()
            return
          }
          if (chunkType === 'error') {
            const msg = (stored.chunk as { type: 'error', errorText: string }).errorText || 'chat run failed'
            closeWithError(new Error(msg))
            return
          }
        }
      }

      closeCleanly()
    }
    catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        closeCleanly()
      }
      else {
        closeWithError(err)
      }
    }
  })()

  return readable
}

/**
 * Create an SSE-backed ChatTransport for the web app.
 *
 * - sendMessages: POST /chat/sessions/:sessionId/response → SSE stream directly
 * - abort: POST /chat/sessions/:sessionId/cancel
 */
export function createSseChatTransport(chatSessionId: string): SseChatTransportHandle {
  const transport: ChatTransport<UIMessage> = {
    sendMessages: async ({ messages, abortSignal }) => {
      const lastUser = [...messages].reverse().find(m => m.role === 'user')
      if (!lastUser) {
        throw new Error('No user message to send')
      }
      const text = lastUser.parts
        .filter((p): p is { type: 'text', text: string } => p.type === 'text')
        .map(p => p.text)
        .join('')
        .trim()
      if (!text) {
        throw new Error('Cannot send an empty message')
      }

      const res = await fetch(`${SERVER_BASE}/chat/sessions/${chatSessionId}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: abortSignal,
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Failed to start chat response: ${res.status} ${body}`)
      }

      return buildChunkStreamFromResponse(res, chatSessionId)
    },
    reconnectToStream: async () => null,
  }

  const abort = async (): Promise<void> => {
    await fetch(`${SERVER_BASE}/chat/sessions/${chatSessionId}/cancel`, {
      method: 'POST',
    }).catch(() => {})
  }

  return { transport, abort }
}
