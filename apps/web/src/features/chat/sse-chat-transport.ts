import type { UIMessageChunk } from 'ai'
import { parseJsonEventStream, uiMessageChunkSchema } from 'ai'

interface ChatRunActivityPayload {
  chatSessionId: string
  messageId: string | null
  chunk: UIMessageChunk
}

type RunActivityHandler = (data: ChatRunActivityPayload) => void

const globalHandlers = new Set<RunActivityHandler>()

export function onAnyChatRunEvent(handler: RunActivityHandler): () => void {
  globalHandlers.add(handler)
  return () => {
    globalHandlers.delete(handler)
  }
}

function emitRunActivity(data: ChatRunActivityPayload): void {
  for (const handler of globalHandlers) {
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
      emitRunActivity({
        chatSessionId,
        messageId: readChunkMessageId(result.value),
        chunk: result.value,
      })
      controller.enqueue(result.value)
    },
  }))
}
