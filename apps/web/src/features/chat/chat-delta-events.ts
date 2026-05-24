import type { UIMessage } from 'ai'
import { z } from 'zod'

import type { ChatToolEntity, ToolAnchorPart } from './chat-tool-entities'
import { readToolAnchorPart } from './chat-tool-entities'
import type { ToolState } from './tool-ui-classifier'

type AiMessagePart = UIMessage['parts'][number]
type MessagePart = AiMessagePart | ToolAnchorPart
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

const MutableToolAnchorPartSchema = z.custom<ToolAnchorPart>((part) => {
  z.object({
    type: z.literal('dynamic-tool'),
    toolCallId: z.string(),
    toolName: z.string(),
    state: z.string(),
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

export interface ChatToolEntityPatch {
  partIndex: number
  toolCallId: string
  updater: (entity: ChatToolEntity) => ChatToolEntity
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
        break
      case 'tool_input_set':
        updateToolAnchorState(next.parts, delta.partIndex, 'input-available')
        break
      case 'tool_output_streaming':
        break
      case 'tool_output_set':
        updateToolAnchorState(next.parts, delta.partIndex, delta.state)
        break
      case 'metadata_update':
        Object.assign(MessageMetadataCarrierSchema.parse(next), { metadata: delta.metadata })
        break
    }
  }

  return next as UIMessage
}

export function collectChatToolEntityPatches(
  message: UIMessage,
  deltas: ChatPartDelta[],
): ChatToolEntityPatch[] {
  const orderedDeltas = [...deltas].sort((left, right) => left.seq - right.seq)
  const patches: ChatToolEntityPatch[] = []

  for (const delta of orderedDeltas) {
    switch (delta.type) {
      case 'part_add': {
        const toolAnchor = readToolAnchorPart(message.parts, delta.partIndex)
        const part = 'toolCallId' in delta.part ? delta.part : null
        if (!part || !toolAnchor) {
          break
        }
        const toolName = toolAnchor.toolName
        const state = toolAnchor.state
        patches.push({
          partIndex: delta.partIndex,
          toolCallId: toolAnchor.toolCallId,
          updater: entity => ({
            ...entity,
            messageId: message.id,
            toolCallId: toolAnchor.toolCallId,
            toolName,
            state,
          }),
        })
        break
      }
      case 'tool_arguments_append': {
        const toolAnchor = readToolAnchorPart(message.parts, delta.partIndex)
        if (!toolAnchor) {
          break
        }
        patches.push({
          partIndex: delta.partIndex,
          toolCallId: toolAnchor.toolCallId,
          updater: entity => ({
            ...entity,
            messageId: message.id,
            toolCallId: toolAnchor.toolCallId,
            toolName: entity.toolName || toolAnchor.toolName,
            state: entity.state ?? toolAnchor.state,
            argumentsText: `${entity.argumentsText ?? ''}${delta.text}`,
          }),
        })
        break
      }
      case 'tool_input_set': {
        const toolAnchor = readToolAnchorPart(message.parts, delta.partIndex)
        if (!toolAnchor) {
          break
        }
        patches.push({
          partIndex: delta.partIndex,
          toolCallId: toolAnchor.toolCallId,
          updater: entity => ({
            ...entity,
            messageId: message.id,
            toolCallId: toolAnchor.toolCallId,
            toolName: entity.toolName || toolAnchor.toolName,
            state: 'input-available',
            input: delta.input,
          }),
        })
        break
      }
      case 'tool_output_streaming': {
        const toolAnchor = readToolAnchorPart(message.parts, delta.partIndex)
        if (!toolAnchor) {
          break
        }
        patches.push({
          partIndex: delta.partIndex,
          toolCallId: toolAnchor.toolCallId,
          updater: entity => ({
            ...entity,
            messageId: message.id,
            toolCallId: toolAnchor.toolCallId,
            toolName: entity.toolName || toolAnchor.toolName,
            output: `${z.string().parse(entity.output ?? '')}${delta.text}`,
          }),
        })
        break
      }
      case 'tool_output_set': {
        const toolAnchor = readToolAnchorPart(message.parts, delta.partIndex)
        if (!toolAnchor) {
          break
        }
        patches.push({
          partIndex: delta.partIndex,
          toolCallId: toolAnchor.toolCallId,
          updater: entity => ({
            ...entity,
            messageId: message.id,
            toolCallId: toolAnchor.toolCallId,
            toolName: entity.toolName || toolAnchor.toolName,
            state: delta.state,
            output: 'output' in delta ? delta.output : entity.output,
            errorText: delta.errorText,
          }),
        })
        break
      }
      default:
        break
    }
  }

  return patches
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

function updateToolAnchorState(parts: MessagePart[], index: number, state: ToolState): void {
  const part = MutableToolAnchorPartSchema.parse(parts[index])
  part.state = state
}

function clonePart(part: MessagePart): MessagePart {
  return structuredClone(part)
}
