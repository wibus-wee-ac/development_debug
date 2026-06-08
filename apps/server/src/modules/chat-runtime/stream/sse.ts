import type { UIMessageChunk } from 'ai'

import { isTerminalUIMessageChunk, mergeBufferedStreamChunk } from '../run/stream-chunks'

export type ChunkSubscriber = (chunk: UIMessageChunk, terminal: boolean) => void

export interface BufferedChunkStreamInput {
  replayChunks: UIMessageChunk[]
  terminal?: boolean
  shouldCloseWithoutSubscriber?: boolean
  coalesceMaxChars: number
  subscribe(subscriber: ChunkSubscriber): () => void
}

export function openBufferedChunkStream(input: BufferedChunkStreamInput): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  let queuedChunk: UIMessageChunk | null = null
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  const clearQueuedFlush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    queuedChunk = null
  }

  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      const clearFlushTimer = () => {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
      }

      const closeStream = (flushQueued: boolean) => {
        if (closed) {
          return
        }
        if (flushQueued) {
          clearFlushTimer()
          flushQueuedChunk()
        }
        closed = true
        clearQueuedFlush()
        unsubscribe()
        controller.close()
      }

      const writeEncodedChunk = (chunk: UIMessageChunk, terminal: boolean) => {
        if (closed) {
          return
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        if (terminal) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          closeStream(false)
        }
      }

      const flushQueuedChunk = () => {
        flushTimer = null
        const chunk = queuedChunk
        queuedChunk = null
        if (chunk) {
          writeEncodedChunk(chunk, false)
        }
      }

      const scheduleFlush = () => {
        flushTimer ??= setTimeout(flushQueuedChunk, 0)
      }

      const writeChunk = (chunk: UIMessageChunk, terminal: boolean) => {
        if (closed) {
          return
        }
        if (terminal) {
          clearFlushTimer()
          flushQueuedChunk()
          writeEncodedChunk(chunk, true)
          return
        }
        if (!queuedChunk) {
          queuedChunk = chunk
          scheduleFlush()
          return
        }
        const merged = mergeBufferedStreamChunk(queuedChunk, chunk, input.coalesceMaxChars)
        if (merged) {
          queuedChunk = merged
          scheduleFlush()
          return
        }
        flushQueuedChunk()
        queuedChunk = chunk
        scheduleFlush()
      }

      for (const chunk of input.replayChunks) {
        const terminal = isTerminalUIMessageChunk(chunk)
        writeChunk(chunk, terminal)
        if (terminal) {
          return
        }
      }

      if (input.terminal || input.shouldCloseWithoutSubscriber) {
        closeStream(true)
        return
      }

      unsubscribe = input.subscribe((chunk, terminal) => writeChunk(chunk, terminal))
    },
    cancel: () => {
      closed = true
      clearQueuedFlush()
      unsubscribe()
    }
  })
}
