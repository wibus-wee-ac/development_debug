// Input: ACP timeline converter and ACP session update fixtures
// Output: Regression tests for ACP-to-timeline mapping at the adapter boundary
// Position: ACP adapter guardrail for the breaking rewrite that removes ResponseStreamEvent from core

import { describe, expect, it } from 'vitest'

import { AcpTimelineConverter } from '../acp-timeline-converter'

describe('acpTimelineConverter', () => {
  it('maps message, reasoning, and tool updates into typed timeline input events', () => {
    const converter = new AcpTimelineConverter({ backend: 'acp-chat' })

    const messageEvents = converter.convert({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hello' },
    })
    const reasoningEvents = converter.convert({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'thinking' },
    })
    const toolEvents = converter.convert({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      title: 'read_file',
      status: 'completed',
      rawInput: { path: 'a.txt' },
      rawOutput: { content: 'hello' },
    })

    expect(messageEvents).toEqual([
      expect.objectContaining({ type: 'assistant.message.started' }),
      expect.objectContaining({ type: 'assistant.text.delta', delta: 'hello' }),
    ])
    expect(reasoningEvents).toEqual([
      expect.objectContaining({ type: 'reasoning.started' }),
      expect.objectContaining({ type: 'reasoning.delta', delta: 'thinking' }),
    ])
    expect(toolEvents).toEqual([
      expect.objectContaining({ type: 'command.started', itemId: 'call-1' }),
      expect.objectContaining({ type: 'command.completed', itemId: 'call-1', exitCode: 0 }),
    ])
  })
})
