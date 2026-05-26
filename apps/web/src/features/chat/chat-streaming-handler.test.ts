/**
 * Output: Regression coverage for event-driven tool entity streaming in the chat SSE handler.
 * Input: Ordered message_delta events containing early tool anchors and later tool payload/result patches.
 * Position: Feature-owned tests for the SSE-to-store projection layer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { chatSelectors, useChatStore } from '~/store/chat'

import type { ChatStreamEvent } from './chat-delta-events'
import { ChatStreamingHandler } from './chat-streaming-handler'

function resetChatStore(): void {
  useChatStore.setState(state => ({
    ...state,
    messagesMap: new Map(),
    toolCallIdsByMessageId: new Map(),
    toolEntitiesMap: new Map(),
    subagentMessagesMap: new Map(),
    generatingMessageIds: new Set(),
    passiveStreamingMessageIds: new Set(),
    activeAbortControllers: new Map(),
    runDisplayMetaMap: new Map(),
    errorMap: new Map(),
    sessionMetaMap: new Map(),
  }))
}

async function flushToolEntityPatches(): Promise<void> {
  await new Promise(resolve => requestAnimationFrame(resolve))
}

describe('chat streaming handler tool entity projection', () => {
  beforeEach(() => {
    resetChatStore()
    vi.useRealTimers()
  })

  it('creates a tool entity on part_add and patches it before final output arrives', async () => {
    const handler = new ChatStreamingHandler('session-1', 'local-assistant-1')
    handler.start(new AbortController())

    const partAddEvent: ChatStreamEvent = {
      type: 'message_delta',
      data: {
        messageId: 'assistant-1',
        deltas: [
          {
            seq: 1,
            type: 'part_add',
            partIndex: 0,
            part: {
              type: 'dynamic-tool',
              toolName: 'Write',
              toolCallId: 'tool-write-1',
              state: 'input-streaming',
            },
          },
        ],
      },
    }

    handler.handleEvent(partAddEvent)
    await flushToolEntityPatches()

    const stateAfterPartAdd = useChatStore.getState()
    expect(chatSelectors.toolCallIds('assistant-1')(stateAfterPartAdd)).toEqual(['tool-write-1'])
    expect(chatSelectors.toolEntity('tool-write-1')(stateAfterPartAdd)).toEqual({
      messageId: 'assistant-1',
      toolCallId: 'tool-write-1',
      toolName: 'Write',
      state: 'input-streaming',
    })
    expect(chatSelectors.message('session-1', 'assistant-1')(stateAfterPartAdd)?.parts[0]).toEqual({
      type: 'dynamic-tool',
      toolCallId: 'tool-write-1',
      toolName: 'Write',
      state: 'input-streaming',
    })

    const argumentsEvent: ChatStreamEvent = {
      type: 'message_delta',
      data: {
        messageId: 'assistant-1',
        deltas: [
          {
            seq: 2,
            type: 'tool_arguments_append',
            partIndex: 0,
            text: '{"file_path":"/tmp/story.html","content":"<html>',
          },
        ],
      },
    }

    handler.handleEvent(argumentsEvent)
    await flushToolEntityPatches()

    const stateAfterArguments = useChatStore.getState()
    expect(chatSelectors.toolEntity('tool-write-1')(stateAfterArguments)).toMatchObject({
      messageId: 'assistant-1',
      toolCallId: 'tool-write-1',
      toolName: 'Write',
      state: 'input-streaming',
      argumentsText: '{"file_path":"/tmp/story.html","content":"<html>',
    })

    const outputEvent: ChatStreamEvent = {
      type: 'message_delta',
      data: {
        messageId: 'assistant-1',
        deltas: [
          {
            seq: 3,
            type: 'tool_output_set',
            partIndex: 0,
            state: 'output-available',
            output: 'Wrote 128 bytes.',
          },
        ],
      },
    }

    handler.handleEvent(outputEvent)
    await flushToolEntityPatches()

    const stateAfterOutput = useChatStore.getState()
    expect(chatSelectors.toolEntity('tool-write-1')(stateAfterOutput)).toMatchObject({
      messageId: 'assistant-1',
      toolCallId: 'tool-write-1',
      toolName: 'Write',
      state: 'output-available',
      argumentsText: '{"file_path":"/tmp/story.html","content":"<html>',
      output: 'Wrote 128 bytes.',
    })
    expect(chatSelectors.message('session-1', 'assistant-1')(stateAfterOutput)?.parts[0]).toEqual({
      type: 'dynamic-tool',
      toolCallId: 'tool-write-1',
      toolName: 'Write',
      state: 'output-available',
    })
  })

  it('moves run display metadata to the server assistant message and records TTFT', () => {
    const handler = new ChatStreamingHandler('session-1', 'local-assistant-1', 100)
    handler.start(new AbortController())
    useChatStore.getState().setRunDisplayId('local-assistant-1', 'run-1')

    handler.handleEvent({
      type: 'message_delta',
      data: {
        messageId: 'assistant-1',
        deltas: [
          {
            seq: 1,
            type: 'part_add',
            partIndex: 0,
            part: { type: 'text', text: '' },
          },
          {
            seq: 2,
            type: 'text_append',
            partIndex: 0,
            partType: 'text',
            text: 'Hello',
          },
        ],
      },
    })

    const state = useChatStore.getState()
    const localMeta = chatSelectors.runDisplayMeta('local-assistant-1')(state)
    const serverMeta = chatSelectors.runDisplayMeta('assistant-1')(state)

    expect(localMeta).toBeUndefined()
    expect(serverMeta?.runId).toBe('run-1')
    expect(serverMeta?.requestStartedAtMs).toBe(100)
    expect(serverMeta?.firstEventAtMs).toEqual(expect.any(Number))
    expect(serverMeta?.firstContentAtMs).toEqual(expect.any(Number))
  })
})
