// Input: chatSessionId + server HTTP API
// Output: SSE response stream helpers and run event emitter
// Position: apps/web/src/features/chat/sse-chat-transport.ts

import type { UIMessageChunk } from 'ai'

// ── Per-session run event emitter ───────────────────────────

/** Payload shape for chat timeline / run lifecycle events. */
interface ChatTimelineEventPayload {
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
    if (handlers!.size === 0) {
      sessionHandlers.delete(sessionId)
    }
  }
}

function emitRunEvent(data: ChatTimelineEventPayload): void {
  const handlers = sessionHandlers.get(data.chatSessionId)
  if (!handlers) {
    return
  }
  for (const fn of handlers) {
    fn(data)
  }
}

/** Minimal shape of a StoredChunk as delivered by the SSE stream. */
type StoredChunkShape = {
  runId: string
  chatSessionId: string
  chunk: UIMessageChunk
  parentToolCallId?: string | null
  taskId?: string | null
  [key: string]: unknown
}

/**
 * Envelope passed from the SSE stream to the streaming handler.
 * Carries the chunk plus routing metadata from StoredChunk.
 */
export interface StoredChunkEnvelope {
  chunk: UIMessageChunk
  parentToolCallId?: string | null
}

export function buildChunkStreamFromResponse(
  response: Response,
  chatSessionId: string,
): ReadableStream<StoredChunkEnvelope> {
  let ctrl: ReadableStreamDefaultController<StoredChunkEnvelope> = null!
  let closed = false

  const readable = new ReadableStream<StoredChunkEnvelope>({
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

  const safeEnqueue = (envelope: StoredChunkEnvelope) => {
    if (closed) {
      return
    }
    try {
      ctrl.enqueue(envelope)
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

      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read()
        if (done) {
          return
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

          safeEnqueue({ chunk: stored.chunk, parentToolCallId: stored.parentToolCallId })

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
        await pump()
      }

      await pump()

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
