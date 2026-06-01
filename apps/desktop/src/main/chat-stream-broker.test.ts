/**
 * Output: Regression coverage for desktop-owned chat stream fanout.
 * Input: Fake WebContents subscribers and controlled server SSE responses.
 * Position: Desktop main-process tests for ChatStreamBroker lifecycle semantics.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  ChatStreamBroker,
  DESKTOP_CHAT_STREAM_CHUNK_CHANNEL,
  DESKTOP_CHAT_STREAM_CLOSED_CHANNEL,
} from './chat-stream-broker'

type Listener = () => void

class FakeWebContents {
  readonly send = vi.fn()
  private readonly listeners = new Map<string, Listener[]>()
  private destroyed = false

  isDestroyed(): boolean {
    return this.destroyed
  }

  once(eventName: string, listener: Listener): void {
    const listeners = this.listeners.get(eventName) ?? []
    listeners.push(listener)
    this.listeners.set(eventName, listeners)
  }

  destroy(): void {
    this.destroyed = true
    for (const listener of this.listeners.get('destroyed') ?? []) {
      listener()
    }
  }
}

interface ControlledSseResponse {
  controller: ReadableStreamDefaultController<Uint8Array>
  response: Response
}

function createControlledSseResponse(headers: Record<string, string> = {}): ControlledSseResponse {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController
    },
  })
  return {
    controller: controller!,
    response: new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        ...headers,
      },
    }),
  }
}

function createImmediateSseResponse(frames: unknown[], headers: Record<string, string> = {}): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encodeSse(frame))
      }
    },
  }), {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      ...headers,
    },
  })
}

function encodeSse(value: unknown): Uint8Array {
  const text = value === '[DONE]'
    ? 'data: [DONE]\n\n'
    : `data: ${JSON.stringify(value)}\n\n`
  return new TextEncoder().encode(text)
}

function readChannelPayloads(webContents: FakeWebContents, channel: string): unknown[] {
  return webContents.send.mock.calls
    .filter(call => call[0] === channel)
    .map(call => call[1])
}

describe('ChatStreamBroker', () => {
  it('shares one upstream response stream across multiple renderer subscribers', async () => {
    const controlled = createControlledSseResponse({
      'x-cradle-run-id': 'run-1',
      'x-cradle-assistant-message-id': 'assistant-1',
      'x-cradle-user-message-id': 'user-1',
    })
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const second = new FakeWebContents()

    const firstHandle = await broker.startResponse(first as never, {
      sessionId: 'session-1',
      body: { text: 'hello' },
    })
    const secondHandle = await broker.subscribeSession(second as never, {
      sessionId: 'session-1',
    })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(firstHandle.runId).toBe('run-1')
    expect(secondHandle.runId).toBe('run-1')
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-1',
        mode: 'response',
        runId: 'run-1',
        subscriberCount: 2,
      },
    ])

    controlled.controller.enqueue(encodeSse({ type: 'start', messageId: 'assistant-1' }))
    controlled.controller.enqueue(encodeSse({ type: 'text-start', id: 'text-1' }))
    controlled.controller.enqueue(encodeSse('[DONE]'))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(2)
      expect(readChannelPayloads(second, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(2)
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CLOSED_CHANNEL)).toHaveLength(1)
      expect(readChannelPayloads(second, DESKTOP_CHAT_STREAM_CLOSED_CHANNEL)).toHaveLength(1)
      expect(broker.diagnostics().streams).toHaveLength(0)
    })
  })

  it('keeps a passive upstream alive while one subscriber remains and aborts it after the final subscriber leaves', async () => {
    const controlled = createControlledSseResponse({ 'x-cradle-run-id': 'run-2' })
    let upstreamSignal: AbortSignal | null = null
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamSignal = init?.signal ?? null
      return controlled.response
    })
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const second = new FakeWebContents()

    const firstHandle = await broker.subscribeSession(first as never, { sessionId: 'session-2' })
    const secondHandle = await broker.subscribeSession(second as never, { sessionId: 'session-2' })

    broker.abortStream(first as never, { streamId: firstHandle.streamId })
    controlled.controller.enqueue(encodeSse({ type: 'text-start', id: 'text-2' }))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(0)
      expect(readChannelPayloads(second, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(1)
      expect((upstreamSignal as AbortSignal | null)?.aborted).toBe(false)
    })

    broker.abortStream(second as never, { streamId: secondHandle.streamId })

    expect((upstreamSignal as AbortSignal | null)?.aborted).toBe(true)
    expect(broker.diagnostics().streams).toHaveLength(0)
  })

  it('replays buffered chunks to a late subscriber before forwarding live chunks', async () => {
    const controlled = createControlledSseResponse({ 'x-cradle-run-id': 'run-replay' })
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const late = new FakeWebContents()

    await broker.startResponse(first as never, {
      sessionId: 'session-replay',
      body: { text: 'hello' },
    })
    controlled.controller.enqueue(encodeSse({ type: 'start', messageId: 'assistant-replay' }))
    controlled.controller.enqueue(encodeSse({ type: 'text-start', id: 'text-replay' }))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(2)
    })

    const lateHandle = await broker.subscribeSession(late as never, {
      sessionId: 'session-replay',
    })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(lateHandle.runId).toBe('run-replay')
    expect(readChannelPayloads(late, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toMatchObject([
      { chunk: { type: 'start', messageId: 'assistant-replay' } },
      { chunk: { type: 'text-start', id: 'text-replay' } },
    ])
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-replay',
        subscriberCount: 2,
        replayChunkCount: 2,
      },
    ])

    controlled.controller.enqueue(encodeSse({ type: 'text-delta', id: 'text-replay', delta: ' world' }))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(3)
      expect(readChannelPayloads(late, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(3)
    })
  })

  it('does not replay duplicate chunks to an early subscriber when upstream data arrives before the handle resolves', async () => {
    const fetchFn = vi.fn(async () => createImmediateSseResponse([
      { type: 'start', messageId: 'assistant-fast' },
      { type: 'text-start', id: 'text-fast' },
    ], { 'x-cradle-run-id': 'run-fast' }))
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const subscriber = new FakeWebContents()

    await broker.startResponse(subscriber as never, {
      sessionId: 'session-fast',
      body: { text: 'hello' },
    })

    await vi.waitFor(() => {
      expect(readChannelPayloads(subscriber, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(2)
    })
    expect(readChannelPayloads(subscriber, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toMatchObject([
      { chunk: { type: 'start', messageId: 'assistant-fast' } },
      { chunk: { type: 'text-start', id: 'text-fast' } },
    ])
  })

  it('retains a response upstream after the sending renderer unsubscribes', async () => {
    const controlled = createControlledSseResponse({ 'x-cradle-run-id': 'run-3' })
    let upstreamSignal: AbortSignal | null = null
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamSignal = init?.signal ?? null
      return controlled.response
    })
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const sender = new FakeWebContents()

    const handle = await broker.startResponse(sender as never, {
      sessionId: 'session-3',
      body: { text: 'hello' },
    })

    broker.abortStream(sender as never, { streamId: handle.streamId })

    expect((upstreamSignal as AbortSignal | null)?.aborted).toBe(false)
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-3',
        mode: 'response',
        subscriberCount: 0,
        keepAliveWithoutSubscribers: true,
      },
    ])

    controlled.controller.enqueue(encodeSse('[DONE]'))

    await vi.waitFor(() => {
      expect(broker.diagnostics().streams).toHaveLength(0)
    })
  })

  it('does not reuse an idle passive session entry for a response request', async () => {
    const passiveResponse = createControlledSseResponse({ 'x-cradle-run-id': 'run-passive' })
    const responseStream = createControlledSseResponse({ 'x-cradle-run-id': 'run-response' })
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(passiveResponse.response)
      .mockResolvedValueOnce(responseStream.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const passiveWindow = new FakeWebContents()
    const senderWindow = new FakeWebContents()

    await broker.subscribeSession(passiveWindow as never, { sessionId: 'session-4' })
    const responseHandle = await broker.startResponse(senderWindow as never, {
      sessionId: 'session-4',
      body: { text: 'new turn' },
    })

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(responseHandle.runId).toBe('run-response')
    expect(readChannelPayloads(passiveWindow, DESKTOP_CHAT_STREAM_CLOSED_CHANNEL)).toMatchObject([
      { reason: 'aborted' },
    ])
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-4',
        mode: 'response',
        runId: 'run-response',
        subscriberCount: 1,
      },
    ])

    responseStream.controller.enqueue(encodeSse('[DONE]'))

    await vi.waitFor(() => {
      expect(broker.diagnostics().streams).toHaveLength(0)
    })
  })
})
