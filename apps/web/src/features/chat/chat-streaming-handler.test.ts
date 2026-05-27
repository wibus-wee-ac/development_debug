/**
 * Output: Regression coverage for ChatStreamingHandler stream replay consumption.
 * Input: AI SDK UIMessageChunk streams and hydrated chat store snapshots.
 * Position: Chat feature tests for renderer-owned streaming projection.
 */

import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'

import { useChatStore } from '~/store/chat'

import { ChatStreamingHandler } from './chat-streaming-handler'

function resetChatStore(): void {
  useChatStore.setState(state => ({
    ...state,
    messagesMap: new Map(),
    toolCallIdsByMessageId: new Map(),
    toolEntitiesMap: new Map(),
    generatingMessageIds: new Set(),
    passiveStreamingMessageIds: new Set(),
    activeAbortControllers: new Map(),
    runDisplayMetaMap: new Map(),
    errorMap: new Map(),
    sessionMetaMap: new Map(),
  }))
}

function chunkStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })
}

describe('ChatStreamingHandler', () => {
  beforeEach(() => {
    resetChatStore()
  })

  it('rebuilds passive replay streams from the protocol start instead of appending to the hydrated snapshot', async () => {
    useChatStore.getState().setMessages('session-1', [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'old partial', state: 'streaming' }],
    }])

    const handler = new ChatStreamingHandler('session-1', 'assistant-1', 0, {
      mode: 'passive',
      useStoredMessageSnapshot: false,
    })

    await handler.consume(chunkStream([
      { type: 'start', messageId: 'assistant-1' },
      { type: 'reasoning-start', id: 'thinking-0' },
      { type: 'reasoning-delta', id: 'thinking-0', delta: 'fresh ' },
      { type: 'reasoning-delta', id: 'thinking-0', delta: 'reasoning' },
      { type: 'reasoning-end', id: 'thinking-0' },
      { type: 'finish', finishReason: 'stop' },
    ]))

    expect(useChatStore.getState().messagesMap.get('session-1')).toEqual([{
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'fresh reasoning', state: 'done' }],
    }])
  })

  it('marks a passive session idle after replay stream completion', async () => {
    useChatStore.getState().setMessages('session-1', [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [],
    }])

    const handler = new ChatStreamingHandler('session-1', 'assistant-1', 0, {
      mode: 'passive',
      useStoredMessageSnapshot: false,
    })
    handler.start(new AbortController())
    handler.finish()

    expect(useChatStore.getState().sessionMetaMap.get('session-1')?.passiveStatus).toBe('idle')
    expect(useChatStore.getState().passiveStreamingMessageIds.has('assistant-1')).toBe(false)
  })

  it('keeps a local placeholder streaming when a provider stream omits the start chunk', async () => {
    const controller = new AbortController()
    const handler = new ChatStreamingHandler('session-1', 'assistant-temp', 0)
    handler.start(controller)

    await handler.consume(chunkStream([
      { type: 'reasoning-start', id: 'thinking-1' },
      { type: 'reasoning-delta', id: 'thinking-1', delta: 'working' },
    ]))

    const state = useChatStore.getState()
    expect(state.generatingMessageIds.has('assistant-temp')).toBe(true)
    expect(state.runDisplayMetaMap.get('assistant-temp')?.completedAtMs).toBeNull()
  })

  it('marks a passive session failed when replay stream errors', () => {
    useChatStore.getState().setMessages('session-1', [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [],
    }])

    const handler = new ChatStreamingHandler('session-1', 'assistant-1', 0, {
      mode: 'passive',
      useStoredMessageSnapshot: false,
    })
    handler.start(new AbortController())
    handler.fail('Provider failed')

    expect(useChatStore.getState().sessionMetaMap.get('session-1')?.passiveStatus).toBe('error')
    expect(useChatStore.getState().passiveStreamingMessageIds.has('assistant-1')).toBe(false)
    expect(useChatStore.getState().errorMap.get('assistant-1')?.message).toBe('Provider failed')
  })
})
