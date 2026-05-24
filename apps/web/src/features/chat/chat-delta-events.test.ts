/**
 * Output: Regression coverage for chat delta event projection in the browser.
 * Input: Sequenced SSE part deltas from the chat runtime.
 * Position: Feature-owned reducer tests for live chat message snapshots.
 */

import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  applyChatPartDeltas,
  collectChatToolEntityPatches,
  type ChatPartDelta,
} from './chat-delta-events'
import type { ChatToolEntity } from './chat-tool-entities'

describe('applyChatPartDeltas', () => {
  it('keeps tool payload in entity patches while message parts retain only anchors', () => {
    const message: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [],
    }
    const deltas: ChatPartDelta[] = [
      {
        seq: 0,
        type: 'part_add',
        partIndex: 0,
        part: {
          type: 'dynamic-tool',
          toolName: 'Edit',
          toolCallId: 'call-edit',
          state: 'input-streaming',
        },
      },
      {
        seq: 1,
        type: 'tool_arguments_append',
        partIndex: 0,
        text: '{"file_path":"/tmp/a.md",',
      },
      {
        seq: 2,
        type: 'tool_arguments_append',
        partIndex: 0,
        text: '"old_string":"hello',
      },
      {
        seq: 3,
        type: 'tool_input_set',
        partIndex: 0,
        input: {
          file_path: '/tmp/a.md',
          old_string: 'hello',
        },
      },
    ]

    const next = applyChatPartDeltas(message, deltas)
    const part = next.parts[0]
    const initialEntity: ChatToolEntity = {
      toolCallId: 'call-edit',
      messageId: 'assistant-1',
      toolName: 'Edit',
      state: 'input-streaming',
    }
    const entity = collectChatToolEntityPatches(next, deltas).reduce<ChatToolEntity>((current, patch) => {
      if (patch.toolCallId !== 'call-edit') {
        return current
      }
      return patch.updater(current)
    }, initialEntity)

    expect(part).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'Edit',
      toolCallId: 'call-edit',
      state: 'input-available',
    })

    expect(entity).toMatchObject({
      toolCallId: 'call-edit',
      messageId: 'assistant-1',
      toolName: 'Edit',
      state: 'input-available',
      argumentsText: '{"file_path":"/tmp/a.md","old_string":"hello',
      input: {
        file_path: '/tmp/a.md',
        old_string: 'hello',
      },
    })
  })
})
