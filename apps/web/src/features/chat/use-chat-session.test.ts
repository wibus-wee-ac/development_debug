// Input: Vitest assertions plus passive chat snapshot helpers from use-chat-session
// Output: Regression tests for chat reload/reconnect status derivation and visible-state precedence
// Position: Chat feature unit test locking passive snapshot behavior after mid-stream page refresh

import { describe, expect, it, vi } from 'vitest'

import { derivePassiveChatState, resolveVisibleChatState, stopChatTurn } from './use-chat-session'

vi.mock('./sse-chat-transport', () => ({
  buildChunkStreamFromResponse: vi.fn(),
  onChatRunEvent: vi.fn(() => vi.fn()),
}))

describe('derivePassiveChatState', () => {
  it('keeps the chat in streaming state when a persisted draft is still streaming', () => {
    expect(derivePassiveChatState([
      { role: 'user', status: 'complete', errorText: null },
      { role: 'assistant', status: 'streaming', errorText: null },
    ])).toEqual({ status: 'streaming' })
  })

  it('surfaces the latest assistant failure from the persisted snapshot', () => {
    expect(derivePassiveChatState([
      { role: 'user', status: 'complete', errorText: null },
      { role: 'assistant', status: 'failed', errorText: 'Mock LLM forced failure' },
    ])).toEqual({
      status: 'error',
      error: 'Mock LLM forced failure',
    })
  })

  it('falls back to idle when the persisted snapshot is complete', () => {
    expect(derivePassiveChatState([
      { role: 'user', status: 'complete', errorText: null },
      { role: 'assistant', status: 'complete', errorText: null },
    ])).toEqual({ status: 'idle' })
  })
})

describe('resolveVisibleChatState', () => {
  it('prefers the live useChat streaming state over passive snapshots', () => {
    expect(resolveVisibleChatState('streaming', 'idle')).toBe('streaming')
  })

  it('preserves a live useChat error over a stale passive snapshot', () => {
    expect(resolveVisibleChatState('error', 'streaming')).toBe('error')
  })

  it('uses the passive snapshot state when live useChat is idle', () => {
    expect(resolveVisibleChatState('idle', 'streaming')).toBe('streaming')
  })
})

describe('stopChatTurn', () => {
  it('stops the local chat', async () => {
    const chatStop = vi.fn()

    await stopChatTurn({
      chatSessionId: 'chat-session-1',
      chatStop,
    })

    expect(chatStop).toHaveBeenCalledTimes(1)
  })

  it('still stops the local chat when no chat session id is available', async () => {
    const chatStop = vi.fn()

    await stopChatTurn({
      chatSessionId: null,
      chatStop,
    })

    expect(chatStop).toHaveBeenCalledTimes(1)
  })
})
