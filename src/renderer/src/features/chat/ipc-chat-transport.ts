// Input: ipc.chat IPC surface, chat:response-event (ResponseStreamEvent envelope)
// Output: createIpcChatTransport — AI SDK ChatTransport implementation backed by our main-process ChatEngine
// Position: Feature helper for chat feature, bridges AI SDK's useChat to Electron IPC

import { ipc } from '@renderer/lib/ipc'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import type { ResponseStreamEvent } from 'openai/resources/responses/responses'

interface ChatResponseEventPayload {
  chatSessionId: string
  messageId: string
  event: ResponseStreamEvent
}

function extractText(parts: UIMessage['parts']): string {
  return parts
    .filter((p): p is { type: 'text', text: string } => p.type === 'text')
    .map(p => p.text)
    .join('')
}

/**
 * Convert a single `ResponseStreamEvent` into zero or more AI SDK
 * `UIMessageChunk` objects for `useChat` consumption.
 *
 * State is kept across calls via the `state` object so we can track open
 * text / reasoning spans (needed for start/end pairs).
 */
interface ConverterState {
  textItemId: string | null
  reasoningItemId: string | null
}

function responsesEventToUIMessageChunks(
  event: ResponseStreamEvent,
  state: ConverterState,
): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []

  switch (event.type) {
    case 'response.output_item.added': {
      if (event.item.type === 'message') {
        state.textItemId = event.item.id
        chunks.push({ type: 'text-start', id: event.item.id })
      }
      else if (event.item.type === 'function_call') {
        chunks.push({
          type: 'tool-input-start',
          toolCallId: event.item.call_id,
          toolName: event.item.name,
        })
      }
      break
    }
    case 'response.output_text.delta': {
      chunks.push({ type: 'text-delta', id: event.item_id, delta: event.delta })
      break
    }
    case 'response.output_item.done': {
      if (event.item.type === 'message') {
        chunks.push({ type: 'text-end', id: event.item.id })
        state.textItemId = null
      }
      else if (event.item.type === 'function_call' && event.item.status === 'completed') {
        // arguments encodes { input, output } as JSON (ACP extension)
        try {
          const decoded = JSON.parse(event.item.arguments) as { input: unknown, output: unknown }
          if (decoded.input !== undefined) {
            chunks.push({
              type: 'tool-input-available',
              toolCallId: event.item.call_id,
              toolName: event.item.name,
              input: typeof decoded.input === 'string' ? decoded.input : JSON.stringify(decoded.input),
            })
          }
          if (decoded.output !== null && decoded.output !== undefined) {
            chunks.push({
              type: 'tool-output-available',
              toolCallId: event.item.call_id,
              output: typeof decoded.output === 'string' ? decoded.output : JSON.stringify(decoded.output),
            })
          }
        }
        catch {
          chunks.push({
            type: 'tool-input-available',
            toolCallId: event.item.call_id,
            toolName: event.item.name,
            input: event.item.arguments,
          })
        }
      }
      break
    }
    case 'response.reasoning_summary_part.added': {
      state.reasoningItemId = event.item_id
      chunks.push({ type: 'reasoning-start', id: event.item_id })
      break
    }
    case 'response.reasoning_summary_text.delta': {
      chunks.push({ type: 'reasoning-delta', id: event.item_id, delta: event.delta })
      break
    }
    case 'response.reasoning_summary_part.done': {
      chunks.push({ type: 'reasoning-end', id: event.item_id })
      state.reasoningItemId = null
      break
    }
    case 'response.completed': {
      chunks.push({ type: 'finish', finishReason: 'stop' })
      break
    }
    default:
      break
  }

  return chunks
}

/**
 * Build a ReadableStream bridging `chat:response-event` IPC events for a given
 * chat session into a `UIMessageChunk` stream for AI SDK's `useChat`.
 *
 * Uses a custom ReadableStream with a direct controller reference so that
 * errors are propagated via `controller.error()` (which puts the stream into
 * the "errored" state), rather than `writer.abort()` (which only cancels the
 * stream and is treated as a clean close by the AI SDK).
 *
 * `onReady` is invoked after subscriptions are attached — callers use it to
 * kick off the action that causes the engine to emit events, guaranteeing no
 * event is missed.
 */
function buildChunkStream(
  chatSessionId: string,
  onReady: () => Promise<void> | void,
  abortSignal: AbortSignal | undefined,
): ReadableStream<UIMessageChunk> {
  let ctrl: ReadableStreamDefaultController<UIMessageChunk> = null!
  const state: ConverterState = { textItemId: null, reasoningItemId: null }
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
    ctrl.close()
  }
  const closeWithError = (err: unknown) => {
    if (closed) {
      return
    }
    closed = true
    // controller.error() puts the ReadableStream into "errored" state,
    // which the AI SDK surfaces as chat.error (status → 'error').
    ctrl.error(err)
  }

  const offEvent = window.electron.ipcRenderer.on(
    'chat:response-event',
    (_: unknown, data: ChatResponseEventPayload) => {
      if (data.chatSessionId !== chatSessionId || closed) {
        return
      }
      const { event } = data

      for (const chunk of responsesEventToUIMessageChunks(event, state)) {
        ctrl.enqueue(chunk)
      }

      if (event.type === 'response.completed') {
        offEvent()
        closeCleanly()
      }
      else if (event.type === 'response.failed') {
        offEvent()
        const msg = 'error' in event.response && event.response.error?.message
          ? event.response.error.message
          : 'chat failed'
        closeWithError(new Error(msg))
      }
    },
  )

  if (abortSignal) {
    const onAbort = () => {
      if (closed) {
        return
      }
      offEvent()
      ipc?.chat.abort(chatSessionId).catch(() => {})
      closeCleanly()
    }
    if (abortSignal.aborted) {
      onAbort()
    }
    else {
      abortSignal.addEventListener('abort', onAbort, { once: true })
    }
  }

  Promise.resolve()
    .then(() => onReady())
    .catch((err) => {
      offEvent()
      closeWithError(err)
    })

  return readable
}

/**
 * Transport that pipes AI SDK's useChat through our ChatEngine IPC surface.
 * sendMessages → `ipc.chat.send`; response events are converted to a
 * `UIMessageChunk` ReadableStream that useChat's assembler consumes.
 * reconnectToStream resumes an in-flight draft after navigation/reload.
 */
export function createIpcChatTransport(chatSessionId: string): ChatTransport<UIMessage> {
  return {
    sendMessages: async ({ messages, abortSignal }) => {
      const lastUser = [...messages].reverse().find(m => m.role === 'user')
      if (!lastUser) {
        throw new Error('No user message to send')
      }
      const text = extractText(lastUser.parts).trim()
      if (!text) {
        throw new Error('Cannot send an empty message')
      }
      if (!ipc) {
        throw new Error('IPC not available')
      }

      return buildChunkStream(
        chatSessionId,
        () => ipc!.chat.send(chatSessionId, text),
        abortSignal,
      )
    },

    reconnectToStream: async () => {
      if (!ipc) {
        return null
      }
      const rows = await ipc.chat.getMessages(chatSessionId)
      const isStreaming = rows.some(r => r.status === 'streaming')
      if (!isStreaming) {
        return null
      }
      // Engine's stream is already running; just subscribe to events.
      return buildChunkStream(chatSessionId, () => {}, undefined)
    },
  }
}
