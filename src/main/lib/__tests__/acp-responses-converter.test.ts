// Input: AcpResponsesConverter and ACP session update fixtures
// Output: Regression tests for OpenAI Responses event shape emitted by the ACP converter
// Position: Unit test file for src/main/lib/acp-responses-converter.ts

import { describe, expect, it } from 'vitest'

import { AcpResponsesConverter } from '../acp-responses-converter'

describe('acpResponsesConverter', () => {
  it('emits typed message events with required response metadata', () => {
    const converter = new AcpResponsesConverter()

    const events = converter.convert({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hello' },
    })
    const flushed = converter.flush()

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'response.output_item.added',
      output_index: 1,
      sequence_number: 0,
      item: {
        type: 'message',
        role: 'assistant',
        status: 'in_progress',
        content: [],
      },
    })
    expect(events[1]).toMatchObject({
      type: 'response.output_text.delta',
      item_id: (events[0] as { item: { id: string } }).item.id,
      output_index: 1,
      content_index: 0,
      delta: 'hello',
      logprobs: [],
      sequence_number: 1,
    })
    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toMatchObject({
      type: 'response.output_item.done',
      output_index: 1,
      sequence_number: 2,
      item: {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: 'hello',
            annotations: [],
          },
        ],
      },
    })
  })

  it('closes reasoning parts with part payload and sequence numbers', () => {
    const converter = new AcpResponsesConverter()

    const events = converter.convert({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'thinking' },
    })
    const flushed = converter.flush()

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'response.reasoning_summary_part.added',
      output_index: 1,
      summary_index: 0,
      sequence_number: 0,
      part: {
        type: 'summary_text',
        text: '',
      },
    })
    expect(events[1]).toMatchObject({
      type: 'response.reasoning_summary_text.delta',
      output_index: 1,
      summary_index: 0,
      delta: 'thinking',
      sequence_number: 1,
    })
    expect(flushed[0]).toMatchObject({
      type: 'response.reasoning_summary_part.done',
      output_index: 1,
      summary_index: 0,
      sequence_number: 2,
      part: {
        type: 'summary_text',
        text: 'thinking',
      },
    })
  })

  it('emits function call items with explicit status and sequence numbers', () => {
    const converter = new AcpResponsesConverter()

    const events = converter.convert({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      title: 'read_file',
      status: 'completed',
      rawInput: { path: 'a.txt' },
      rawOutput: { content: 'hello' },
    })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'response.output_item.added',
      output_index: 1,
      sequence_number: 0,
      item: {
        type: 'function_call',
        id: 'call-1',
        call_id: 'call-1',
        name: 'read_file',
        arguments: '',
        status: 'in_progress',
      },
    })
    expect(events[1]).toMatchObject({
      type: 'response.output_item.done',
      output_index: 1,
      sequence_number: 1,
      item: {
        type: 'function_call',
        id: 'call-1',
        call_id: 'call-1',
        name: 'read_file',
        status: 'completed',
      },
    })
  })
})
