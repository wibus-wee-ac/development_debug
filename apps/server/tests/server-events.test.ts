// Tests server status SSE lifecycle and event delivery contracts.
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'
import { serverEventBus } from '../src/modules/server-events/service'

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const result = await reader.read()
  expect(result.done).toBe(false)
  return new TextDecoder().decode(result.value)
}

describe('server-events module', () => {
  it('streams published status events and releases subscribers when the client disconnects', async () => {
    const app = await createServerApp({ startBackgroundTasks: false })
    const baselineSubscriberCount = serverEventBus.getSubscriberCount()

    const response = await app.handle(new Request('http://localhost/server/events'))
    const reader = response.body?.getReader()

    try {
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      expect(response.headers.get('cache-control')).toBe('no-cache')
      expect(response.headers.get('x-accel-buffering')).toBe('no')

      expect(reader).toBeDefined()
      if (!reader) {
        return
      }

      expect(await readText(reader)).toBe(': connected\n\n')
      expect(serverEventBus.getSubscriberCount()).toBe(baselineSubscriberCount + 1)

      serverEventBus.publish({
        type: 'source_sync_error',
        data: {
          sourceKey: 'github',
          label: 'GitHub',
          error: 'Rate limit exceeded',
        },
      })

      expect(await readText(reader)).toBe(
        'data: {"type":"source_sync_error","data":{"sourceKey":"github","label":"GitHub","error":"Rate limit exceeded"}}\n\n',
      )

      await reader.cancel()
      expect(serverEventBus.getSubscriberCount()).toBe(baselineSubscriberCount)
    }
    finally {
      await reader?.cancel().catch(() => {})
      shutdownInfra()
    }
  })
})
