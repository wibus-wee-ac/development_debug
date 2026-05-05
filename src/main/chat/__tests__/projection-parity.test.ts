// Input: Shared projectEventsToAssistantMessage and TimelineChunkProjector
// Output: Regression tests ensuring the shared projector produces correct UIMessage output
// Position: TDD safety net for the UIMessage dehydration migration (ExecPlan 20260505-12)

import { describe, expect, it } from 'vitest'

import type { ProjectableTimelineEvent } from '../../../shared/timeline-projection'
import { projectEventsToAssistantMessage } from '../../../shared/timeline-projection'
import type { TimelineInputEvent } from '../../backend-control-plane/timeline-events'
import { createTimelineChunkProjector } from '../timeline-chunk-projector'

describe('projection parity: shared projector produces correct UIMessage', () => {
  it('simple text conversation (text-start → delta × N → text-end)', () => {
    const events: TimelineInputEvent[] = [
      { type: 'assistant.message.started', itemId: 'text-1', source: { backend: 'openai-compatible', eventType: 'response.created' } },
      { type: 'assistant.text.delta', itemId: 'text-1', delta: 'Hello ', source: { backend: 'openai-compatible', eventType: 'response.output_text.delta' } },
      { type: 'assistant.text.delta', itemId: 'text-1', delta: 'world!', source: { backend: 'openai-compatible', eventType: 'response.output_text.delta' } },
      { type: 'assistant.message.completed', itemId: 'text-1', source: { backend: 'openai-compatible', eventType: 'response.completed' } },
    ]

    const result = projectEventsToAssistantMessage('msg-1', events as ProjectableTimelineEvent[])
    expect(result.parts).toEqual([
      { type: 'text', text: 'Hello world!', state: 'done' },
    ])
  })

  it('reasoning followed by text', () => {
    const events: TimelineInputEvent[] = [
      { type: 'reasoning.started', itemId: 'r-1', source: { backend: 'openai-compatible', eventType: 'reasoning.started' } },
      { type: 'reasoning.delta', itemId: 'r-1', delta: 'Let me think...', source: { backend: 'openai-compatible', eventType: 'reasoning.delta' } },
      { type: 'reasoning.delta', itemId: 'r-1', delta: ' about this.', source: { backend: 'openai-compatible', eventType: 'reasoning.delta' } },
      { type: 'reasoning.completed', itemId: 'r-1', source: { backend: 'openai-compatible', eventType: 'reasoning.completed' } },
      { type: 'assistant.message.started', itemId: 'text-1', source: { backend: 'openai-compatible', eventType: 'response.created' } },
      { type: 'assistant.text.delta', itemId: 'text-1', delta: 'The answer is 42.', source: { backend: 'openai-compatible', eventType: 'response.output_text.delta' } },
      { type: 'assistant.message.completed', itemId: 'text-1', source: { backend: 'openai-compatible', eventType: 'response.completed' } },
    ]

    const result = projectEventsToAssistantMessage('msg-1', events as ProjectableTimelineEvent[])
    expect(result.parts).toEqual([
      { type: 'reasoning', text: 'Let me think... about this.', state: 'done' },
      { type: 'text', text: 'The answer is 42.', state: 'done' },
    ])
  })

  it('tool use (command.started → command.completed with output)', () => {
    const events: TimelineInputEvent[] = [
      { type: 'command.started', itemId: 'cmd-1', command: 'bash', input: 'echo hello', source: { backend: 'cli-tui', eventType: 'command.started' } },
      { type: 'command.completed', itemId: 'cmd-1', exitCode: 0, output: 'hello\n', source: { backend: 'cli-tui', eventType: 'command.completed' } },
    ]

    const result = projectEventsToAssistantMessage('msg-1', events as ProjectableTimelineEvent[])
    expect(result.parts).toEqual([
      {
        type: 'tool-bash',
        toolName: 'bash',
        toolCallId: 'cmd-1',
        state: 'output-available',
        input: 'echo hello',
        output: 'hello\n',
      },
    ])
  })

  it('multi-tool turn with text interleaved', () => {
    const events: TimelineInputEvent[] = [
      { type: 'assistant.message.started', itemId: 'text-1', source: { backend: 'acp-chat', eventType: 'assistant.message.started' } },
      { type: 'assistant.text.delta', itemId: 'text-1', delta: 'I will run two commands.', source: { backend: 'acp-chat', eventType: 'assistant.text.delta' } },
      { type: 'assistant.message.completed', itemId: 'text-1', source: { backend: 'acp-chat', eventType: 'assistant.message.completed' } },
      { type: 'command.started', itemId: 'cmd-1', command: 'read_file', input: '/src/main.ts', source: { backend: 'acp-chat', eventType: 'command.started' } },
      { type: 'command.completed', itemId: 'cmd-1', exitCode: 0, output: 'file content', source: { backend: 'acp-chat', eventType: 'command.completed' } },
      { type: 'command.started', itemId: 'cmd-2', command: 'bash', input: 'ls -la', source: { backend: 'acp-chat', eventType: 'command.started' } },
      { type: 'command.completed', itemId: 'cmd-2', exitCode: 0, output: 'total 42\n...', source: { backend: 'acp-chat', eventType: 'command.completed' } },
      { type: 'assistant.message.started', itemId: 'text-2', source: { backend: 'acp-chat', eventType: 'assistant.message.started' } },
      { type: 'assistant.text.delta', itemId: 'text-2', delta: 'Done. Here are the results.', source: { backend: 'acp-chat', eventType: 'assistant.text.delta' } },
      { type: 'assistant.message.completed', itemId: 'text-2', source: { backend: 'acp-chat', eventType: 'assistant.message.completed' } },
    ]

    const result = projectEventsToAssistantMessage('msg-1', events as ProjectableTimelineEvent[])
    expect(result.parts).toEqual([
      { type: 'text', text: 'I will run two commands.', state: 'done' },
      { type: 'tool-read_file', toolName: 'read_file', toolCallId: 'cmd-1', state: 'output-available', input: '/src/main.ts', output: 'file content' },
      { type: 'tool-bash', toolName: 'bash', toolCallId: 'cmd-2', state: 'output-available', input: 'ls -la', output: 'total 42\n...' },
      { type: 'text', text: 'Done. Here are the results.', state: 'done' },
    ])
  })

  it('aborted run (partial text stays in streaming state)', () => {
    const events: TimelineInputEvent[] = [
      { type: 'assistant.message.started', itemId: 'text-1', source: { backend: 'openai-compatible', eventType: 'response.created' } },
      { type: 'assistant.text.delta', itemId: 'text-1', delta: 'Starting to answer but—', source: { backend: 'openai-compatible', eventType: 'response.output_text.delta' } },
      { type: 'run.aborted', source: { backend: 'openai-compatible', eventType: 'run.aborted' } },
    ]

    const result = projectEventsToAssistantMessage('msg-1', events as ProjectableTimelineEvent[])
    expect(result.parts).toEqual([
      { type: 'text', text: 'Starting to answer but—', state: 'streaming' },
    ])
  })

  it('tool with no output (command.completed without output field)', () => {
    const events: TimelineInputEvent[] = [
      { type: 'command.started', itemId: 'cmd-1', command: 'approve', input: 'confirm deploy', source: { backend: 'acp-chat', eventType: 'command.started' } },
      { type: 'command.completed', itemId: 'cmd-1', exitCode: 0, source: { backend: 'acp-chat', eventType: 'command.completed' } },
    ]

    const result = projectEventsToAssistantMessage('msg-1', events as ProjectableTimelineEvent[])
    expect(result.parts).toEqual([
      { type: 'tool-approve', toolName: 'approve', toolCallId: 'cmd-1', state: 'input-available', input: 'confirm deploy' },
    ])
  })

  it('duplicate text-start is idempotent', () => {
    const events: TimelineInputEvent[] = [
      { type: 'assistant.message.started', itemId: 'text-1', source: { backend: 'acp-chat', eventType: 'assistant.message.started' } },
      { type: 'assistant.message.started', itemId: 'text-1', source: { backend: 'acp-chat', eventType: 'assistant.message.started' } },
      { type: 'assistant.text.delta', itemId: 'text-1', delta: 'content', source: { backend: 'acp-chat', eventType: 'assistant.text.delta' } },
      { type: 'assistant.message.completed', itemId: 'text-1', source: { backend: 'acp-chat', eventType: 'assistant.message.completed' } },
    ]

    const result = projectEventsToAssistantMessage('msg-1', events as ProjectableTimelineEvent[])
    expect(result.parts).toEqual([
      { type: 'text', text: 'content', state: 'done' },
    ])
  })

  it('timelineChunkProjector.apply returns correct chunks', () => {
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
})
