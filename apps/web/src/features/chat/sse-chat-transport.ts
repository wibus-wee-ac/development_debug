import type { UIMessageChunk } from 'ai'
import { parseJsonEventStream, uiMessageChunkSchema } from 'ai'

interface ChatRunActivityPayload {
  chatSessionId: string
  messageId: string | null
  chunk: UIMessageChunk
}

export type ChatRunSettledStatus = 'complete' | 'aborted' | 'error'

interface ChatRunSettledPayload {
  chatSessionId: string
  messageId: string | null
  status: ChatRunSettledStatus
}

type RunActivityHandler = (data: ChatRunActivityPayload) => void
type RunSettledHandler = (data: ChatRunSettledPayload) => void

const globalHandlers = new Set<RunActivityHandler>()
const settledHandlers = new Set<RunSettledHandler>()

export function onAnyChatRunEvent(handler: RunActivityHandler): () => void {
  globalHandlers.add(handler)
  return () => {
    globalHandlers.delete(handler)
  }
}

export function onChatRunSettled(handler: RunSettledHandler): () => void {
  settledHandlers.add(handler)
  return () => {
    settledHandlers.delete(handler)
  }
}

export function emitChatRunActivity(data: ChatRunActivityPayload): void {
  for (const handler of globalHandlers) {
    handler(data)
  }
}

export function emitChatRunSettled(data: ChatRunSettledPayload): void {
  for (const handler of settledHandlers) {
    handler(data)
  }
}

function readChunkMessageId(chunk: UIMessageChunk): string | null {
  if (chunk.type === 'start') {
    return chunk.messageId ?? null
  }
  if ('toolCallId' in chunk && typeof chunk.toolCallId === 'string') {
    return null
  }
  return null
}

export function readTerminalChunkStatus(chunk: UIMessageChunk): ChatRunSettledStatus | null {
  if (chunk.type === 'finish') {
    return 'complete'
  }
  if (chunk.type === 'abort') {
    return 'aborted'
  }
  if (chunk.type === 'error') {
    return 'error'
  }
  return null
}

export function buildUIMessageChunkStreamFromResponse(
  response: Response,
  chatSessionId: string,
): ReadableStream<UIMessageChunk> {
  if (!response.body) {
    throw new Error('SSE stream has no body')
  }

  return parseJsonEventStream({
    stream: response.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(new TransformStream({
    transform(result, controller) {
      if (!result.success) {
        throw result.error
      }
      emitChatRunActivity({
        chatSessionId,
        messageId: readChunkMessageId(result.value),
        chunk: result.value,
      })
      const terminalStatus = readTerminalChunkStatus(result.value)
      if (terminalStatus) {
        emitChatRunSettled({
          chatSessionId,
          messageId: readChunkMessageId(result.value),
          status: terminalStatus,
        })
      }
      controller.enqueue(result.value)
    },
  }))
}
