// Input: Vitest assertions and chat Zustand store
// Output: Regression tests for chat message reference stability
// Position: Renderer store unit test locking snapshot structural sharing behavior

import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'

import { chatSelectors, useChatStore } from './chat'

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      messagesMap: new Map(),
      subagentMessagesMap: new Map(),
      generatingMessageIds: new Set(),
      activeAbortControllers: new Map(),
      errorMap: new Map(),
      sessionMetaMap: new Map(),
    })
  })

  it('keeps the session message array reference for structurally equal snapshots', () => {
    const sessionId = 'session-1'
    const firstMessages: UIMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello' }],
      },
    ]
    const equivalentMessages: UIMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello' }],
      },
    ]

    useChatStore.getState().setMessages(sessionId, firstMessages)
    const storedMessages = chatSelectors.messages(sessionId)(useChatStore.getState())
    const notifications: UIMessage[][] = []
    const unsubscribe = useChatStore.subscribe(
      chatSelectors.messages(sessionId),
      messages => notifications.push(messages),
    )

    useChatStore.getState().setMessages(sessionId, equivalentMessages)
    unsubscribe()

    expect(chatSelectors.messages(sessionId)(useChatStore.getState())).toBe(storedMessages)
    expect(notifications).toEqual([])
  })

  it('preserves unchanged message object references when one snapshot row changes', () => {
    const sessionId = 'session-1'
    const firstMessages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'prompt' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello' }],
      },
    ]
    const nextMessages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'prompt' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello again' }],
      },
    ]

    useChatStore.getState().setMessages(sessionId, firstMessages)
    const storedMessages = chatSelectors.messages(sessionId)(useChatStore.getState())

    useChatStore.getState().setMessages(sessionId, nextMessages)

    const updatedMessages = chatSelectors.messages(sessionId)(useChatStore.getState())
    expect(updatedMessages).not.toBe(storedMessages)
    expect(updatedMessages[0]).toBe(storedMessages[0])
    expect(updatedMessages[1]).not.toBe(storedMessages[1])
  })

  it('keeps subagent messages isolated by parentToolCallId bucket', () => {
    useChatStore.getState().upsertSubagentMessage('assistant-1', 'tool-1', {
      id: 'subagent-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'first tool' }],
    })
    useChatStore.getState().upsertSubagentMessage('assistant-1', 'tool-2', {
      id: 'subagent-2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'second tool' }],
    })
    useChatStore.getState().upsertSubagentMessage('assistant-1', 'tool-1', {
      id: 'subagent-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'first tool updated' }],
    })

    const subagentBuckets = chatSelectors.subagentMessages('assistant-1')(useChatStore.getState())

    expect(subagentBuckets?.get('tool-1')).toEqual([
      {
        id: 'subagent-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'first tool updated' }],
      },
    ])
    expect(subagentBuckets?.get('tool-2')).toEqual([
      {
        id: 'subagent-2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'second tool' }],
      },
    ])
  })
})
