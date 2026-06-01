/**
 * Output: Regression coverage for chat stream transport selection.
 * Input: Mocked Electron chat stream bridge events and HTTP SSE responses.
 * Position: Chat feature tests for runtime-specific stream transport.
 */

import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  DesktopChatStreamBridge,
  DesktopChatStreamChunkEvent,
  DesktopChatStreamClosedEvent,
  DesktopChatStreamErrorEvent,
} from '~/lib/electron'

type Handler<T> = (event: T) => void

function writeWindowCradle(value: Window['cradle'] | undefined): void {
  Object.defineProperty(window, 'cradle', {
    configurable: true,
    writable: true,
    value,
  })
}

async function readChunks(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const reader = stream.getReader()
  const chunks: UIMessageChunk[] = []
  while (true) {
    const result = await reader.read()
    if (result.done) {
      return chunks
    }
    chunks.push(result.value)
  }
}

function createBridge(): {
  bridge: DesktopChatStreamBridge
  chunkHandlers: Array<Handler<DesktopChatStreamChunkEvent>>
  closedHandlers: Array<Handler<DesktopChatStreamClosedEvent>>
  errorHandlers: Array<Handler<DesktopChatStreamErrorEvent>>
  abort: ReturnType<typeof vi.fn>
} {
  const chunkHandlers: Array<Handler<DesktopChatStreamChunkEvent>> = []
  const closedHandlers: Array<Handler<DesktopChatStreamClosedEvent>> = []
  const errorHandlers: Array<Handler<DesktopChatStreamErrorEvent>> = []
  const abort = vi.fn(async () => {})
  const bridge: DesktopChatStreamBridge = {
    startResponse: vi.fn(async request => ({
      streamId: 'stream-1',
      sessionId: request.sessionId,
      runId: 'run-1',
      assistantMessageId: 'assistant-1',
      userMessageId: 'user-1',
    })),
    subscribeSession: vi.fn(async request => ({
      streamId: 'stream-2',
      sessionId: request.sessionId,
      runId: 'run-2',
    })),
    abort,
    diagnostics: vi.fn(async () => ({ streams: [] })),
    onChunk: (handler) => {
      chunkHandlers.push(handler)
      return () => {}
    },
    onClosed: (handler) => {
      closedHandlers.push(handler)
      return () => {}
    },
    onError: (handler) => {
      errorHandlers.push(handler)
      return () => {}
    },
  }
  return { bridge, chunkHandlers, closedHandlers, errorHandlers, abort }
}

describe('chat stream transport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    writeWindowCradle(undefined)
  })

  it('builds a renderer stream from Electron chat stream events', async () => {
    const { bridge, chunkHandlers, closedHandlers } = createBridge()
    writeWindowCradle({
      ipc: {
        invoke: vi.fn(),
        on: vi.fn(),
      },
      env: {
        serverUrl: 'http://127.0.0.1:21423',
        sessionId: null,
        isTearoff: false,
        surface: null,
        platform: 'darwin',
        isElectron: true,
      },
      window: {
        minimize: vi.fn(),
        maximize: vi.fn(),
        close: vi.fn(),
        startPointerMonitor: vi.fn(),
        stopPointerMonitor: vi.fn(),
        onTearoffSessionClosed: vi.fn(),
        onPointerOutsideWindow: vi.fn(),
      },
      desktopUpdate: {
        onStatusChanged: vi.fn(),
      },
      chatStream: bridge,
      desktopTray: {
        performAction: vi.fn(),
        consumePendingActionRequests: vi.fn(),
        onActionRequested: vi.fn(),
      },
    })
    const { startChatResponseStream } = await import('./chat-stream-transport')

    const result = await startChatResponseStream({
      sessionId: 'session-1',
      body: { text: 'hello' },
    })
    const chunksPromise = readChunks(result.stream)

    chunkHandlers.forEach(handler => handler({
      streamId: 'stream-1',
      sessionId: 'session-1',
      runId: 'run-1',
      chunk: { type: 'start', messageId: 'assistant-1' },
    }))
    closedHandlers.forEach(handler => handler({
      streamId: 'stream-1',
      sessionId: 'session-1',
      runId: 'run-1',
      reason: 'done',
    }))

    await expect(chunksPromise).resolves.toEqual([
      { type: 'start', messageId: 'assistant-1' },
    ])
    expect(result).toMatchObject({
      streamId: 'stream-1',
      sessionId: 'session-1',
      runId: 'run-1',
      assistantMessageId: 'assistant-1',
      userMessageId: 'user-1',
    })
  })

  it('errors the renderer stream when Electron reports a stream failure', async () => {
    const { bridge, errorHandlers } = createBridge()
    writeWindowCradle({
      ipc: { invoke: vi.fn(), on: vi.fn() },
      env: {
        serverUrl: 'http://127.0.0.1:21423',
        sessionId: null,
        isTearoff: false,
        surface: null,
        platform: 'darwin',
        isElectron: true,
      },
      window: {
        minimize: vi.fn(),
        maximize: vi.fn(),
        close: vi.fn(),
        startPointerMonitor: vi.fn(),
        stopPointerMonitor: vi.fn(),
        onTearoffSessionClosed: vi.fn(),
        onPointerOutsideWindow: vi.fn(),
      },
      desktopUpdate: { onStatusChanged: vi.fn() },
      chatStream: bridge,
      desktopTray: {
        performAction: vi.fn(),
        consumePendingActionRequests: vi.fn(),
        onActionRequested: vi.fn(),
      },
    })
    const { startChatResponseStream } = await import('./chat-stream-transport')

    const result = await startChatResponseStream({
      sessionId: 'session-1',
      body: { text: 'hello' },
    })
    const chunksPromise = readChunks(result.stream)

    errorHandlers.forEach(handler => handler({
      streamId: 'stream-1',
      sessionId: 'session-1',
      runId: 'run-1',
      message: 'upstream failed',
    }))

    await expect(chunksPromise).rejects.toThrow('upstream failed')
  })

  it('falls back to HTTP SSE when the desktop bridge is absent', async () => {
    writeWindowCradle(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"start","messageId":"assistant-http"}\n\n'))
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
        },
      }),
      {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'x-cradle-run-id': 'run-http',
        },
      },
    )))
    const { startChatResponseStream } = await import('./chat-stream-transport')

    const result = await startChatResponseStream({
      sessionId: 'session-http',
      body: { text: 'hello' },
    })

    await expect(readChunks(result.stream)).resolves.toEqual([
      { type: 'start', messageId: 'assistant-http' },
    ])
    expect(result.runId).toBe('run-http')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
