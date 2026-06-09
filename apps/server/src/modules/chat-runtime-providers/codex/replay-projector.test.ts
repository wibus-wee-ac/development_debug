import { describe, expect, it } from 'vitest'

import type { ChatRuntimeEventRecord } from '../../chat-runtime/events'
import { codexReplayProjector } from './replay-projector'

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

describe('CodexReplayProjector', () => {
  it('projects messages and tool calls as Codex response items', () => {
    const projection = codexReplayProjector.project({
      target: 'resume_session',
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
        event(3, 'tool_call.result_recorded', {
          runId: 'run-1',
          payload: { toolCallId: 'tool-1', result: { count: 1 } },
        }),
        event(4, 'assistant_message.snapshot_recorded', {
          messageId: 'assistant-1',
          payload: { text: 'done' },
        }),
        event(5, 'tool_call.requested', {
          runId: 'run-1',
          payload: { toolCallId: 'cmd-1', apiName: 'command_execution', args: { command: 'ls' } },
        }),
        event(6, 'tool_call.result_recorded', {
          runId: 'run-1',
          payload: { toolCallId: 'cmd-1', result: { output: 'ok' } },
        }),
      ],
    })

    expect(projection.output).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message',
        role: 'user',
      }),
      expect.objectContaining({
        type: 'function_call',
        name: 'github/search',
        call_id: 'tool-1',
      }),
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'tool-1',
        output: '{"count":1}',
      }),
      expect.objectContaining({
        type: 'function_call',
        name: 'command_execution',
        call_id: 'cmd-1',
      }),
    ]))
  })

  it('projects MCP elicitation as Codex replay tool history', () => {
    const projection = codexReplayProjector.project({
      target: 'resume_session',
      limits: {},
      events: [
        event(1, 'tool_call.requested', {
          runId: 'run-1',
          payload: {
            toolCallId: 'mcp-1',
            apiName: 'mcp.elicitation',
            args: { server: 'github', request: 'Pick repository' },
          },
        }),
        event(2, 'tool_call.result_recorded', {
          runId: 'run-1',
          payload: {
            toolCallId: 'mcp-1',
            result: { repository: 'wibus/Cradle' },
          },
        }),
      ],
    })

    expect(projection.output).toEqual([
      expect.objectContaining({
        type: 'function_call',
        name: 'mcp.elicitation',
        call_id: 'mcp-1',
      }),
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'mcp-1',
        output: '{"repository":"wibus/Cradle"}',
      }),
    ])
  })
})
