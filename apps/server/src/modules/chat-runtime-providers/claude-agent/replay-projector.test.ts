import { describe, expect, it } from 'vitest'

import type { ChatRuntimeEventRecord } from '../../chat-runtime/events'
import { claudeAgentReplayProjector } from './replay-projector'

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

describe('ClaudeAgentReplayProjector', () => {
  it('projects Cradle history as text and summarizes tool calls', () => {
    const projection = claudeAgentReplayProjector.project({
      target: 'resume_session',
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
      ],
    })

    expect(projection.output.text).toContain('User: hello')
    expect(projection.output.text).toContain('Assistant: hi')
    expect(projection.output.text).toContain('Tool summary (github/search): {"count":1}')
    expect(projection.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'info',
        message: expect.stringContaining('github/search'),
      }),
    ])
  })
})
