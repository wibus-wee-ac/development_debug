// Input: chatSessionId + server HTTP API
// Output: SSE chat delta stream helpers and run event emitter
// Position: apps/web/src/features/chat/sse-chat-transport.ts

import type { ChatStreamEvent } from './chat-delta-events'

// ── Per-session run event emitter ───────────────────────────

/** Payload shape for chat snapshot-stream / run lifecycle events. */
interface ChatRunEventPayload {
  chatSessionId: string
  messageId: string
  event: {
    type: 'run.streaming' | 'run.completed' | 'run.aborted' | 'run.failed'
    raw?: Record<string, unknown>
  }
}

type RunEventHandler = (data: ChatRunEventPayload) => void

const sessionHandlers = new Map<string, Set<RunEventHandler>>()
const globalHandlers = new Set<RunEventHandler>()

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

/**
 * Subscribe to chat run events for all sessions.
 * Returns an unsubscribe function.
 */
export function onAnyChatRunEvent(handler: RunEventHandler): () => void {
  globalHandlers.add(handler)
  return () => {
    globalHandlers.delete(handler)
  }
}

function emitRunEvent(data: ChatRunEventPayload): void {
  for (const fn of globalHandlers) {
    fn(data)
  }
  const handlers = sessionHandlers.get(data.chatSessionId)
  if (!handlers) {
    return
  }
  for (const fn of handlers) {
    fn(data)
  }
}

export function buildEventStreamFromResponse(
  response: Response,
  chatSessionId: string,
): ReadableStream<ChatStreamEvent> {
  let ctrl: ReadableStreamDefaultController<ChatStreamEvent> = null!
  let closed = false

  const readable = new ReadableStream<ChatStreamEvent>({
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

  const safeEnqueue = (event: ChatStreamEvent) => {
    if (closed) {
      return
    }
    try {
      ctrl.enqueue(event)
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

          let event: ChatStreamEvent
          try {
            event = JSON.parse(data) as ChatStreamEvent
          }
          catch { continue }

          const eventType = event.type === 'run_completed'
            ? 'run.completed'
            : event.type === 'run_aborted'
              ? 'run.aborted'
              : event.type === 'run_failed'
                ? 'run.failed'
                : 'run.streaming'
          const messageId = 'data' in event && typeof event.data === 'object' && event.data !== null && 'messageId' in event.data
            ? String((event.data as { messageId?: unknown }).messageId)
            : event.type === 'subagent_message_delta'
              ? event.data.context.messageId
              : ''

          emitRunEvent({
            chatSessionId,
            messageId,
            event: {
              type: eventType,
              raw: event as unknown as Record<string, unknown>,
            },
          })

          safeEnqueue(event)

          if (event.type === 'run_completed' || event.type === 'run_aborted') {
            closeCleanly()
            return
          }
          if (event.type === 'run_failed') {
            closeWithError(new Error(event.data.errorText || 'chat run failed'))
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
