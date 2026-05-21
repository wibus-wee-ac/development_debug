import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatStreamingHandler } from './chat-streaming-handler'

const mockedStore = vi.hoisted(() => {
  const state = {
    messagesMap: new Map<string, Array<{ id: string, role: 'assistant' | 'user', parts: Array<Record<string, unknown>> }>>(),
    subagentMessagesMap: new Map<string, Map<string, Array<{ id: string, role: 'assistant' | 'user', parts: Array<Record<string, unknown>> }>>>(),
    activeAbortControllers: new Map<string, AbortController>(),
  }

  const api = {
    state,
    startGeneration: vi.fn((sessionId: string, messageId: string, controller: AbortController) => {
      api.state.activeAbortControllers.set(messageId, controller)
      const messages = api.state.messagesMap.get(sessionId) ?? []
      if (!messages.some(message => message.id === messageId)) {
        api.state.messagesMap.set(sessionId, [...messages, { id: messageId, role: 'assistant', parts: [] }])
      }
    }),
    finishGeneration: vi.fn((messageId: string) => {
      api.state.activeAbortControllers.delete(messageId)
    }),
    failGeneration: vi.fn(),
    appendMessage: vi.fn((sessionId: string, message: { id: string, role: 'assistant' | 'user', parts: Array<Record<string, unknown>> }) => {
      const messages = api.state.messagesMap.get(sessionId) ?? []
      api.state.messagesMap.set(sessionId, [...messages, message])
    }),
    updateMessage: vi.fn((sessionId: string, messageId: string, updater: (message: { id: string, role: 'assistant' | 'user', parts: Array<Record<string, unknown>> }) => { id: string, role: 'assistant' | 'user', parts: Array<Record<string, unknown>> }) => {
      const messages = api.state.messagesMap.get(sessionId) ?? []
      api.state.messagesMap.set(
        sessionId,
        messages.map(message => message.id === messageId ? updater(message) : message),
      )
    }),
    upsertSubagentMessage: vi.fn((parentMessageId: string, parentToolCallId: string, message: { id: string, role: 'assistant' | 'user', parts: Array<Record<string, unknown>> }) => {
      const parentMap = new Map(api.state.subagentMessagesMap.get(parentMessageId) ?? new Map())
      const currentMessages = parentMap.get(parentToolCallId) ?? []
      const existingIndex = currentMessages.findIndex(item => item.id === message.id)
      const nextMessages = existingIndex === -1
        ? [...currentMessages, message]
        : currentMessages.map(item => item.id === message.id ? message : item)
      parentMap.set(parentToolCallId, nextMessages)
      api.state.subagentMessagesMap.set(parentMessageId, parentMap)
    }),
    getState: () => ({
      messagesMap: api.state.messagesMap,
      subagentMessagesMap: api.state.subagentMessagesMap,
      activeAbortControllers: api.state.activeAbortControllers,
      startGeneration: api.startGeneration,
      finishGeneration: api.finishGeneration,
      failGeneration: api.failGeneration,
      appendMessage: api.appendMessage,
      updateMessage: api.updateMessage,
      upsertSubagentMessage: api.upsertSubagentMessage,
    }),
    reset: () => {
      api.state.messagesMap = new Map()
      api.state.subagentMessagesMap = new Map()
      api.state.activeAbortControllers = new Map()
      api.startGeneration.mockClear()
      api.finishGeneration.mockClear()
      api.failGeneration.mockClear()
      api.appendMessage.mockClear()
      api.updateMessage.mockClear()
      api.upsertSubagentMessage.mockClear()
    },
  }

  return api
})

vi.mock('~/store/chat', () => ({
  useChatStore: {
    getState: mockedStore.getState,
  },
}))

describe('chatStreamingHandler', () => {
  beforeEach(() => {
    mockedStore.reset()
  })

  it('sorts and deduplicates seq values within a main message delta stream', () => {
    const handler = new ChatStreamingHandler('session-1', 'assistant-local')

    handler.handleEvent({
      type: 'message_delta',
      data: {
        messageId: 'assistant-server',
        deltas: [
          { seq: 3, type: 'text_append', partIndex: 0, partType: 'text', text: ' world' },
          { seq: 1, type: 'part_add', partIndex: 0, part: { type: 'text', text: 'hello' } },
          { seq: 2, type: 'text_append', partIndex: 0, partType: 'text', text: ',' },
          { seq: 2, type: 'text_append', partIndex: 0, partType: 'text', text: ',' },
        ],
      },
    })

    const messages = mockedStore.state.messagesMap.get('session-1')
    expect(messages).toHaveLength(1)
    expect(messages?.[0]).toEqual({
      id: 'assistant-server',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hello, world' }],
    })
  })

  it('tracks seq deduplication independently for main and subagent streams', () => {
    const handler = new ChatStreamingHandler('session-1', 'assistant-local')

    handler.handleEvent({
      type: 'message_delta',
      data: {
        messageId: 'assistant-server',
        deltas: [
          { seq: 1, type: 'part_add', partIndex: 0, part: { type: 'text', text: 'main' } },
        ],
      },
    })

    handler.handleEvent({
      type: 'subagent_message_delta',
      data: {
        context: {
          messageId: 'subagent-1',
          parentMessageId: 'assistant-server',
          parentToolCallId: 'tool-1',
          taskId: 'task-1',
        },
        deltas: [
          { seq: 1, type: 'part_add', partIndex: 0, part: { type: 'text', text: 'subagent' } },
        ],
      },
    })

    expect(mockedStore.state.messagesMap.get('session-1')).toEqual([
      {
        id: 'assistant-server',
        role: 'assistant',
        parts: [{ type: 'text', text: 'main' }],
      },
    ])
    expect(mockedStore.state.subagentMessagesMap.get('assistant-server')?.get('tool-1')).toEqual([
      {
        id: 'subagent-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'subagent' }],
      },
    ])
  })

  it('accumulates streaming tool input deltas before tool input is complete', () => {
    const handler = new ChatStreamingHandler('session-1', 'assistant-local')

    handler.handleEvent({
      type: 'message_delta',
      data: {
        messageId: 'assistant-server',
        deltas: [
          {
            seq: 1,
            type: 'part_add',
            partIndex: 0,
            part: {
              type: 'dynamic-tool',
              toolName: 'Edit File',
              toolCallId: 'tool-edit',
              state: 'input-streaming',
              input: undefined,
            },
          },
          {
            seq: 2,
            type: 'tool_input_append',
            partIndex: 0,
            inputKey: 'input',
            text: '{"file_path":"/repo/src/app.tsx","old_string":"old',
          },
          {
            seq: 3,
            type: 'tool_input_append',
            partIndex: 0,
            inputKey: 'input',
            text: '","new_string":"new',
          },
        ],
      },
    })

    expect(mockedStore.state.messagesMap.get('session-1')).toEqual([
      {
        id: 'assistant-server',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'Edit File',
            toolCallId: 'tool-edit',
            state: 'input-streaming',
            input: {
              input: '{"file_path":"/repo/src/app.tsx","old_string":"old","new_string":"new',
            },
          },
        ],
      },
    ])
  })
})
