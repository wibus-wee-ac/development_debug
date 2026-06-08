import type { UIMessageChunk } from 'ai'

import { serializeChatError } from '../run/errors'
import { isTerminalUIMessageChunk } from '../run/stream-chunks'

export function openDirectChunkStream(
  chunks: AsyncIterable<UIMessageChunk>
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let terminalPublished = false
      const publish = (chunk: UIMessageChunk, terminal = isTerminalUIMessageChunk(chunk)) => {
        if (terminalPublished) {
          return
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        if (terminal) {
          terminalPublished = true
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        }
      }

      try {
        for await (const chunk of chunks) {
          publish(chunk)
        }
        if (!terminalPublished) {
          publish({ type: 'finish', finishReason: 'stop' }, true)
        }
      } catch (error) {
        publish({ type: 'error', errorText: serializeChatError(error).text }, true)
      } finally {
        controller.close()
      }
    }
  })
}
