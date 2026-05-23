import { Elysia } from 'elysia'

import { serverEventBus } from './service'

export const serverEvents = new Elysia({
  detail: { tags: ['server-events'] },
})
  .get('/server/events', () => {
    const encoder = new TextEncoder()
    let cleanup = () => {}

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let isClosed = false
        let unsubscribe = () => {}

        const closeConnection = () => {
          if (isClosed) {
            return
          }
          isClosed = true
          unsubscribe()
          clearInterval(heartbeat)
        }

        const sendFrame = (frame: string): boolean => {
          if (isClosed) {
            return false
          }

          try {
            controller.enqueue(encoder.encode(frame))
            return true
          }
          catch {
            closeConnection()
            return false
          }
        }

        const heartbeat = setInterval(() => {
          sendFrame(': heartbeat\n\n')
        }, 30_000)

        unsubscribe = serverEventBus.subscribe((event) => {
          sendFrame(`data: ${JSON.stringify(event)}\n\n`)
        })

        cleanup = closeConnection
        sendFrame(': connected\n\n')
      },
      cancel() {
        cleanup()
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      },
    })
  }, {
    detail: {
      summary: 'Server status events stream',
      description: 'SSE endpoint that pushes server status events (source sync errors, daemon failures). Connect with EventSource for real-time notifications.',
    },
  })
