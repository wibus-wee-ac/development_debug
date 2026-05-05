// Input: ipc.chat IPC surface and chatPush preload timeline event bridge
// Output: createIpcChatTransport — AI SDK ChatTransport implementation backed by projected timeline chunks
// Position: Feature helper for chat feature, bridges AI SDK's useChat to Electron IPC

import type { ChatTimelineEventPayload } from '@shared/chat-events'
import { ipc } from '@renderer/lib/ipc'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

function extractText(parts: UIMessage['parts']): string {
  return parts
    .filter((p): p is { type: 'text', text: string } => p.type === 'text')
    .map(p => p.text)
    .join('')
}

/**
 * Build a ReadableStream bridging `chat:timeline-event` IPC events for a given
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
    catch {
      // Stream was already closed by the consumer; nothing left to do.
    }
  }
  const closeWithError = (err: unknown) => {
    if (closed) {
      return
    }
    closed = true
    // controller.error() puts the ReadableStream into "errored" state,
    // which the AI SDK surfaces as chat.error (status → 'error').
    try {
      ctrl.error(err)
    }
    catch {
      // Stream was already closed by the consumer; surfacing another error would be noisy.
    }
  }

  const safeEnqueue = (chunk: UIMessageChunk) => {
    if (closed) {
      return
    }

    try {
      ctrl.enqueue(chunk)
    }
    catch (error) {
      offEvent()
      closed = true

      if (error instanceof Error && !error.message.includes('closed readable stream')) {
        throw error
      }
    }
  }

  const offEvent = window.chatPush.onTimelineEvent(
    (data: ChatTimelineEventPayload) => {
      if (data.chatSessionId !== chatSessionId || closed) {
        return
      }
      const { event, chunks } = data

      for (const chunk of chunks) {
        safeEnqueue(chunk)
      }

      if (event.type === 'run.completed' || event.type === 'run.aborted') {
        offEvent()
        closeCleanly()
      }
      else if (event.type === 'run.failed') {
        offEvent()
        const msg = event.error || 'chat failed'
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
