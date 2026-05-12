// Input: Vitest assertions plus passive chat snapshot helpers from use-chat-session
// Output: Regression tests for chat reload/reconnect status derivation and visible-state precedence
// Position: Chat feature unit test locking passive snapshot behavior after mid-stream page refresh

import { describe, expect, it, vi } from 'vitest'

import { derivePassiveChatState, resolveVisibleChatState, stopChatTurn } from './use-chat-session'

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    status: 'ready',
    error: undefined,
    messages: [],
    setMessages: vi.fn(),
    sendMessage: vi.fn(),
    stop: vi.fn(),
  }),
}))

vi.mock('@renderer/lib/ipc', () => ({ ipc: undefined }))
vi.mock('./ipc-chat-transport', () => ({ createIpcChatTransport: vi.fn() }))
vi.mock('./use-chat-events', () => ({ useChatTimelineEvent: vi.fn() }))

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
  it('always stops the local chat and forwards aborts to main IPC when a session is active', async () => {
    const chatStop = vi.fn()
    const ipcAbort = vi.fn().mockResolvedValue(undefined)

    await stopChatTurn({
      chatSessionId: 'chat-session-1',
      chatStop,
      ipcAbort,
    })

    expect(chatStop).toHaveBeenCalledTimes(1)
    expect(ipcAbort).toHaveBeenCalledWith('chat-session-1')
  })

  it('still stops the local chat when no chat session id is available', async () => {
    const chatStop = vi.fn()
    const ipcAbort = vi.fn()

    await stopChatTurn({
      chatSessionId: null,
      chatStop,
      ipcAbort,
    })

    expect(chatStop).toHaveBeenCalledTimes(1)
    expect(ipcAbort).not.toHaveBeenCalled()
  })
})
