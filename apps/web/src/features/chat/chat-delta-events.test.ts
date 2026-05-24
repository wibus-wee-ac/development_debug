/**
 * Output: Regression coverage for chat delta event projection in the browser.
 * Input: Sequenced SSE part deltas from the chat runtime.
 * Position: Feature-owned reducer tests for live chat message snapshots.
 */

import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { applyChatPartDeltas, type ChatPartDelta } from './chat-delta-events'

describe('applyChatPartDeltas', () => {
  it('streams tool arguments separately from committed structured input', () => {
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
          argumentsText: '',
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

    expect(part).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'Edit',
      toolCallId: 'call-edit',
      state: 'input-available',
      argumentsText: '{"file_path":"/tmp/a.md","old_string":"hello',
      input: {
        file_path: '/tmp/a.md',
        old_string: 'hello',
      },
    })
  })
})
