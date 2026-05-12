// Input: Shared assistant-message projector and shared timeline chunk projector
// Output: Regression tests ensuring the shared projector produces correct UIMessage output
// Position: TDD safety net for the UIMessage dehydration migration (ExecPlan 20260505-12)

import { describe, expect, it } from 'vitest'

import type { ProjectableTimelineEvent } from '../../../shared/timeline-projection'
import { projectEventsToAssistantMessage, projectTimelineEventToChunks } from '../../../shared/timeline-projection'
import type { TimelineInputEvent } from '../../backend-control-plane/timeline-events'

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

  it('projectTimelineEventToChunks returns correct chunks', () => {
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

  it('tool_call lifecycle: started → completed transitions to output-available', () => {
    const events: TimelineInputEvent[] = [
      { type: 'tool_call.started', itemId: 'toolu_abc', toolName: 'bash', toolInput: '{"command":"echo hi"}', source: { backend: 'claude-agent', eventType: 'tool_use', itemId: 'toolu_abc' } },
      { type: 'tool_call.completed', itemId: 'toolu_abc', result: 'hi\n', source: { backend: 'claude-agent', eventType: 'tool_result', itemId: 'toolu_abc' } },
    ]

    const result = projectEventsToAssistantMessage('msg-1', events as ProjectableTimelineEvent[])
    expect(result.parts).toEqual([
      { type: 'tool-bash', toolName: 'bash', toolCallId: 'toolu_abc', state: 'output-available', input: '{"command":"echo hi"}', output: 'hi\n' },
    ])
  })

  it('tool_call without completed stays in input-available (spinner regression)', () => {
    const events: TimelineInputEvent[] = [
      { type: 'tool_call.started', itemId: 'toolu_abc', toolName: 'bash', toolInput: '{"command":"echo hi"}', source: { backend: 'claude-agent', eventType: 'tool_use', itemId: 'toolu_abc' } },
    ]

    const result = projectEventsToAssistantMessage('msg-1', events as ProjectableTimelineEvent[])
    expect(result.parts).toEqual([
      expect.objectContaining({ type: 'tool-bash', toolCallId: 'toolu_abc', state: 'input-available' }),
    ])
  })

  it('tool_call.completed with empty result still transitions to output-available', () => {
    const events: TimelineInputEvent[] = [
      { type: 'tool_call.started', itemId: 'toolu_empty', toolName: 'bash', toolInput: '{}', source: { backend: 'claude-agent', eventType: 'tool_use', itemId: 'toolu_empty' } },
      { type: 'tool_call.completed', itemId: 'toolu_empty', result: '', source: { backend: 'claude-agent', eventType: 'tool_result', itemId: 'toolu_empty' } },
    ]

    const result = projectEventsToAssistantMessage('msg-1', events as ProjectableTimelineEvent[])
    expect(result.parts).toEqual([
      expect.objectContaining({ type: 'tool-bash', toolCallId: 'toolu_empty', state: 'output-available', output: '' }),
    ])
  })

  it('tool_call.completed with null result still transitions to output-available', () => {
    const events: TimelineInputEvent[] = [
      { type: 'tool_call.started', itemId: 'toolu_null', toolName: 'bash', toolInput: '{}', source: { backend: 'claude-agent', eventType: 'tool_use', itemId: 'toolu_null' } },
      { type: 'tool_call.completed', itemId: 'toolu_null', source: { backend: 'claude-agent', eventType: 'tool_result', itemId: 'toolu_null' } },
    ]

    const result = projectEventsToAssistantMessage('msg-1', events as ProjectableTimelineEvent[])
    expect(result.parts).toEqual([
      expect.objectContaining({ type: 'tool-bash', toolCallId: 'toolu_null', state: 'output-available', output: '' }),
    ])
  })

  it('tool_call.input.delta accumulates partial JSON into tool input', () => {
    const events: TimelineInputEvent[] = [
      { type: 'tool_call.started', itemId: 'toolu_delta', toolName: 'bash', toolInput: null, source: { backend: 'claude-agent', eventType: 'content_block_start', itemId: 'toolu_delta' } },
      { type: 'tool_call.input.delta', itemId: 'toolu_delta', delta: '{"com', source: { backend: 'claude-agent', eventType: 'input_json_delta', itemId: 'toolu_delta' } },
      { type: 'tool_call.input.delta', itemId: 'toolu_delta', delta: 'mand":', source: { backend: 'claude-agent', eventType: 'input_json_delta', itemId: 'toolu_delta' } },
      { type: 'tool_call.input.delta', itemId: 'toolu_delta', delta: '"echo hi"}', source: { backend: 'claude-agent', eventType: 'input_json_delta', itemId: 'toolu_delta' } },
      { type: 'tool_call.completed', itemId: 'toolu_delta', result: 'hi\n', source: { backend: 'claude-agent', eventType: 'tool_result', itemId: 'toolu_delta' } },
    ]

    const result = projectEventsToAssistantMessage('msg-1', events as ProjectableTimelineEvent[])
    expect(result.parts).toEqual([
      expect.objectContaining({
        type: 'tool-bash',
        toolCallId: 'toolu_delta',
        state: 'output-available',
        input: '{"command":"echo hi"}',
        output: 'hi\n',
      }),
    ])
  })

  it('projectTimelineEventToChunks returns empty for tool_call.input.delta', () => {
    const chunks = projectTimelineEventToChunks({
      type: 'tool_call.input.delta',
      itemId: 'toolu_abc',
      delta: '{"partial":',
    })
    expect(chunks).toEqual([])
  })
})
