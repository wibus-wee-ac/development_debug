import type { UIMessage } from 'ai'

type MessagePart = UIMessage['parts'][number]
type TextPartKind = 'text' | 'reasoning'

export type ChatPartDelta
  = | { seq: number, type: 'part_add', partIndex: number, part: MessagePart }
    | { seq: number, type: 'text_append', partIndex: number, partType: TextPartKind, text: string }
    | { seq: number, type: 'text_done', partIndex: number, partType: TextPartKind }
    | { seq: number, type: 'tool_input_append', partIndex: number, inputKey: string, text: string }
    | { seq: number, type: 'tool_input_set', partIndex: number, input: unknown }
    | { seq: number, type: 'tool_output_streaming', partIndex: number, stream: 'stdout' | 'stderr', text: string }
    | { seq: number, type: 'tool_output_set', partIndex: number, output?: unknown, state: 'output-available' | 'output-error' | 'output-denied', errorText?: string }
    | { seq: number, type: 'metadata_update', metadata: unknown }

export interface SubagentMessageContext {
  messageId: string
  parentMessageId: string
  parentToolCallId: string
  taskId?: string | null
}

export type ChatStreamEvent
  = | { type: 'message_delta', data: { messageId: string, deltas: ChatPartDelta[] } }
    | { type: 'subagent_message_delta', data: { context: SubagentMessageContext, deltas: ChatPartDelta[] } }
    | { type: 'run_completed', data: { messageId: string } }
    | { type: 'run_aborted', data: { messageId: string } }
    | { type: 'run_failed', data: { messageId: string, errorText: string } }

export interface ChatMessageSnapshotRow {
  messageId: string
  role: 'user' | 'assistant'
  status: string
  errorText?: string | null
  content: string
  message: UIMessage
  parentMessageId: string | null
  parentToolCallId: string | null
  taskId: string | null
  depth: number
}

export function applyChatPartDeltas(message: UIMessage, deltas: ChatPartDelta[]): UIMessage {
  const next: UIMessage = {
    ...message,
    parts: [...message.parts],
  }

  for (const delta of [...deltas].sort((left, right) => left.seq - right.seq)) {
    switch (delta.type) {
      case 'part_add':
        next.parts[delta.partIndex] = clonePart(delta.part)
        break
      case 'text_append':
        updateTextPart(next.parts, delta.partIndex, delta.partType, text => text + delta.text)
        break
      case 'text_done':
        updatePartState(next.parts, delta.partIndex, 'done')
        break
      case 'tool_input_append':
        updateToolPart(next.parts, delta.partIndex, (part) => {
          part.input = appendInputText(part.input, delta.inputKey, delta.text)
        })
        break
      case 'tool_input_set':
        updateToolPart(next.parts, delta.partIndex, (part) => {
          part.input = delta.input
          part.state = 'input-available'
        })
        break
      case 'tool_output_streaming':
        updateToolPart(next.parts, delta.partIndex, (part) => {
          part.output = `${typeof part.output === 'string' ? part.output : ''}${delta.text}`
        })
        break
      case 'tool_output_set':
        updateToolPart(next.parts, delta.partIndex, (part) => {
          part.state = delta.state
          if ('output' in delta) {
            part.output = delta.output
          }
          part.errorText = delta.errorText
        })
        break
      case 'metadata_update':
        ;(next as { metadata?: unknown }).metadata = delta.metadata
        break
    }
  }

  return next
}

function updateTextPart(
  parts: MessagePart[],
  index: number,
  partType: TextPartKind,
  update: (text: string) => string,
): void {
  const part = parts[index] as unknown as { type?: string, text?: string }
  if (!part || part.type !== partType) {
    return
  }
  part.text = update(part.text ?? '')
}

function updatePartState(parts: MessagePart[], index: number, state: 'done'): void {
  const part = parts[index] as unknown as { state?: string } | undefined
  if (part) {
    part.state = state
  }
}

function updateToolPart(parts: MessagePart[], index: number, update: (part: { state?: string, input?: unknown, output?: unknown, errorText?: string }) => void): void {
  const part = parts[index] as unknown as { toolCallId?: string, state?: string, input?: unknown, output?: unknown, errorText?: string } | undefined
  if (!part?.toolCallId) {
    return
  }
  update(part)
}

function appendInputText(input: unknown, inputKey: string, text: string): Record<string, unknown> {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const current = input as Record<string, unknown>
    return {
      ...current,
      [inputKey]: `${typeof current[inputKey] === 'string' ? current[inputKey] : ''}${text}`,
    }
  }
  return { [inputKey]: text }
}

function clonePart(part: MessagePart): MessagePart {
  return typeof structuredClone === 'function'
    ? structuredClone(part)
    : JSON.parse(JSON.stringify(part)) as MessagePart
}
