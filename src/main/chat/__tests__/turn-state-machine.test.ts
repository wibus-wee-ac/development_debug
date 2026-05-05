// Input: TurnStateMachine and typed timeline events
// Output: Unit tests for assistant message projection across text, reasoning, and command parts
// Position: Chat feature regression guard for the turn state machine used by transactional persistence

import { describe, expect, it } from 'vitest'

import { createTurnStateMachine } from '../turn-state-machine'

function createMachine() {
  return createTurnStateMachine({
    id: 'message-1',
    role: 'assistant',
    parts: [],
  })
}

describe('turnStateMachine', () => {
  it('projects assistant text and reasoning parts in stream order', () => {
    const machine = createMachine()

    machine.apply({
      type: 'reasoning.started',
      itemId: 'reasoning-1',
      source: { backend: 'acp-chat', eventType: 'reasoning.started' },
    })
    machine.apply({
      type: 'reasoning.delta',
      itemId: 'reasoning-1',
      delta: '思考中',
      source: { backend: 'acp-chat', eventType: 'reasoning.delta' },
    })
    machine.apply({
      type: 'assistant.message.started',
      itemId: 'text-1',
      source: { backend: 'acp-chat', eventType: 'assistant.message.started' },
    })
    machine.apply({
      type: 'assistant.text.delta',
      itemId: 'text-1',
      delta: '最终答案',
      source: { backend: 'acp-chat', eventType: 'assistant.text.delta' },
    })
    machine.apply({
      type: 'reasoning.completed',
      itemId: 'reasoning-1',
      source: { backend: 'acp-chat', eventType: 'reasoning.completed' },
    })
    machine.apply({
      type: 'assistant.message.completed',
      itemId: 'text-1',
      source: { backend: 'acp-chat', eventType: 'assistant.message.completed' },
    })

    expect(machine.message.parts).toEqual([
      { type: 'reasoning', text: '思考中', state: 'done' },
      { type: 'text', text: '最终答案', state: 'done' },
    ])
  })

  it('projects command lifecycle into a single tool part', () => {
    const machine = createMachine()

    machine.apply({
      type: 'command.started',
      itemId: 'cmd-1',
      command: 'bash',
      input: 'echo hello',
      source: { backend: 'cli-tui', eventType: 'command.started' },
    })
    machine.apply({
      type: 'command.completed',
      itemId: 'cmd-1',
      exitCode: 0,
      output: 'hello',
      source: { backend: 'cli-tui', eventType: 'command.completed' },
    })

    expect(machine.message.parts).toEqual([
      {
        type: 'tool-bash',
        toolName: 'bash',
        toolCallId: 'cmd-1',
        state: 'output-available',
        input: 'echo hello',
        output: 'hello',
      },
    ])
  })

  it('returns UIMessageChunks for broadcast', () => {
    const machine = createMachine()

    const chunks = machine.apply({
      type: 'assistant.text.delta',
      itemId: 'text-1',
      delta: 'hello',
      source: { backend: 'openai-compatible', eventType: 'response.output_text.delta' },
    })

    expect(chunks).toEqual([
      { type: 'text-delta', id: 'text-1', delta: 'hello' },
    ])
  })

  it('handles duplicate text-start gracefully', () => {
    const machine = createMachine()

    machine.apply({
      type: 'assistant.message.started',
      itemId: 'text-1',
      source: { backend: 'acp-chat', eventType: 'assistant.message.started' },
    })
    machine.apply({
      type: 'assistant.message.started',
      itemId: 'text-1',
      source: { backend: 'acp-chat', eventType: 'assistant.message.started' },
    })
    machine.apply({
      type: 'assistant.text.delta',
      itemId: 'text-1',
      delta: 'content',
      source: { backend: 'acp-chat', eventType: 'assistant.text.delta' },
    })

    // Should only have one text part, not duplicated
    expect(machine.message.parts).toEqual([
      { type: 'text', text: 'content', state: 'streaming' },
    ])
  })
})
