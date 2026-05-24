import type { UIMessage } from 'ai'
import { z } from 'zod'

type AiMessagePart = UIMessage['parts'][number]
type MessagePart = AiMessagePart | {
  type: 'dynamic-tool'
  toolName: string
  toolCallId: string
  state: string
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
}
type TextPartKind = 'text' | 'reasoning'

const MutableTextPartSchema = z.custom<{ type: TextPartKind, text: string }>((part) => {
  z.object({
    type: z.enum(['text', 'reasoning']),
    text: z.string(),
  }).passthrough().parse(part)
  return true
})

const MutablePartStateSchema = z.custom<{ state?: string } | undefined>((part) => {
  if (part === undefined) {
    return true
  }
  z.object({
    state: z.string().optional(),
  }).passthrough().parse(part)
  return true
})

const MutableToolPartSchema = z.custom<{ toolCallId: string, state?: string, argumentsText?: string, input?: unknown, output?: unknown, errorText?: string }>((part) => {
  z.object({
    toolCallId: z.string(),
    state: z.string().optional(),
    argumentsText: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    errorText: z.string().optional(),
  }).passthrough().parse(part)
  return true
})

const MessageMetadataCarrierSchema = z.object({
  metadata: z.unknown().optional(),
}).passthrough()

export type ChatPartDelta
  = | { seq: number, type: 'part_add', partIndex: number, part: MessagePart }
    | { seq: number, type: 'text_append', partIndex: number, partType: TextPartKind, text: string }
    | { seq: number, type: 'text_done', partIndex: number, partType: TextPartKind }
    | { seq: number, type: 'tool_arguments_append', partIndex: number, text: string }
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
  const next = {
    ...message,
    parts: [...message.parts] as MessagePart[],
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
      case 'tool_arguments_append':
        updateToolPart(next.parts, delta.partIndex, (part) => {
          part.argumentsText = `${part.argumentsText ?? ''}${delta.text}`
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
          part.output = `${z.string().parse(part.output)}${delta.text}`
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
        Object.assign(MessageMetadataCarrierSchema.parse(next), { metadata: delta.metadata })
        break
    }
  }

  return next as UIMessage
}

function updateTextPart(
  parts: MessagePart[],
  index: number,
  partType: TextPartKind,
  update: (text: string) => string,
): void {
  const part = MutableTextPartSchema.parse(parts[index])
  if (part.type === partType) {
    part.text = update(part.text)
  }
}

function updatePartState(parts: MessagePart[], index: number, state: 'done'): void {
  const part = MutablePartStateSchema.parse(parts[index])
  if (part) {
    part.state = state
  }
}

function updateToolPart(parts: MessagePart[], index: number, update: (part: { state?: string, argumentsText?: string, input?: unknown, output?: unknown, errorText?: string }) => void): void {
  const part = MutableToolPartSchema.parse(parts[index])
  update(part)
}

function clonePart(part: MessagePart): MessagePart {
  return structuredClone(part)
}
