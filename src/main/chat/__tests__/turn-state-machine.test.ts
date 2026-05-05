// Input: TimelineChunkProjector and typed timeline events
// Output: Unit tests for chunk projection from domain events
// Position: Chat feature regression guard for real-time broadcast chunk generation

import { describe, expect, it } from 'vitest'

import { createTimelineChunkProjector } from '../timeline-chunk-projector'

describe('timelineChunkProjector', () => {
  it('projects reasoning events to reasoning chunks', () => {
    const projector = createTimelineChunkProjector()

    const startChunks = projector.apply({
      type: 'reasoning.started',
      itemId: 'reasoning-1',
      source: { backend: 'acp-chat', eventType: 'reasoning.started' },
    })
    expect(startChunks).toEqual([{ type: 'reasoning-start', id: 'reasoning-1' }])

    const deltaChunks = projector.apply({
      type: 'reasoning.delta',
      itemId: 'reasoning-1',
      delta: '思考中',
      source: { backend: 'acp-chat', eventType: 'reasoning.delta' },
    })
    expect(deltaChunks).toEqual([{ type: 'reasoning-delta', id: 'reasoning-1', delta: '思考中' }])

    const endChunks = projector.apply({
      type: 'reasoning.completed',
      itemId: 'reasoning-1',
      source: { backend: 'acp-chat', eventType: 'reasoning.completed' },
    })
    expect(endChunks).toEqual([{ type: 'reasoning-end', id: 'reasoning-1' }])
  })

  it('projects command lifecycle to tool chunks', () => {
    const projector = createTimelineChunkProjector()

    const startChunks = projector.apply({
      type: 'command.started',
      itemId: 'cmd-1',
      command: 'bash',
      input: 'echo hello',
      source: { backend: 'cli-tui', eventType: 'command.started' },
    })
    expect(startChunks).toEqual([
      { type: 'tool-input-start', toolCallId: 'cmd-1', toolName: 'bash' },
      { type: 'tool-input-available', toolCallId: 'cmd-1', toolName: 'bash', input: 'echo hello' },
    ])

    const completeChunks = projector.apply({
      type: 'command.completed',
      itemId: 'cmd-1',
      exitCode: 0,
      output: 'hello',
      source: { backend: 'cli-tui', eventType: 'command.completed' },
    })
    expect(completeChunks).toEqual([
      { type: 'tool-output-available', toolCallId: 'cmd-1', output: 'hello' },
    ])
  })

  it('returns text-delta chunk for assistant text', () => {
    const projector = createTimelineChunkProjector()

    const chunks = projector.apply({
      type: 'assistant.text.delta',
      itemId: 'text-1',
      delta: 'hello',
      source: { backend: 'openai-compatible', eventType: 'response.output_text.delta' },
    })

    expect(chunks).toEqual([
      { type: 'text-delta', id: 'text-1', delta: 'hello' },
    ])
  })

  it('returns finish chunk for run.completed', () => {
    const projector = createTimelineChunkProjector()

    const chunks = projector.apply({
      type: 'run.completed',
      source: { backend: 'openai-compatible', eventType: 'response.completed' },
    })
    expect(chunks).toEqual([{ type: 'finish', finishReason: 'stop' }])
  })
})
