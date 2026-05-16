// Input: chat chunk reducer helpers and representative UIMessageChunk sequences
// Output: Unit tests proving hydration/live/subagent paths share one chunk protocol semantics
// Position: Chat feature regression tests for canonical chunk replay behavior

import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  applyAssistantChunk,
  createAssistantChunkProjection,
  projectAssistantMessageFromChunks,
  replayAssistantChunks,
} from './chat-chunk-reducer'

describe('chat chunk reducer', () => {
  it('replays mixed assistant chunks into canonical parts', () => {
    const chunks = [
      { type: 'text-start', providerMetadata: { provider: 'demo' } },
      { type: 'text-delta', delta: 'Hello' },
      { type: 'text-delta', delta: ', world' },
      { type: 'text-end' },
      { type: 'reasoning-start' },
      { type: 'reasoning-delta', delta: 'Need to call a tool.' },
      { type: 'reasoning-end' },
      { type: 'tool-input-start', toolCallId: 'tool-1', toolName: 'search' },
      { type: 'tool-input-available', toolCallId: 'tool-1', input: { query: 'world' } },
      { type: 'tool-output-available', toolCallId: 'tool-1', output: { answer: 42 } },
    ] as UIMessageChunk[]

    expect(replayAssistantChunks(chunks)).toEqual([
      {
        type: 'text',
        text: 'Hello, world',
        providerMetadata: { provider: 'demo' },
      },
      {
        type: 'reasoning',
        text: 'Need to call a tool.',
        reasoning: 'Need to call a tool.',
        details: [{ type: 'text', text: 'Need to call a tool.' }],
        state: 'done',
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'tool-1',
        toolName: 'search',
        state: 'output-available',
        input: { query: 'world' },
        output: { answer: 42 },
      },
    ])
  })

  it('matches incremental live application with full replay output', () => {
    const chunks = [
      { type: 'text-delta', delta: 'fallback open' },
      { type: 'text-delta', delta: ' text' },
      { type: 'text-end' },
      { type: 'tool-input-start', toolCallId: 'tool-2', toolName: 'delegate' },
      { type: 'tool-input-error', toolCallId: 'tool-2', input: { job: 'child' }, errorText: 'denied' },
    ] as UIMessageChunk[]

    const liveProjection = chunks.reduce(applyAssistantChunk, createAssistantChunkProjection())

    expect(liveProjection.parts).toEqual(replayAssistantChunks(chunks))
    expect(projectAssistantMessageFromChunks('assistant-1', chunks)).toEqual({
      id: 'assistant-1',
      role: 'assistant',
      parts: liveProjection.parts,
    })
  })
})