/**
 * Output: Regression coverage for chat store message normalization and tool entity ownership.
 * Input: Hydrated UI messages that still contain full dynamic-tool payload snapshots.
 * Position: Store-owned tests for browser chat state projection.
 */

import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'

import { chatSelectors, useChatStore } from './chat'

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

describe('chat store tool entity normalization', () => {
  beforeEach(() => {
    resetChatStore()
  })

  it('moves hydrated tool payload out of message.parts and into toolEntitiesMap', () => {
    const message: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'tool-read-1',
          toolName: 'Read',
          state: 'output-available',
          argumentsText: '{"file_path":"/tmp/readme.md"}',
          input: { file_path: '/tmp/readme.md' },
          output: '1\tHello',
        } as unknown as UIMessage['parts'][number],
        {
          type: 'text',
          text: 'Done.',
        },
      ],
    }

    useChatStore.getState().setMessages('session-1', [message])

    const storedMessage = chatSelectors.messages('session-1')(useChatStore.getState())[0]
    const toolEntity = chatSelectors.toolEntity('tool-read-1')(useChatStore.getState())
    const toolIds = chatSelectors.toolCallIds('assistant-1')(useChatStore.getState())

    expect(storedMessage.parts[0]).toEqual({
      type: 'dynamic-tool',
      toolCallId: 'tool-read-1',
      toolName: 'Read',
      state: 'output-available',
    })
    expect(storedMessage.parts[1]).toEqual({
      type: 'text',
      text: 'Done.',
    })

    expect(toolIds).toEqual(['tool-read-1'])
    expect(toolEntity).toEqual({
      messageId: 'assistant-1',
      toolCallId: 'tool-read-1',
      toolName: 'Read',
      state: 'output-available',
      argumentsText: '{"file_path":"/tmp/readme.md"}',
      input: { file_path: '/tmp/readme.md' },
      output: '1\tHello',
      errorText: undefined,
    })
  })

  it('tracks passive streaming only for messages in the hydrated session', () => {
    const message: UIMessage = {
      id: 'assistant-streaming',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Working' }],
    }

    useChatStore.getState().setMessages('session-1', [message])
    useChatStore.getState().setPassiveStreamingMessageIds('session-1', [
      'assistant-streaming',
      'assistant-other-session',
    ])

    const state = useChatStore.getState()
    expect(chatSelectors.isStreamingMessage('assistant-streaming')(state)).toBe(true)
    expect(chatSelectors.isStreamingMessage('assistant-other-session')(state)).toBe(false)
  })

  it('clears passive streaming ids when messages leave the session snapshot', () => {
    const message: UIMessage = {
      id: 'assistant-streaming',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Working' }],
    }

    useChatStore.getState().setMessages('session-1', [message])
    useChatStore.getState().setPassiveStreamingMessageIds('session-1', ['assistant-streaming'])
    useChatStore.getState().setMessages('session-1', [])

    expect(chatSelectors.isStreamingMessage('assistant-streaming')(useChatStore.getState())).toBe(false)
  })
})
