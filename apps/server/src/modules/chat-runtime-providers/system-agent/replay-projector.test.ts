import { describe, expect, it } from 'vitest'

import type { ChatRuntimeEventRecord } from '../../chat-runtime/events'
import { systemAgentReplayProjector } from './replay-projector'

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

describe('SystemAgentReplayProjector', () => {
  it('projects Cradle history into a text-only prompt', () => {
    const projection = systemAgentReplayProjector.project({
      target: 'normal_turn',
      limits: {},
      events: [
        event(1, 'user_message.appended', {
          messageId: 'user-1',
          payload: { text: 'hello' },
        }),
        event(2, 'tool_call.requested', {
          runId: 'run-1',
          payload: { toolCallId: 'tool-1', apiName: 'github/search', args: { q: 'cradle' } },
        }),
      ],
    })

    expect(projection.output.prompt).toContain('User: hello')
    expect(projection.output.prompt).toContain('Tool summary (github/search): {"q":"cradle"}')
    expect(projection.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'info',
        message: expect.stringContaining('github/search'),
      }),
    ])
  })
})
