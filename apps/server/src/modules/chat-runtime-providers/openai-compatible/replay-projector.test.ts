import { describe, expect, it } from 'vitest'

import type { ChatRuntimeEventRecord } from '../../chat-runtime/events'
import { openAICompatibleReplayProjector, projectOpenAIToolName } from './replay-projector'

function event(
  seq: number,
  type: ChatRuntimeEventRecord['type'],
  overrides: Partial<ChatRuntimeEventRecord> = {},
): ChatRuntimeEventRecord {
  return {
    id: `event-${seq}`,
    streamId: 'session-replay',
    seq,
    type,
    commandId: null,
    actorKind: null,
    actorId: null,
    runId: null,
    messageId: null,
    queueItemId: null,
    occurredAt: 1700000000 + seq,
    payload: {},
    ...overrides,
  }
}

describe('OpenAICompatibleReplayProjector', () => {
  it('projects text history and does not leak Cradle internal tool names', () => {
    const projection = openAICompatibleReplayProjector.project({
      target: 'normal_turn',
      limits: {},
      events: [
        event(1, 'user_message.appended', {
          messageId: 'user-1',
          payload: { text: 'hello' },
        }),
        event(2, 'assistant_message.snapshot_recorded', {
          messageId: 'assistant-1',
          payload: { text: 'hi' },
        }),
        event(3, 'tool_call.requested', {
          runId: 'run-1',
          payload: { toolCallId: 'tool-1', apiName: 'github/search', args: { q: 'cradle' } },
        }),
        event(4, 'tool_call.result_recorded', {
          runId: 'run-1',
          payload: { toolCallId: 'tool-1', result: { count: 1 } },
        }),
        event(5, 'tool_call.user_input_requested', {
          runId: 'run-1',
          payload: { toolCallId: 'input-1', questions: [] },
        }),
      ],
    })

    expect(projection.output).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'tool', toolName: 'github_search', content: '{"count":1}' },
    ])
    expect(projection.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('tool.request_user_input'),
      }),
    ])
  })

  it('sanitizes OpenAI-compatible tool names', () => {
    expect(projectOpenAIToolName('github/search')).toBe('github_search')
    expect(projectOpenAIToolName('tool.request_user_input')).toBeNull()
    expect(projectOpenAIToolName('x'.repeat(65))).toBeNull()
  })
})
