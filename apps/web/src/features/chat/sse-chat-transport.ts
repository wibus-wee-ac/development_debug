import type { ChatPartDelta, ChatStreamEvent } from './chat-delta-events'
import { z } from 'zod'

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
const ChatPartDeltaSchema = z.custom<ChatPartDelta>()
const ChatStreamEventSchema: z.ZodType<ChatStreamEvent> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message_delta'),
    data: z.object({ messageId: z.string(), deltas: z.array(ChatPartDeltaSchema) }),
  }),
  z.object({
    type: z.literal('subagent_message_delta'),
    data: z.object({
      context: z.object({
        messageId: z.string(),
        parentMessageId: z.string(),
        parentToolCallId: z.string(),
        taskId: z.string().nullable().optional(),
      }),
      deltas: z.array(ChatPartDeltaSchema),
    }),
  }),
  z.object({
    type: z.literal('run_completed'),
    data: z.object({ messageId: z.string() }),
  }),
  z.object({
    type: z.literal('run_aborted'),
    data: z.object({ messageId: z.string() }),
  }),
  z.object({
    type: z.literal('run_failed'),
    data: z.object({ messageId: z.string(), errorText: z.string() }),
  }),
])
const ChatStreamEventJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.record(z.string(), z.unknown()))
  .transform(raw => ({
    event: ChatStreamEventSchema.parse(raw),
    raw,
  }))

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

          const parsed = ChatStreamEventJsonSchema.parse(data)
          const event = parsed.event

          const eventType = event.type === 'run_completed'
            ? 'run.completed'
            : event.type === 'run_aborted'
              ? 'run.aborted'
              : event.type === 'run_failed'
                ? 'run.failed'
                : 'run.streaming'
          const messageId = event.type === 'subagent_message_delta'
            ? event.data.context.messageId
            : event.data.messageId

          emitRunEvent({
            chatSessionId,
            messageId,
            event: {
              type: eventType,
              raw: parsed.raw,
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
