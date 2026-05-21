import { describe, expect, it, vi } from 'vitest'

import {
  bucketSubagentMessagesByParentToolCall,
  derivePassiveChatState,
  projectMainMessagesFromSnapshotRows,
  resolveVisibleChatState,
  stopChatTurn,
} from './use-chat-session'

vi.mock('./sse-chat-transport', () => ({
  buildEventStreamFromResponse: vi.fn(),
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

describe('snapshot row projection', () => {
  it('keeps only main chat messages in the visible session list', () => {
    const rows = [
      {
        messageId: 'user-1',
        role: 'user' as const,
        status: 'complete',
        errorText: null,
        content: 'question',
        message: { id: 'user-1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'question' }] },
        parentMessageId: null,
        parentToolCallId: null,
        taskId: null,
        depth: 0,
      },
      {
        messageId: 'assistant-1',
        role: 'assistant' as const,
        status: 'complete',
        errorText: null,
        content: 'answer',
        message: { id: 'assistant-1', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'answer' }] },
        parentMessageId: null,
        parentToolCallId: null,
        taskId: null,
        depth: 0,
      },
      {
        messageId: 'subagent-1',
        role: 'assistant' as const,
        status: 'complete',
        errorText: null,
        content: 'nested',
        message: { id: 'subagent-1', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'nested' }] },
        parentMessageId: 'assistant-1',
        parentToolCallId: 'tool-1',
        taskId: 'task-1',
        depth: 1,
      },
    ]

    expect(projectMainMessagesFromSnapshotRows(rows).map(message => message.id)).toEqual([
      'user-1',
      'assistant-1',
    ])
  })

  it('buckets subagent snapshots by parent message and parentToolCallId', () => {
    const rows = [
      {
        messageId: 'subagent-1',
        role: 'assistant' as const,
        status: 'complete',
        errorText: null,
        content: 'tool one / first',
        message: { id: 'subagent-1', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'tool one / first' }] },
        parentMessageId: 'assistant-1',
        parentToolCallId: 'tool-1',
        taskId: 'task-1',
        depth: 1,
      },
      {
        messageId: 'subagent-2',
        role: 'assistant' as const,
        status: 'complete',
        errorText: null,
        content: 'tool one / second',
        message: { id: 'subagent-2', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'tool one / second' }] },
        parentMessageId: 'assistant-1',
        parentToolCallId: 'tool-1',
        taskId: 'task-2',
        depth: 1,
      },
      {
        messageId: 'subagent-3',
        role: 'assistant' as const,
        status: 'complete',
        errorText: null,
        content: 'tool two',
        message: { id: 'subagent-3', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'tool two' }] },
        parentMessageId: 'assistant-1',
        parentToolCallId: 'tool-2',
        taskId: 'task-3',
        depth: 1,
      },
    ]

    const buckets = bucketSubagentMessagesByParentToolCall(rows)

    expect(buckets.get('assistant-1')?.get('tool-1')?.map(message => message.id)).toEqual([
      'subagent-1',
      'subagent-2',
    ])
    expect(buckets.get('assistant-1')?.get('tool-2')?.map(message => message.id)).toEqual([
      'subagent-3',
    ])
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
