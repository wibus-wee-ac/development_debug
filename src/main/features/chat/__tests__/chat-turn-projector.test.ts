// Input: chat turn projector and typed timeline events
// Output: Unit tests for assistant snapshot projection across text, reasoning, and command parts
// Position: Chat feature regression guard for the in-memory projector used by transactional turn persistence

import { describe, expect, it } from 'vitest'

import {
  applyTimelineEventToChatTurn,
  createChatTurnProjector,
} from '../chat-turn-projector'

function createProjector() {
  return createChatTurnProjector({
    id: 'message-1',
    role: 'assistant',
    parts: [],
  })
}

describe('chatTurnProjector', () => {
  it('projects assistant text and reasoning parts in stream order', () => {
    const projector = createProjector()

    applyTimelineEventToChatTurn(projector, {
      type: 'reasoning.started',
      itemId: 'reasoning-1',
      source: { backend: 'acp-chat', eventType: 'reasoning.started' },
    })
    applyTimelineEventToChatTurn(projector, {
      type: 'reasoning.delta',
      itemId: 'reasoning-1',
      delta: '思考中',
      source: { backend: 'acp-chat', eventType: 'reasoning.delta' },
    })
    applyTimelineEventToChatTurn(projector, {
      type: 'assistant.message.started',
      itemId: 'text-1',
      source: { backend: 'acp-chat', eventType: 'assistant.message.started' },
    })
    applyTimelineEventToChatTurn(projector, {
      type: 'assistant.text.delta',
      itemId: 'text-1',
      delta: '最终答案',
      source: { backend: 'acp-chat', eventType: 'assistant.text.delta' },
    })
    applyTimelineEventToChatTurn(projector, {
      type: 'reasoning.completed',
      itemId: 'reasoning-1',
      source: { backend: 'acp-chat', eventType: 'reasoning.completed' },
    })
    applyTimelineEventToChatTurn(projector, {
      type: 'assistant.message.completed',
      itemId: 'text-1',
      source: { backend: 'acp-chat', eventType: 'assistant.message.completed' },
    })

    expect(projector.message.parts).toEqual([
      { type: 'reasoning', text: '思考中', state: 'done' },
      { type: 'text', text: '最终答案', state: 'done' },
    ])
  })

  it('projects command lifecycle into a single tool part', () => {
    const projector = createProjector()

    applyTimelineEventToChatTurn(projector, {
      type: 'command.started',
      itemId: 'cmd-1',
      command: 'bash',
      input: 'echo hello',
      source: { backend: 'cli-tui', eventType: 'command.started' },
    })
    applyTimelineEventToChatTurn(projector, {
      type: 'command.completed',
      itemId: 'cmd-1',
      exitCode: 0,
      output: 'hello',
      source: { backend: 'cli-tui', eventType: 'command.completed' },
    })

    expect(projector.message.parts).toEqual([
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
})
