// Input: Vitest assertions and chat render-plan helpers
// Output: Regression coverage for tool grouping and execution fold boundaries
// Position: Chat feature unit test for MessageBubble render-plan semantics

import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { groupMessageParts, hasFinalReply, splitExecutionPhase } from './chat-render-plan'

type TestMessagePart = UIMessage['parts'][number]

function text(value: string): UIMessage['parts'][number] {
  return { type: 'text', text: value }
}

function tool(id: string, output?: unknown): TestMessagePart {
  return {
    type: 'dynamic-tool',
    toolName: 'custom_tool',
    toolCallId: id,
    state: output === undefined ? 'input-available' : 'output-available',
    input: { value: id },
    output,
  } as TestMessagePart
}

function message(id: string, parts: UIMessage['parts']): UIMessage {
  return {
    id,
    role: 'assistant',
    parts,
  } as UIMessage
}

describe('groupMessageParts', () => {
  it('keeps unknown tools renderable and preserves subagent children', () => {
    const child = message('sub-1', [text('Nested result')])
    const grouped = groupMessageParts(
      [tool('call-1', { ok: true })],
      'msg-1',
      new Map([['call-1', [child]]]),
    )

    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toMatchObject({
      kind: 'tool-call',
      key: 'call-1',
      subagentMessages: [child],
    })
    expect(grouped[0].kind === 'tool-call' ? grouped[0].part.output : undefined).toEqual({ ok: true })
  })
})

describe('splitExecutionPhase', () => {
  it('splits tool activity from the final reply', () => {
    const items = groupMessageParts([tool('call-1'), text('Final answer')], 'msg-1', undefined)
    const split = splitExecutionPhase(items)

    expect(hasFinalReply(items)).toBe(true)
    expect(split?.executionItems.map(item => item.kind)).toEqual(['tool-call'])
    expect(split?.finalItems.map(item => item.kind)).toEqual(['text'])
  })

  it('keeps preamble and intermediate text in the execution phase before final text', () => {
    const items = groupMessageParts([
      text('I will inspect first.'),
      tool('call-1'),
      text('Need one more check.'),
      tool('call-2'),
      text('Final answer'),
    ], 'msg-1', undefined)
    const split = splitExecutionPhase(items)

    expect(split?.executionItems.map(item => item.key)).toEqual([
      'msg-1-text-0',
      'call-1',
      'msg-1-text-2',
      'call-2',
    ])
    expect(split?.finalItems.map(item => item.key)).toEqual(['msg-1-text-4'])
  })

  it('does not fold when a message has no final text after a tool', () => {
    const items = groupMessageParts([text('Final answer first'), tool('call-1')], 'msg-1', undefined)

    expect(hasFinalReply(items)).toBe(false)
    expect(splitExecutionPhase(items)).toBeNull()
  })
})
