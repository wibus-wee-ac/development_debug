import type { UIMessage, UIMessageChunk } from 'ai'

import { AppError } from '../../errors/app-error'

type MessagePart = UIMessage['parts'][number]

type TextPartKind = 'text' | 'reasoning'
type ToolStreamName = 'stdout' | 'stderr'

export type ChatPartDelta
  = | { seq: number, type: 'part_add', partIndex: number, part: MessagePart }
    | { seq: number, type: 'text_append', partIndex: number, partType: TextPartKind, text: string }
    | { seq: number, type: 'text_done', partIndex: number, partType: TextPartKind }
    | { seq: number, type: 'tool_input_append', partIndex: number, inputKey: string, text: string }
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
  providerMetadata?: unknown
}

interface MutableReasoningPart {
  type: 'reasoning'
  text: string
  state?: 'streaming' | 'done'
  providerMetadata?: unknown
}

interface MutableToolPart {
  type: 'dynamic-tool'
  toolName: string
  toolCallId: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
  callProviderMetadata?: unknown
  resultProviderMetadata?: unknown
}

export interface MessageProjection {
  message: UIMessage
  activeTextPartIndices: Map<string, number>
  activeReasoningPartIndices: Map<string, number>
  toolPartIndices: Map<string, number>
  partialToolInputs: Map<string, string>
}

export interface ProjectionApplyResult {
  deltas: ChatPartDelta[]
  nextSeq: number
  terminal: boolean
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText: string | null
}

export function createMessageProjection(message: UIMessage): MessageProjection {
  const toolPartIndices = new Map<string, number>()
  message.parts.forEach((part, index) => {
    if (isToolPart(part)) {
      toolPartIndices.set(part.toolCallId, index)
    }
  })
  return {
    message: {
      ...message,
      parts: [...message.parts],
    },
    activeTextPartIndices: new Map(),
    activeReasoningPartIndices: new Map(),
    toolPartIndices,
    partialToolInputs: new Map(),
  }
}

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

  const chunkType = chunk.type as string
  switch (chunkType) {
    case 'start': {
      const metadata = (chunk as { messageMetadata?: unknown }).messageMetadata
      if (metadata !== undefined) {
        ;(projection.message as { metadata?: unknown }).metadata = metadata
        push({ type: 'metadata_update', metadata })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'text-start': {
      const id = readChunkId(chunk, 'text')
      if (!projection.activeTextPartIndices.has(id)) {
        const part: MutableTextPart = {
          type: 'text',
          text: '',
          state: 'streaming',
          providerMetadata: readProviderMetadata(chunk),
        }
        const partIndex = projection.message.parts.length
        projection.message.parts.push(part as MessagePart)
        projection.activeTextPartIndices.set(id, partIndex)
        push({ type: 'part_add', partIndex, part: clonePart(part as MessagePart) })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'text-delta': {
      const id = readChunkId(chunk, 'text')
      const partIndex = locateTextPart(projection, id, deltas, push)
      const part = projection.message.parts[partIndex] as unknown as MutableTextPart
      const text = (chunk as { delta?: string }).delta ?? ''
      part.text += text
      const metadata = readProviderMetadata(chunk)
      if (metadata !== undefined) {
        part.providerMetadata = metadata
      }
      if (text.length > 0) {
        push({ type: 'text_append', partIndex, partType: 'text', text })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'text-end': {
      const id = readChunkId(chunk, 'text')
      const partIndex = projection.activeTextPartIndices.get(id)
      if (partIndex !== undefined) {
        const part = projection.message.parts[partIndex] as unknown as MutableTextPart
        part.state = 'done'
        projection.activeTextPartIndices.delete(id)
        push({ type: 'text_done', partIndex, partType: 'text' })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'reasoning-start': {
      const id = readChunkId(chunk, 'reasoning')
      if (!projection.activeReasoningPartIndices.has(id)) {
        const part: MutableReasoningPart = {
          type: 'reasoning',
          text: '',
          state: 'streaming',
          providerMetadata: readProviderMetadata(chunk),
        }
        const partIndex = projection.message.parts.length
        projection.message.parts.push(part as MessagePart)
        projection.activeReasoningPartIndices.set(id, partIndex)
        push({ type: 'part_add', partIndex, part: clonePart(part as MessagePart) })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'reasoning-delta': {
      const id = readChunkId(chunk, 'reasoning')
      const partIndex = locateReasoningPart(projection, id, deltas, push)
      const part = projection.message.parts[partIndex] as unknown as MutableReasoningPart
      const text = (chunk as { delta?: string }).delta ?? ''
      part.text += text
      const metadata = readProviderMetadata(chunk)
      if (metadata !== undefined) {
        part.providerMetadata = metadata
      }
      if (text.length > 0) {
        push({ type: 'text_append', partIndex, partType: 'reasoning', text })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'reasoning-end': {
      const id = readChunkId(chunk, 'reasoning')
      const partIndex = projection.activeReasoningPartIndices.get(id)
      if (partIndex !== undefined) {
        const part = projection.message.parts[partIndex] as unknown as MutableReasoningPart
        part.state = 'done'
        projection.activeReasoningPartIndices.delete(id)
        push({ type: 'text_done', partIndex, partType: 'reasoning' })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-input-start': {
      const toolChunk = chunk as { toolCallId: string, toolName: string }
      const partIndex = locateToolPart(projection, toolChunk.toolCallId, toolChunk.toolName)
      const part = projection.message.parts[partIndex] as unknown as MutableToolPart
      part.state = 'input-streaming'
      const metadata = readProviderMetadata(chunk)
      if (metadata !== undefined) {
        part.callProviderMetadata = metadata
      }
      if (partIndex === projection.message.parts.length - 1 && part.input === undefined && part.output === undefined) {
        push({ type: 'part_add', partIndex, part: clonePart(part as unknown as MessagePart) })
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-input-delta': {
      const toolChunk = chunk as { toolCallId: string, inputTextDelta?: string }
      const partIndex = locateToolPart(projection, toolChunk.toolCallId, 'tool')
      const part = projection.message.parts[partIndex] as unknown as MutableToolPart
      const text = toolChunk.inputTextDelta ?? ''
      if (part.toolName === 'command_execution') {
        part.output = `${typeof part.output === 'string' ? part.output : ''}${text}`
        if (text.length > 0) {
          push({ type: 'tool_output_streaming', partIndex, stream: 'stdout', text })
        }
      }
      else {
        const nextInput = `${projection.partialToolInputs.get(toolChunk.toolCallId) ?? ''}${text}`
        projection.partialToolInputs.set(toolChunk.toolCallId, nextInput)
        part.input = mergeInputAppend(part.input, 'input', text)
        if (text.length > 0) {
          push({ type: 'tool_input_append', partIndex, inputKey: 'input', text })
        }
      }
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-input-available': {
      const toolChunk = chunk as { toolCallId: string, toolName?: string, input: unknown }
      const partIndex = locateToolPart(projection, toolChunk.toolCallId, toolChunk.toolName ?? 'tool')
      const part = projection.message.parts[partIndex] as unknown as MutableToolPart
      part.state = 'input-available'
      part.input = toolChunk.input
      projection.partialToolInputs.delete(toolChunk.toolCallId)
      push({ type: 'tool_input_set', partIndex, input: toolChunk.input })
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-input-error': {
      const toolChunk = chunk as { toolCallId: string, toolName?: string, input?: unknown, errorText: string }
      const partIndex = locateToolPart(projection, toolChunk.toolCallId, toolChunk.toolName ?? 'tool')
      const part = projection.message.parts[partIndex] as unknown as MutableToolPart
      part.state = 'output-error'
      part.input = toolChunk.input
      part.errorText = toolChunk.errorText
      push({ type: 'tool_output_set', partIndex, state: 'output-error', errorText: toolChunk.errorText })
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-output-available': {
      const toolChunk = chunk as { toolCallId: string, output: unknown }
      const partIndex = locateToolPart(projection, toolChunk.toolCallId, 'tool')
      const part = projection.message.parts[partIndex] as unknown as MutableToolPart
      part.state = 'output-available'
      part.output = toolChunk.output
      push({ type: 'tool_output_set', partIndex, state: 'output-available', output: toolChunk.output })
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-output-error': {
      const toolChunk = chunk as { toolCallId: string, errorText: string }
      const partIndex = locateToolPart(projection, toolChunk.toolCallId, 'tool')
      const part = projection.message.parts[partIndex] as unknown as MutableToolPart
      part.state = 'output-error'
      part.errorText = toolChunk.errorText
      push({ type: 'tool_output_set', partIndex, state: 'output-error', errorText: toolChunk.errorText })
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'tool-output-denied': {
      const toolChunk = chunk as { toolCallId: string }
      const partIndex = locateToolPart(projection, toolChunk.toolCallId, 'tool')
      const part = projection.message.parts[partIndex] as unknown as MutableToolPart
      part.state = 'output-denied'
      push({ type: 'tool_output_set', partIndex, state: 'output-denied' })
      return result(deltas, nextSeq, false, 'streaming', null)
    }
    case 'finish':
      closeActiveTextParts(projection, push)
      return result(deltas, nextSeq, true, 'complete', null)
    case 'abort':
      return result(deltas, nextSeq, true, 'aborted', null)
    case 'error':
      return result(deltas, nextSeq, true, 'failed', (chunk as { errorText?: string }).errorText ?? 'Unknown chat error')
    default:
      return result(deltas, nextSeq, false, 'streaming', null)
  }
}

export function applySnapshotToProjection(
  projection: MessageProjection,
  message: UIMessage,
  firstSeq: number,
): ProjectionApplyResult {
  const normalizedMessage = normalizeSnapshotMessage(message)
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
  const prevMetadata = (prevMessage as { metadata?: unknown }).metadata
  const nextMetadata = (normalizedMessage as { metadata?: unknown }).metadata
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

    if (nextPart.type === 'text' || nextPart.type === 'reasoning') {
      const prevText = typeof (prevPart as { text?: unknown }).text === 'string'
        ? (prevPart as { text: string }).text
        : ''
      const nextText = typeof (nextPart as { text?: unknown }).text === 'string'
        ? (nextPart as { text: string }).text
        : ''
      if (nextText.length > prevText.length && nextText.startsWith(prevText)) {
        push({
          type: 'text_append',
          partIndex,
          partType: nextPart.type,
          text: nextText.slice(prevText.length),
        })
      }

      const prevState = (prevPart as { state?: unknown }).state
      const nextState = (nextPart as { state?: unknown }).state
      if (prevState !== 'done' && nextState === 'done') {
        push({ type: 'text_done', partIndex, partType: nextPart.type })
      }
      continue
    }

    if (nextPart.type === 'dynamic-tool') {
      const prevInput = (prevPart as { input?: unknown }).input
      const nextInput = (nextPart as { input?: unknown }).input
      if (!areEqual(prevInput, nextInput) && nextInput !== undefined) {
        push({ type: 'tool_input_set', partIndex, input: cloneValue(nextInput) })
      }

      const prevOutput = (prevPart as { output?: unknown }).output
      const nextOutput = (nextPart as { output?: unknown }).output
      const prevState = (prevPart as { state?: unknown }).state
      const nextState = (nextPart as { state?: unknown }).state
      const prevErrorText = (prevPart as { errorText?: unknown }).errorText
      const nextErrorText = (nextPart as { errorText?: unknown }).errorText
      if (!areEqual(prevOutput, nextOutput) || prevState !== nextState || prevErrorText !== nextErrorText) {
        if (nextState === 'output-available' || nextState === 'output-error' || nextState === 'output-denied') {
          push({
            type: 'tool_output_set',
            partIndex,
            state: nextState,
            output: nextOutput === undefined ? undefined : cloneValue(nextOutput),
            errorText: typeof nextErrorText === 'string' ? nextErrorText : undefined,
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

  return result(deltas, nextSeq, false, 'streaming', null)
}

export function readChunkRouteContext(chunk: UIMessageChunk): ChunkRouteContext {
  const meta = readProviderMetadata(chunk) as { cradle?: { parentToolUseId?: string, taskId?: string } } | undefined
  return {
    parentToolCallId: meta?.cradle?.parentToolUseId ?? null,
    taskId: meta?.cradle?.taskId ?? null,
  }
}

export function createAssistantMessage(messageId: string, parts: UIMessage['parts'] = []): UIMessage {
  return {
    id: messageId,
    role: 'assistant',
    parts,
  }
}

export function createUserMessage(messageId: string, text: string): UIMessage {
  return {
    id: messageId,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

export function parseMessageJson(messageId: string, role: 'user' | 'assistant', value: string): UIMessage {
  let parsed: unknown

  try {
    parsed = JSON.parse(value) as UIMessage
  }
  catch (error) {
    throw invalidSnapshotError(messageId, role, 'message_json is not valid JSON', error)
  }

  if (!isUiMessageSnapshot(parsed)) {
    throw invalidSnapshotError(messageId, role, 'message_json must be a UIMessage-like object with id, role, and parts')
  }

  if (parsed.id !== messageId) {
    throw invalidSnapshotError(messageId, role, 'message_json.id must match messages.id')
  }

  if (parsed.role !== role) {
    throw invalidSnapshotError(messageId, role, 'message_json.role must match messages.role')
  }

  return parsed
}

export function extractMessageText(message: UIMessage): string {
  return message.parts
    .flatMap(part => part.type === 'text' ? [(part as { text?: string }).text ?? ''] : [])
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
    const part = projection.message.parts[partIndex] as unknown as MutableTextPart
    part.state = 'done'
    projection.activeTextPartIndices.delete(id)
    push({ type: 'text_done', partIndex, partType: 'text' })
  }

  for (const [id, partIndex] of projection.activeReasoningPartIndices) {
    const part = projection.message.parts[partIndex] as unknown as MutableReasoningPart
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
  projection.message.parts.push(part as MessagePart)
  projection.activeTextPartIndices.set(id, partIndex)
  push({ type: 'part_add', partIndex, part: clonePart(part as MessagePart) })
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
  projection.message.parts.push(part as MessagePart)
  projection.activeReasoningPartIndices.set(id, partIndex)
  push({ type: 'part_add', partIndex, part: clonePart(part as MessagePart) })
  return partIndex
}

function locateToolPart(projection: MessageProjection, toolCallId: string, toolName: string): number {
  const existing = projection.toolPartIndices.get(toolCallId)
  if (existing !== undefined) {
    return existing
  }
  const part: MutableToolPart = {
    type: 'dynamic-tool',
    toolName,
    toolCallId,
    state: 'input-streaming',
    input: undefined,
  }
  const partIndex = projection.message.parts.length
  projection.message.parts.push(part as unknown as MessagePart)
  projection.toolPartIndices.set(toolCallId, partIndex)
  return partIndex
}

function mergeInputAppend(input: unknown, inputKey: string, text: string): Record<string, unknown> {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const current = input as Record<string, unknown>
    return {
      ...current,
      [inputKey]: `${typeof current[inputKey] === 'string' ? current[inputKey] : ''}${text}`,
    }
  }
  return { [inputKey]: text }
}

function isToolPart(part: MessagePart): part is MessagePart & { toolCallId: string } {
  return typeof part === 'object' && part !== null && 'toolCallId' in part && typeof (part as { toolCallId?: unknown }).toolCallId === 'string'
}

function readChunkId(chunk: UIMessageChunk, fallback: string): string {
  const id = (chunk as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : fallback
}

function readProviderMetadata(chunk: UIMessageChunk): unknown {
  return 'providerMetadata' in chunk ? (chunk as { providerMetadata?: unknown }).providerMetadata : undefined
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

function isUiMessageSnapshot(value: unknown): value is UIMessage {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && Array.isArray(value.parts)
    && value.parts.every(isMessagePartLike)
}

function isMessagePartLike(value: unknown): boolean {
  return isRecord(value) && typeof value.type === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clonePart(part: MessagePart): MessagePart {
  return typeof structuredClone === 'function'
    ? structuredClone(part)
    : JSON.parse(JSON.stringify(part)) as MessagePart
}

function normalizeSnapshotMessage(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.filter(part => part.type === 'text' || part.type === 'reasoning' || part.type === 'dynamic-tool'),
  }
}

function cloneMessage(message: UIMessage): UIMessage {
  return typeof structuredClone === 'function'
    ? structuredClone(message)
    : JSON.parse(JSON.stringify(message)) as UIMessage
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function areEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right)
  }
  catch {
    return false
  }
}
