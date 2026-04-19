// Input: ipc.chat IPC surface, chat:message-chunk / chat:message-finalized events
// Output: createIpcChatTransport — AI SDK ChatTransport implementation backed by our main-process ChatEngine
// Position: Feature helper for chat feature, bridges AI SDK's useChat to Electron IPC

import { ipc } from '@renderer/lib/ipc'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

interface ChunkPayload {
  chatSessionId: string
  messageId: string
  chunk: UIMessageChunk
}

interface FinalizedPayload {
  chatSessionId: string
  messageId: string
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText: string | null
}

function extractText(parts: UIMessage['parts']): string {
  return parts
    .filter((p): p is { type: 'text', text: string } => p.type === 'text')
    .map(p => p.text)
    .join('')
}

/**
 * Build a ReadableStream that bridges chat:message-chunk / chat:message-finalized
 * IPC events for a given chat session. `onReady` is invoked after subscriptions
 * are attached — callers use it to kick off the action that causes the engine to
 * emit events (e.g. `ipc.chat.send`), guaranteeing no chunk is missed.
 */
function buildChunkStream(
  chatSessionId: string,
  onReady: () => Promise<void> | void,
  abortSignal: AbortSignal | undefined,
): ReadableStream<UIMessageChunk> {
  const { readable, writable } = new TransformStream<UIMessageChunk, UIMessageChunk>()
  const writer = writable.getWriter()

  let closed = false
  const closeCleanly = () => {
    if (closed) { return }
    closed = true
    writer.close().catch(() => {})
  }
  const closeWithError = (err: unknown) => {
    if (closed) { return }
    closed = true
    writer.abort(err).catch(() => {})
  }

  const offChunk = window.electron.ipcRenderer.on(
    'chat:message-chunk',
    (_: unknown, data: ChunkPayload) => {
      if (data.chatSessionId !== chatSessionId || closed) { return }
      writer.write(data.chunk).catch(() => {})
    },
  )

  const offFinal = window.electron.ipcRenderer.on(
    'chat:message-finalized',
    (_: unknown, data: FinalizedPayload) => {
      if (data.chatSessionId !== chatSessionId || closed) { return }
      offChunk()
      offFinal()
      if (data.status === 'failed') {
        closeWithError(new Error(data.errorText ?? 'chat failed'))
      }
      else {
        closeCleanly()
      }
    },
  )

  if (abortSignal) {
    const onAbort = () => {
      if (closed) { return }
      offChunk()
      offFinal()
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
      offChunk()
      offFinal()
      closeWithError(err)
    })

  return readable
}

/**
 * Transport that pipes AI SDK's useChat through our ChatEngine IPC surface.
 * sendMessages → `ipc.chat.send`; chunks/finalize events are converted back
 * into a `UIMessageChunk` ReadableStream that useChat's assembler consumes.
 * reconnectToStream resumes the in-flight draft after navigation/reload.
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
