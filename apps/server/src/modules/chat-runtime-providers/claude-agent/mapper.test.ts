import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessage } from 'ai'
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
          type: 'cradle.builtin-tool-call.result.v1',
          identifier: 'claude-code',
          apiName: 'TodoWrite',
          args: {
            todos: [
              { id: 'todo-1', content: 'Inspect', status: 'pending' },
              { id: 'todo-2', content: 'Patch', activeForm: 'Patching', status: 'in_progress' },
              { id: 'todo-3', content: 'Verify', status: 'completed' },
            ],
          },
          result: {
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
      },
    ])
  })

  it('throttles preliminary subagent snapshots while keeping the terminal output complete', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const emittedPreliminaryOutputs: unknown[] = []

    for (let index = 0; index < 256; index += 1) {
      const result = await mapClaudeAgentMessageToChunks({
        type: 'stream_event',
        session_id: 'claude-session-1',
        parent_tool_use_id: 'toolu_parent_1',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: `${index} ` },
        },
      } as unknown as SDKMessage, state)

      emittedPreliminaryOutputs.push(
        ...result.chunks.filter(chunk => chunk.type === 'tool-output-available'),
      )
    }

    expect(emittedPreliminaryOutputs.length).toBeLessThan(80)

    const result = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'claude-session-1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_parent_1',
            content: { ok: true },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    const output = result.chunks.find(chunk => chunk.type === 'tool-output-available') as
      | { type: 'tool-output-available', output: { message?: UIMessage } }
      | undefined
    const text = output?.output.message?.parts
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('')

    expect(text).toContain('255')
  })

  it('bounds preliminary subagent snapshots while preserving terminal subagent output', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const longText = `${'x'.repeat(70 * 1024)}tail`

    const preliminary = await mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'claude-session-1',
      parent_tool_use_id: 'toolu_parent_1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: longText },
      },
    } as unknown as SDKMessage, state)

    const preliminaryOutput = preliminary.chunks.find(chunk => chunk.type === 'tool-output-available') as
      | { type: 'tool-output-available', output: { message?: UIMessage, truncated?: boolean } }
      | undefined
    const preliminaryText = preliminaryOutput?.output.message?.parts
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('')

    expect(preliminaryOutput?.output.truncated).toBe(true)
    expect(preliminaryText?.length).toBeLessThan(longText.length)
    expect(preliminaryText).not.toContain('tail')

    const terminal = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'claude-session-1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_parent_1',
            content: { ok: true },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    const terminalOutput = terminal.chunks.find(chunk => chunk.type === 'tool-output-available') as
      | { type: 'tool-output-available', output: { message?: UIMessage, truncated?: boolean } }
      | undefined
    const terminalText = terminalOutput?.output.message?.parts
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('')

    expect(terminalOutput?.output.truncated).toBeUndefined()
    expect(terminalText).toContain('tail')
  })
})
