import type { ProviderMetadata, UIMessage, UIMessageChunk } from 'ai'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'

type MessagePart = UIMessage['parts'][number]
type FileMessagePart = Extract<MessagePart, { type: 'file' }>

type TextPartKind = 'text' | 'reasoning'
type ToolStreamName = 'stdout' | 'stderr'

export type ChatPartDelta
  = | { seq: number, type: 'part_add', partIndex: number, part: MessagePart }
    | { seq: number, type: 'text_append', partIndex: number, partType: TextPartKind, text: string }
    | { seq: number, type: 'text_done', partIndex: number, partType: TextPartKind }
    | { seq: number, type: 'tool_arguments_append', partIndex: number, text: string }
    | { seq: number, type: 'tool_input_set', partIndex: number, input: unknown }
    | { seq: number, type: 'tool_output_streaming', partIndex: number, stream: ToolStreamName, text: string }
    | { seq: number, type: 'tool_output_set', partIndex: number, output?: unknown, state: 'output-available' | 'output-error' | 'output-denied', errorText?: string }
    | { seq: number, type: 'metadata_update', metadata: unknown }

type UnsequencedChatPartDelta = ChatPartDelta extends infer Delta
  ? Delta extends { seq: number }
    ? Omit<Delta, 'seq'>
    : never
  : never

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

export interface ChunkRouteContext {
  parentToolCallId: string | null
  taskId: string | null
}

interface MutableTextPart {
  type: 'text'
  text: string
  state?: 'streaming' | 'done'
  providerMetadata?: ProviderMetadata
}

interface MutableReasoningPart {
  type: 'reasoning'
  text: string
  state?: 'streaming' | 'done'
  providerMetadata?: ProviderMetadata
}

interface MutableToolPart {
  type: 'dynamic-tool'
  toolName: string
  toolCallId: string
  state: string
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
  callProviderMetadata?: ProviderMetadata
  resultProviderMetadata?: ProviderMetadata
}

const ProviderMetadataSchema = z.custom<ProviderMetadata>()

const TextMessagePartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  state: z.enum(['streaming', 'done']).optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
}).passthrough()

const ReasoningMessagePartSchema = z.object({
  type: z.literal('reasoning'),
  text: z.string(),
  state: z.enum(['streaming', 'done']).optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
}).passthrough()

const DynamicToolMessagePartSchema = z.object({
  type: z.literal('dynamic-tool'),
  toolName: z.string().min(1),
  toolCallId: z.string().min(1),
  state: z.string(),
  argumentsText: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  errorText: z.string().optional(),
  callProviderMetadata: ProviderMetadataSchema.optional(),
  resultProviderMetadata: ProviderMetadataSchema.optional(),
}).passthrough()

const FileMessagePartSchema = z.object({
  type: z.literal('file'),
  mediaType: z.string().min(1),
  filename: z.string().optional(),
  url: z.string().min(1),
  providerMetadata: ProviderMetadataSchema.optional(),
}).passthrough()

const MessagePartSchema = z.discriminatedUnion('type', [
  TextMessagePartSchema,
  ReasoningMessagePartSchema,
  DynamicToolMessagePartSchema,
  FileMessagePartSchema,
])
type ParsedMessagePart = z.infer<typeof MessagePartSchema>
const UiMessagePartSchema = MessagePartSchema.transform(part => part as MessagePart)
const MessageMetadataCarrierSchema = z.object({
  metadata: z.unknown().optional(),
}).passthrough()
const MutableTextPartSchema = z.custom<MutableTextPart>((part) => {
  TextMessagePartSchema.parse(part)
  return true
})
const MutableReasoningPartSchema = z.custom<MutableReasoningPart>((part) => {
  ReasoningMessagePartSchema.parse(part)
  return true
})
const MutableToolPartSchema = z.custom<MutableToolPart>((part) => {
  DynamicToolMessagePartSchema.parse(part)
  return true
})

const SnapshotTextDeltaPartSchema = z.object({
  type: z.literal('text-delta'),
  delta: z.string(),
}).passthrough().transform(({ type: _type, delta, ...part }) => ({
  ...part,
  type: 'text' as const,
  text: delta,
}))

const SnapshotTextStartPartSchema = z.object({
  type: z.literal('text-start'),
  text: z.string().default(''),
}).passthrough().transform(({ type: _type, ...part }) => ({
  ...part,
  type: 'text' as const,
}))

const SnapshotTextEndPartSchema = z.object({
  type: z.literal('text-end'),
  text: z.string().default(''),
}).passthrough().transform(({ type: _type, ...part }) => ({
  ...part,
  type: 'text' as const,
  state: 'done' as const,
}))

const SnapshotReasoningDeltaPartSchema = z.object({
  type: z.literal('reasoning-delta'),
  delta: z.string(),
}).passthrough().transform(({ type: _type, delta, ...part }) => ({
  ...part,
  type: 'reasoning' as const,
  text: delta,
}))

const SnapshotReasoningStartPartSchema = z.object({
  type: z.literal('reasoning-start'),
  text: z.string().default(''),
}).passthrough().transform(({ type: _type, ...part }) => ({
  ...part,
  type: 'reasoning' as const,
}))

const SnapshotReasoningEndPartSchema = z.object({
  type: z.literal('reasoning-end'),
  text: z.string().default(''),
}).passthrough().transform(({ type: _type, ...part }) => ({
  ...part,
  type: 'reasoning' as const,
  state: 'done' as const,
}))

const SnapshotMessagePartSchema = z.union([
  MessagePartSchema,
  SnapshotTextDeltaPartSchema,
  SnapshotTextStartPartSchema,
  SnapshotTextEndPartSchema,
  SnapshotReasoningDeltaPartSchema,
  SnapshotReasoningStartPartSchema,
  SnapshotReasoningEndPartSchema,
])

const SnapshotMessagePartsSchema = z.array(
  z.union([
    z.object({ type: z.enum(['step-start', 'step-finish']) }).passthrough().transform(() => null),
    SnapshotMessagePartSchema,
  ]),
).transform(parts => parts.filter((part): part is z.infer<typeof SnapshotMessagePartSchema> => part !== null))

export const UiMessageSnapshotSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(MessagePartSchema),
  metadata: z.unknown().optional(),
}).passthrough()

const NormalizedUiMessageSnapshotSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  parts: SnapshotMessagePartsSchema,
  metadata: z.unknown().optional(),
}).passthrough()

export const UiMessageSnapshotJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(UiMessageSnapshotSchema)

const ChunkRouteProviderMetadataSchema = z.object({
  cradle: z.object({
    parentToolUseId: z.string().nullable().default(null),
    taskId: z.string().nullable().default(null),
  }).default({ parentToolUseId: null, taskId: null }),
}).passthrough().default({ cradle: { parentToolUseId: null, taskId: null } })

export interface MessageProjection {
  message: UIMessage
  activeTextPartIndices: Map<string, number>
  activeReasoningPartIndices: Map<string, number>
  toolPartIndices: Map<string, number>
  partialToolInputs: Map<string, string>
  partialToolOutputs: Map<string, string>
}

export interface ProjectionApplyResult {
  deltas: ChatPartDelta[]
  nextSeq: number
  terminal: boolean
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText: string | null
}

export function createMessageProjection(message: UIMessage): MessageProjection {
  const parsedMessage = z.custom<UIMessage>().parse(UiMessageSnapshotSchema.parse(message))
  const toolPartIndices = new Map<string, number>()
  parsedMessage.parts.forEach((part, index) => {
    if (part.type === 'dynamic-tool') {
      toolPartIndices.set(part.toolCallId, index)
    }
  })
  return {
    message: {
      ...parsedMessage,
      parts: [...parsedMessage.parts],
    },
    activeTextPartIndices: new Map(),
    activeReasoningPartIndices: new Map(),
    toolPartIndices,
    partialToolInputs: new Map(),
    partialToolOutputs: new Map(),
  }
}

const ProviderMetadataCarrierSchema = z.object({
  providerMetadata: ProviderMetadataSchema.optional(),
}).passthrough()

const StartChunkSchema = z.object({
  type: z.literal('start'),
  messageMetadata: z.unknown().optional(),
}).passthrough()

const TextStartChunkSchema = ProviderMetadataCarrierSchema.extend({
  type: z.literal('text-start'),
  id: z.string().min(1).default('text'),
})

const TextDeltaChunkSchema = ProviderMetadataCarrierSchema.extend({
  type: z.literal('text-delta'),
  id: z.string().min(1).default('text'),
  delta: z.string().default(''),
})

const TextEndChunkSchema = z.object({
  type: z.literal('text-end'),
  id: z.string().min(1).default('text'),
}).passthrough()

const ReasoningStartChunkSchema = ProviderMetadataCarrierSchema.extend({
  type: z.literal('reasoning-start'),
  id: z.string().min(1).default('reasoning'),
})

const ReasoningDeltaChunkSchema = ProviderMetadataCarrierSchema.extend({
  type: z.literal('reasoning-delta'),
  id: z.string().min(1).default('reasoning'),
  delta: z.string().default(''),
})

const ReasoningEndChunkSchema = z.object({
  type: z.literal('reasoning-end'),
  id: z.string().min(1).default('reasoning'),
}).passthrough()

const ToolInputStartChunkSchema = ProviderMetadataCarrierSchema.extend({
  type: z.literal('tool-input-start'),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
})

const ToolInputDeltaChunkSchema = z.object({
  type: z.literal('tool-input-delta'),
  toolCallId: z.string().min(1),
  inputTextDelta: z.string().default(''),
}).passthrough()

const ToolInputAvailableChunkSchema = z.object({
  type: z.literal('tool-input-available'),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1).default('tool'),
  input: z.unknown(),
}).passthrough()

const ToolInputErrorChunkSchema = z.object({
  type: z.literal('tool-input-error'),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1).default('tool'),
  input: z.unknown().optional(),
  errorText: z.string(),
}).passthrough()

const ToolOutputAvailableChunkSchema = z.object({
  type: z.literal('tool-output-available'),
  toolCallId: z.string().min(1),
  output: z.unknown(),
}).passthrough()

const ToolOutputErrorChunkSchema = z.object({
  type: z.literal('tool-output-error'),
  toolCallId: z.string().min(1),
  errorText: z.string(),
}).passthrough()

const ToolOutputDeniedChunkSchema = z.object({
  type: z.literal('tool-output-denied'),
  toolCallId: z.string().min(1),
}).passthrough()

const FinishChunkSchema = z.object({ type: z.literal('finish') }).passthrough()
const AbortChunkSchema = z.object({ type: z.literal('abort') }).passthrough()
const ErrorChunkSchema = z.object({
  type: z.literal('error'),
  errorText: z.string().default('Unknown chat error'),
}).passthrough()

const ChatChunkSchema = z.discriminatedUnion('type', [
  StartChunkSchema,
  TextStartChunkSchema,
  TextDeltaChunkSchema,
  TextEndChunkSchema,
  ReasoningStartChunkSchema,
  ReasoningDeltaChunkSchema,
  ReasoningEndChunkSchema,
  ToolInputStartChunkSchema,
  ToolInputDeltaChunkSchema,
  ToolInputAvailableChunkSchema,
  ToolInputErrorChunkSchema,
  ToolOutputAvailableChunkSchema,
  ToolOutputErrorChunkSchema,
  ToolOutputDeniedChunkSchema,
  FinishChunkSchema,
  AbortChunkSchema,
  ErrorChunkSchema,
])

export function applyChunkToProjection(
  projection: MessageProjection,
  chunk: UIMessageChunk,
  firstSeq: number,
): ProjectionApplyResult {
  const deltas: ChatPartDelta[] = []
  let nextSeq = firstSeq
  const push = (delta: UnsequencedChatPartDelta) => {
    deltas.push({ ...delta, seq: nextSeq } as ChatPartDelta)
    nextSeq += 1
  }

  const parsedChunk = ChatChunkSchema.parse(chunk)
  switch (parsedChunk.type) {
    case 'start': {
      const metadata = parsedChunk.messageMetadata
      if (metadata !== undefined) {
        Object.assign(MessageMetadataCarrierSchema.parse(projection.message), { metadata })
        push({ type: 'metadata_update', metadata })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'text-start': {
      const id = parsedChunk.id
      if (!projection.activeTextPartIndices.has(id)) {
        const part: MutableTextPart = {
          type: 'text',
          text: '',
          state: 'streaming',
          providerMetadata: parsedChunk.providerMetadata,
        }
        const partIndex = projection.message.parts.length
        projection.message.parts.push(UiMessagePartSchema.parse(part))
        projection.activeTextPartIndices.set(id, partIndex)
        push({ type: 'part_add', partIndex, part: clonePart(UiMessagePartSchema.parse(part)) })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'text-delta': {
      const id = parsedChunk.id
      const partIndex = locateTextPart(projection, id, deltas, push)
      const part = MutableTextPartSchema.parse(projection.message.parts[partIndex])
      const text = parsedChunk.delta
      part.text += text
      const metadata = parsedChunk.providerMetadata
      if (metadata !== undefined) {
        part.providerMetadata = metadata
      }
      if (text.length > 0) {
        push({ type: 'text_append', partIndex, partType: 'text', text })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'text-end': {
      const id = parsedChunk.id
      const partIndex = projection.activeTextPartIndices.get(id)
      if (partIndex !== undefined) {
        const part = MutableTextPartSchema.parse(projection.message.parts[partIndex])
        part.state = 'done'
        projection.activeTextPartIndices.delete(id)
        push({ type: 'text_done', partIndex, partType: 'text' })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'reasoning-start': {
      const id = parsedChunk.id
      if (!projection.activeReasoningPartIndices.has(id)) {
        const part: MutableReasoningPart = {
          type: 'reasoning',
          text: '',
          state: 'streaming',
          providerMetadata: parsedChunk.providerMetadata,
        }
        const partIndex = projection.message.parts.length
        projection.message.parts.push(UiMessagePartSchema.parse(part))
        projection.activeReasoningPartIndices.set(id, partIndex)
        push({ type: 'part_add', partIndex, part: clonePart(UiMessagePartSchema.parse(part)) })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'reasoning-delta': {
      const id = parsedChunk.id
      const partIndex = locateReasoningPart(projection, id, deltas, push)
      const part = MutableReasoningPartSchema.parse(projection.message.parts[partIndex])
      const text = parsedChunk.delta
      part.text += text
      const metadata = parsedChunk.providerMetadata
      if (metadata !== undefined) {
        part.providerMetadata = metadata
      }
      if (text.length > 0) {
        push({ type: 'text_append', partIndex, partType: 'reasoning', text })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'reasoning-end': {
      const id = parsedChunk.id
      const partIndex = projection.activeReasoningPartIndices.get(id)
      if (partIndex !== undefined) {
        const part = MutableReasoningPartSchema.parse(projection.message.parts[partIndex])
        part.state = 'done'
        projection.activeReasoningPartIndices.delete(id)
        push({ type: 'text_done', partIndex, partType: 'reasoning' })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-input-start': {
      const { partIndex, created } = locateToolPart(projection, parsedChunk.toolCallId, parsedChunk.toolName)
      const part = MutableToolPartSchema.parse(projection.message.parts[partIndex])
      part.state = 'input-streaming'
      if (parsedChunk.toolName === 'command_execution') {
        projection.partialToolOutputs.set(parsedChunk.toolCallId, '')
        part.output = ''
      }
      else {
        projection.partialToolInputs.set(parsedChunk.toolCallId, '')
        part.argumentsText = ''
        delete part.input
      }
      const metadata = parsedChunk.providerMetadata
      if (metadata !== undefined) {
        part.callProviderMetadata = metadata
      }
      if (created) {
        push({ type: 'part_add', partIndex, part: clonePart(UiMessagePartSchema.parse(part)) })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-input-delta': {
      const { partIndex } = locateToolPart(projection, parsedChunk.toolCallId, 'tool')
      const part = MutableToolPartSchema.parse(projection.message.parts[partIndex])
      const text = parsedChunk.inputTextDelta
      if (part.toolName === 'command_execution') {
        const nextOutput = appendPartialText(projection.partialToolOutputs, parsedChunk.toolCallId, text)
        part.output = nextOutput
        if (text.length > 0) {
          push({ type: 'tool_output_streaming', partIndex, stream: 'stdout', text })
        }
      }
      else {
        const nextInput = appendPartialText(projection.partialToolInputs, parsedChunk.toolCallId, text)
        part.argumentsText = nextInput
        if (text.length > 0) {
          push({ type: 'tool_arguments_append', partIndex, text })
        }
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-input-available': {
      const { partIndex } = locateToolPart(projection, parsedChunk.toolCallId, parsedChunk.toolName)
      const part = MutableToolPartSchema.parse(projection.message.parts[partIndex])
      part.state = 'input-available'
      part.input = parsedChunk.input
      projection.partialToolInputs.delete(parsedChunk.toolCallId)
      push({ type: 'tool_input_set', partIndex, input: parsedChunk.input })
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-input-error': {
      const { partIndex } = locateToolPart(projection, parsedChunk.toolCallId, parsedChunk.toolName)
      const part = MutableToolPartSchema.parse(projection.message.parts[partIndex])
      part.state = 'output-error'
      part.input = parsedChunk.input
      part.errorText = parsedChunk.errorText
      push({ type: 'tool_output_set', partIndex, state: 'output-error', errorText: parsedChunk.errorText })
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-output-available': {
      const { partIndex } = locateToolPart(projection, parsedChunk.toolCallId, 'tool')
      const part = MutableToolPartSchema.parse(projection.message.parts[partIndex])
      part.state = 'output-available'
      part.output = parsedChunk.output
      projection.partialToolOutputs.delete(parsedChunk.toolCallId)
      push({ type: 'tool_output_set', partIndex, state: 'output-available', output: parsedChunk.output })
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-output-error': {
      const { partIndex } = locateToolPart(projection, parsedChunk.toolCallId, 'tool')
      const part = MutableToolPartSchema.parse(projection.message.parts[partIndex])
      part.state = 'output-error'
      part.errorText = parsedChunk.errorText
      projection.partialToolOutputs.delete(parsedChunk.toolCallId)
      push({ type: 'tool_output_set', partIndex, state: 'output-error', errorText: parsedChunk.errorText })
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-output-denied': {
      const { partIndex } = locateToolPart(projection, parsedChunk.toolCallId, 'tool')
      const part = MutableToolPartSchema.parse(projection.message.parts[partIndex])
      part.state = 'output-denied'
      projection.partialToolOutputs.delete(parsedChunk.toolCallId)
      push({ type: 'tool_output_set', partIndex, state: 'output-denied' })
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'finish':
      closeActiveTextParts(projection, push)
      return result(deltas, nextSeq, true, 'complete', null)
    case 'abort':
      return result(deltas, nextSeq, true, 'aborted', null)
    case 'error':
      return result(deltas, nextSeq, true, 'failed', parsedChunk.errorText)
  }
}

export function applySnapshotToProjection(
  projection: MessageProjection,
  message: UIMessage,
  firstSeq: number,
): ProjectionApplyResult {
  const normalizedMessage = normalizeMessageSnapshot(message)
  const projectedRole = projection.message.role as 'user' | 'assistant'

  if (normalizedMessage.id !== projection.message.id) {
    throw invalidSnapshotError(normalizedMessage.id, projectedRole, 'streamed snapshot id must match projected message id')
  }

  if (normalizedMessage.role !== projection.message.role) {
    throw invalidSnapshotError(normalizedMessage.id, projectedRole, 'streamed snapshot role must match projected message role')
  }

  const deltas: ChatPartDelta[] = []
  let nextSeq = firstSeq
  const push = (delta: UnsequencedChatPartDelta) => {
    deltas.push({ ...delta, seq: nextSeq } as ChatPartDelta)
    nextSeq += 1
  }

  const prevMessage = projection.message
  const prevMetadata = MessageMetadataCarrierSchema.parse(prevMessage).metadata
  const nextMetadata = MessageMetadataCarrierSchema.parse(normalizedMessage).metadata
  if (!areEqual(prevMetadata, nextMetadata) && nextMetadata !== undefined) {
    push({ type: 'metadata_update', metadata: cloneValue(nextMetadata) })
  }

  const maxParts = Math.max(prevMessage.parts.length, normalizedMessage.parts.length)
  for (let partIndex = 0; partIndex < maxParts; partIndex += 1) {
    const prevPart = prevMessage.parts[partIndex]
    const nextPart = normalizedMessage.parts[partIndex]

    if (!nextPart) {
      continue
    }

    if (!prevPart) {
      push({ type: 'part_add', partIndex, part: clonePart(nextPart) })
      continue
    }

    if (prevPart.type !== nextPart.type) {
      continue
    }

    if (nextPart.type === 'text') {
      const previousPart = TextMessagePartSchema.parse(prevPart)
      if (nextPart.text.length > previousPart.text.length && nextPart.text.startsWith(previousPart.text)) {
        push({
          type: 'text_append',
          partIndex,
          partType: 'text',
          text: nextPart.text.slice(previousPart.text.length),
        })
      }

      if (previousPart.state !== 'done' && nextPart.state === 'done') {
        push({ type: 'text_done', partIndex, partType: 'text' })
      }
      continue
    }

    if (nextPart.type === 'reasoning') {
      const previousPart = ReasoningMessagePartSchema.parse(prevPart)
      if (nextPart.text.length > previousPart.text.length && nextPart.text.startsWith(previousPart.text)) {
        push({
          type: 'text_append',
          partIndex,
          partType: 'reasoning',
          text: nextPart.text.slice(previousPart.text.length),
        })
      }

      if (previousPart.state !== 'done' && nextPart.state === 'done') {
        push({ type: 'text_done', partIndex, partType: 'reasoning' })
      }
      continue
    }

    if (nextPart.type === 'dynamic-tool') {
      const previousPart = DynamicToolMessagePartSchema.parse(prevPart)
      const currentPart = DynamicToolMessagePartSchema.parse(nextPart)
      if (
        typeof currentPart.argumentsText === 'string'
        && currentPart.argumentsText.length > (previousPart.argumentsText?.length ?? 0)
        && currentPart.argumentsText.startsWith(previousPart.argumentsText ?? '')
      ) {
        push({
          type: 'tool_arguments_append',
          partIndex,
          text: currentPart.argumentsText.slice(previousPart.argumentsText?.length ?? 0),
        })
      }

      if (!areEqual(previousPart.input, currentPart.input) && currentPart.input !== undefined) {
        push({ type: 'tool_input_set', partIndex, input: cloneValue(currentPart.input) })
      }

      if (!areEqual(previousPart.output, currentPart.output) || previousPart.state !== currentPart.state || previousPart.errorText !== currentPart.errorText) {
        if (currentPart.state === 'output-available' || currentPart.state === 'output-error' || currentPart.state === 'output-denied') {
          push({
            type: 'tool_output_set',
            partIndex,
            state: currentPart.state,
            output: currentPart.output === undefined ? undefined : cloneValue(currentPart.output),
            errorText: currentPart.errorText,
          })
        }
      }
    }
  }

  const nextProjection = createMessageProjection(cloneMessage(normalizedMessage))
  projection.message = nextProjection.message
  projection.activeTextPartIndices.clear()
  projection.activeReasoningPartIndices.clear()
  projection.toolPartIndices = nextProjection.toolPartIndices
  projection.partialToolInputs.clear()
  projection.partialToolOutputs.clear()

  return result(deltas, nextSeq, false, 'streaming', null)
}

export function normalizeMessageSnapshot(message: UIMessage): UIMessage {
  return z.custom<UIMessage>().parse(NormalizedUiMessageSnapshotSchema.parse(message))
}

export function readChunkRouteContext(chunk: UIMessageChunk): ChunkRouteContext {
  const metadataCarrier = ProviderMetadataCarrierSchema.parse(chunk)
  const meta = ChunkRouteProviderMetadataSchema.parse(metadataCarrier.providerMetadata)
  return {
    parentToolCallId: meta.cradle.parentToolUseId,
    taskId: meta.cradle.taskId,
  }
}

export function createAssistantMessage(messageId: string, parts: UIMessage['parts'] = []): UIMessage {
  return {
    id: messageId,
    role: 'assistant',
    parts,
  }
}

export function createUserMessage(messageId: string, text: string, files: FileMessagePart[] = []): UIMessage {
  const parts: UIMessage['parts'] = text ? [{ type: 'text', text }] : []
  parts.push(...files)

  return {
    id: messageId,
    role: 'user',
    parts,
  }
}

export function extractMessageText(message: UIMessage): string {
  const parsedMessage = normalizeMessageSnapshot(message)
  return parsedMessage.parts
    .flatMap(part => part.type === 'text' ? [part.text] : [])
    .join('')
}

function result(
  deltas: ChatPartDelta[],
  nextSeq: number,
  terminal: boolean,
  status: 'streaming' | 'complete' | 'aborted' | 'failed',
  errorText: string | null,
): ProjectionApplyResult {
  return { deltas, nextSeq, terminal, status, errorText }
}

function closeActiveTextParts(
  projection: MessageProjection,
  push: (delta: UnsequencedChatPartDelta) => void,
): void {
  for (const [id, partIndex] of projection.activeTextPartIndices) {
    const part = MutableTextPartSchema.parse(projection.message.parts[partIndex])
    part.state = 'done'
    projection.activeTextPartIndices.delete(id)
    push({ type: 'text_done', partIndex, partType: 'text' })
  }

  for (const [id, partIndex] of projection.activeReasoningPartIndices) {
    const part = MutableReasoningPartSchema.parse(projection.message.parts[partIndex])
    part.state = 'done'
    projection.activeReasoningPartIndices.delete(id)
    push({ type: 'text_done', partIndex, partType: 'reasoning' })
  }
}

function locateTextPart(
  projection: MessageProjection,
  id: string,
  deltas: ChatPartDelta[],
  push: (delta: UnsequencedChatPartDelta) => void,
): number {
  const existing = projection.activeTextPartIndices.get(id)
  if (existing !== undefined) {
    return existing
  }
  const part: MutableTextPart = { type: 'text', text: '', state: 'streaming' }
  const partIndex = projection.message.parts.length
  projection.message.parts.push(UiMessagePartSchema.parse(part))
  projection.activeTextPartIndices.set(id, partIndex)
  push({ type: 'part_add', partIndex, part: clonePart(UiMessagePartSchema.parse(part)) })
  return partIndex
}

function locateReasoningPart(
  projection: MessageProjection,
  id: string,
  deltas: ChatPartDelta[],
  push: (delta: UnsequencedChatPartDelta) => void,
): number {
  const existing = projection.activeReasoningPartIndices.get(id)
  if (existing !== undefined) {
    return existing
  }
  const part: MutableReasoningPart = { type: 'reasoning', text: '', state: 'streaming' }
  const partIndex = projection.message.parts.length
  projection.message.parts.push(UiMessagePartSchema.parse(part))
  projection.activeReasoningPartIndices.set(id, partIndex)
  push({ type: 'part_add', partIndex, part: clonePart(UiMessagePartSchema.parse(part)) })
  return partIndex
}

function locateToolPart(
  projection: MessageProjection,
  toolCallId: string,
  toolName: string,
): { partIndex: number, created: boolean } {
  const existing = projection.toolPartIndices.get(toolCallId)
  if (existing !== undefined) {
    return { partIndex: existing, created: false }
  }
  const part: MutableToolPart = {
    type: 'dynamic-tool',
    toolName,
    toolCallId,
    state: 'input-streaming',
    input: undefined,
  }
  const partIndex = projection.message.parts.length
  projection.message.parts.push(UiMessagePartSchema.parse(part))
  projection.toolPartIndices.set(toolCallId, partIndex)
  return { partIndex, created: true }
}

function appendPartialText(buffer: Map<string, string>, toolCallId: string, text: string): string {
  const current = buffer.get(toolCallId)
  if (current === undefined) {
    throw invalidProjectionStateError(toolCallId, 'tool input delta arrived before the input stream was started')
  }

  const next = `${current}${text}`
  buffer.set(toolCallId, next)
  return next
}

function invalidSnapshotError(messageId: string, role: 'user' | 'assistant', reason: string, cause?: unknown): AppError {
  return new AppError({
    code: 'chat_message_snapshot_invalid',
    status: 500,
    message: 'Stored chat message snapshot is invalid',
    details: {
      messageId,
      role,
      reason,
      ...(cause instanceof Error ? { cause: cause.message } : {}),
    },
  })
}

function invalidProjectionStateError(toolCallId: string, reason: string): AppError {
  return new AppError({
    code: 'chat_projection_state_invalid',
    status: 500,
    message: 'Chat projection state is invalid',
    details: {
      toolCallId,
      reason,
    },
  })
}

function clonePart(part: MessagePart): MessagePart {
  return structuredClone(part)
}

function cloneMessage(message: UIMessage): UIMessage {
  return structuredClone(message)
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function areEqual(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right)
}
