// Input: timeline event parsers and chat projection helpers
// Output: Regression tests for typed backend timeline facts and projection semantics
// Position: Feature-level RED/GREEN guardrail for the Plan 07 breaking timeline rewrite

import { describe, expect, it } from 'vitest'

import {
  parseTimelineInputEvent,
  projectTimelineEventToChatChunks,
} from '../timeline-events'

describe('timeline events', () => {
  it('parses typed assistant text events at runtime', () => {
    const event = parseTimelineInputEvent({
      type: 'assistant.text.delta',
      itemId: 'item-1',
      delta: 'hello',
      source: {
        backend: 'openai-compatible',
        eventType: 'response.output_text.delta',
      },
    })

    expect(event).toEqual(expect.objectContaining({
      type: 'assistant.text.delta',
      itemId: 'item-1',
      delta: 'hello',
    }))
  })

  it('projects typed timeline facts into chat chunks without raw transport', () => {
    const chunks = [
      parseTimelineInputEvent({
        type: 'assistant.message.started',
        itemId: 'msg-1',
        source: { backend: 'openai-compatible', eventType: 'response.output_item.added' },
      }),
      parseTimelineInputEvent({
        type: 'assistant.text.delta',
        itemId: 'msg-1',
        delta: 'Hello',
        source: { backend: 'openai-compatible', eventType: 'response.output_text.delta' },
      }),
      parseTimelineInputEvent({
        type: 'assistant.message.completed',
        itemId: 'msg-1',
        source: { backend: 'openai-compatible', eventType: 'response.output_item.done' },
      }),
      parseTimelineInputEvent({
        type: 'run.completed',
        source: { backend: 'openai-compatible', eventType: 'response.completed' },
      }),
    ].flatMap(projectTimelineEventToChatChunks)

    expect(chunks).toEqual([
      { type: 'text-start', id: 'msg-1' },
      { type: 'text-delta', id: 'msg-1', delta: 'Hello' },
      { type: 'text-end', id: 'msg-1' },
      { type: 'finish', finishReason: 'stop' },
    ])
  })
})