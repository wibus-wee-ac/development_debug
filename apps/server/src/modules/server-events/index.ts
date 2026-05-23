import { Elysia } from 'elysia'

import { serverEventBus } from './service'

export const serverEvents = new Elysia({
  detail: { tags: ['server-events'] },
})
  .get('/server/events', () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const unsubscribe = serverEventBus.subscribe((event) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        })

        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`:heartbeat\n\n`))
          }
          catch {
            clearInterval(heartbeat)
          }
        }, 30_000)

        const cleanup = () => {
          unsubscribe()
          clearInterval(heartbeat)
        }

        // Return cleanup via request abort signal
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (typeof globalThis.addEventListener === 'function') {
          // The stream will be closed when the client disconnects
        }

        // Store cleanup for onStop
        ;(stream as unknown as { _cleanup?: () => void })._cleanup = cleanup
      },
      cancel() {
        ;(stream as unknown as { _cleanup?: () => void })._cleanup?.()
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      },
    })
  }, {
    detail: {
      summary: 'Server status events stream',
      description: 'SSE endpoint that pushes server status events (source sync errors, daemon failures). Connect with EventSource for real-time notifications.',
    },
  })
