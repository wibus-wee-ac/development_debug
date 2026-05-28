// Output: Regression coverage for Claude Agent message-to-AI-SDK chunk mapping.
// Input: Claude Agent SDK tool_use and tool_result messages.
// Position: Provider-owned adapter tests for persisted tool output semantics.

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { createClaudeAgentChunkMapperState, mapClaudeAgentMessageToChunks } from './mapper'

describe('mapClaudeAgentMessageToChunks', () => {
  it('synthesizes TodoWrite plugin state when the matching tool result arrives', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')

    await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-1',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_todo_1',
            name: 'TodoWrite',
            input: {
              todos: [
                { id: 'todo-1', content: 'Inspect', status: 'pending' },
                { id: 'todo-2', content: 'Patch', activeForm: 'Patching', status: 'in_progress' },
                { id: 'todo-3', content: 'Verify', status: 'completed' },
              ],
            },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    const result = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'claude-session-1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_todo_1',
            content: { ok: true },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(result.chunks).toEqual([
      {
        type: 'tool-output-available',
        toolCallId: 'toolu_todo_1',
        output: {
          ok: true,
          pluginState: {
            todos: [
              { id: 'todo-1', content: 'Inspect', status: 'todo', sourceStatus: 'pending' },
              { id: 'todo-2', content: 'Patching', status: 'processing', sourceStatus: 'in_progress' },
              { id: 'todo-3', content: 'Verify', status: 'completed', sourceStatus: 'completed' },
            ],
          },
        },
      },
    ])
  })
})
