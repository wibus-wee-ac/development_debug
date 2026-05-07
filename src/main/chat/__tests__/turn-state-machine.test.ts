// Input: Shared timeline chunk projector and typed timeline events
// Output: Unit tests for chunk projection from domain events
// Position: Chat feature regression guard for the shared real-time chunk projection contract

import { describe, expect, it } from 'vitest'

import { projectTimelineEventToChunks } from '../../../shared/timeline-projection'

describe('projectTimelineEventToChunks', () => {
  it('projects reasoning events to reasoning chunks', () => {
    const startChunks = projectTimelineEventToChunks({
      type: 'reasoning.started',
      itemId: 'reasoning-1',
      source: { backend: 'acp-chat', eventType: 'reasoning.started' },
    })
    expect(startChunks).toEqual([{ type: 'reasoning-start', id: 'reasoning-1' }])

    const deltaChunks = projectTimelineEventToChunks({
      type: 'reasoning.delta',
      itemId: 'reasoning-1',
      delta: '思考中',
      source: { backend: 'acp-chat', eventType: 'reasoning.delta' },
    })
    expect(deltaChunks).toEqual([{ type: 'reasoning-delta', id: 'reasoning-1', delta: '思考中' }])

    const endChunks = projectTimelineEventToChunks({
      type: 'reasoning.completed',
      itemId: 'reasoning-1',
      source: { backend: 'acp-chat', eventType: 'reasoning.completed' },
    })
    expect(endChunks).toEqual([{ type: 'reasoning-end', id: 'reasoning-1' }])
  })

  it('projects command lifecycle to tool chunks', () => {
    const startChunks = projectTimelineEventToChunks({
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

    const completeChunks = projectTimelineEventToChunks({
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
    const chunks = projectTimelineEventToChunks({
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
    const chunks = projectTimelineEventToChunks({
      type: 'run.completed',
      source: { backend: 'openai-compatible', eventType: 'response.completed' },
    })
    expect(chunks).toEqual([{ type: 'finish', finishReason: 'stop' }])
  })
})
