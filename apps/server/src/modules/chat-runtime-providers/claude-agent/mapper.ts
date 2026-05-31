import { randomUUID } from 'node:crypto'

import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage, SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderMetadata } from 'ai'
import type { UIMessage, UIMessageChunk } from 'ai'

import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import { createClaudeCodeToolInputPayload, createClaudeCodeToolResultPayload } from './tools/mapper'
import { isTodoWriteToolName, synthesizeTodoWritePluginState } from './tools/todo-plugin-state'

interface BetaContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
}

interface BetaRawContentBlockDeltaEvent {
  type: 'content_block_delta'
  index: number
  delta: {
    type: string
    text?: string
    thinking?: string
    partial_json?: string
  }
}

interface BetaRawContentBlockStartEvent {
  type: 'content_block_start'
  index: number
  content_block: BetaContentBlock
}

export interface ClaudeAgentChunkMapperState {
  textItemId: string
  assistantStarted: boolean
  /** True when tool calls have been emitted since last text segment — next text gets a fresh ID */
  hadToolCallSinceLastText: boolean
  /** Tracks emitted text per text segment so full assistant snapshots do not replay streamed text. */
  emittedTextByTextItemId: Map<string, TextAccumulator>
  /** Tracks emitted tool lifecycle fragments so full assistant snapshots do not replay streamed tool blocks. */
  emittedToolStateByToolCallId: Map<string, { started: boolean, inputAvailable: boolean }>
  /** Maps content block index → tool_use block ID for streaming tool input deltas */
  activeToolBlockIds: Map<number, string>
  /** Tracks tool names by call ID so result messages can read adapter-owned semantics. */
  toolNamesByToolCallId: Map<string, string>
  /** Accumulates streaming JSON input for tool_use blocks until a full snapshot arrives. */
  toolInputTextByToolCallId: Map<string, TextAccumulator>
  /** Caches Cradle-owned tool args by tool call so results can carry a stable tool envelope. */
  toolArgsByToolCallId: Map<string, unknown>
  /** Accumulated child-agent stream state keyed by parent tool call. */
  subagentStreams: Map<string, ClaudeAgentSubagentStreamState>
}

interface ClaudeAgentSubagentStreamState {
  message: UIMessage | null
  mapperState: ClaudeAgentChunkMapperState
  projector: ClaudeAgentSubagentProjectorState
  chunkCount: number
  emittedChunkCount: number
}

interface ClaudeAgentSubagentProjectorState {
  activeTextParts: Map<string, ProjectedTextPart<MutableTextPart>>
  activeReasoningParts: Map<string, ProjectedTextPart<MutableReasoningPart>>
  partialToolCalls: Map<string, ProjectedPartialToolCall>
}

type MutableTextPart = Extract<UIMessage['parts'][number], { type: 'text' }>
type MutableReasoningPart = Extract<UIMessage['parts'][number], { type: 'reasoning' }>
type MutableToolPart = Extract<UIMessage['parts'][number], { toolCallId: string }>

interface TextAccumulator {
  parts: string[]
  length: number
}

interface ProjectedTextPart<TPart extends MutableTextPart | MutableReasoningPart> {
  part: TPart
  deltas: string[]
}

interface ProjectedPartialToolCall {
  deltas: string[]
  toolName: string
  dynamic?: boolean
  title?: string
}

interface ClaudeAgentSubagentOutput {
  type: 'cradle.subagent-output.v1'
  message: UIMessage
  result?: unknown
  truncated?: boolean
}

const PRELIMINARY_SUBAGENT_TEXT_LIMIT = 64 * 1024

export interface ClaudeAgentChunkMapperResult {
  chunks: UIMessageChunk[]
  sessionId: string | null
  usage: TokenUsage | null
}

export async function mapClaudeAgentMessageToChunks(msg: SDKMessage, state: ClaudeAgentChunkMapperState): Promise<ClaudeAgentChunkMapperResult> {
  normalizeClaudeAgentChunkMapperState(state)
  const parentToolUseId = 'parent_tool_use_id' in msg ? (msg as { parent_tool_use_id: string | null }).parent_tool_use_id : null
  if (parentToolUseId) {
    const streamState = subagentStreamState(parentToolUseId, state)
    const result = await mapClaudeAgentMessageToChunksWithoutParentProjection(msg, streamState.mapperState)

    if (result.chunks.length === 0) {
      return result
    }

    const preliminaryChunk = await projectSubagentOutputChunk(parentToolUseId, result.chunks, state)
    return {
      ...result,
      chunks: preliminaryChunk ? [preliminaryChunk] : [],
    }
  }

  return mapClaudeAgentMessageToChunksWithoutParentProjection(msg, state)
}

function normalizeClaudeAgentChunkMapperState(state: ClaudeAgentChunkMapperState): void {
  state.emittedTextByTextItemId ??= new Map()
  state.emittedToolStateByToolCallId ??= new Map()
  state.activeToolBlockIds ??= new Map()
  state.toolNamesByToolCallId ??= new Map()
  state.toolInputTextByToolCallId ??= new Map()
  state.toolArgsByToolCallId ??= new Map()
  state.subagentStreams ??= new Map()
}

export function createClaudeAgentChunkMapperState(textItemId: string = randomUUID()): ClaudeAgentChunkMapperState {
  return {
    textItemId,
    assistantStarted: false,
    hadToolCallSinceLastText: false,
    emittedTextByTextItemId: new Map(),
    emittedToolStateByToolCallId: new Map(),
    activeToolBlockIds: new Map(),
    toolNamesByToolCallId: new Map(),
    toolInputTextByToolCallId: new Map(),
    toolArgsByToolCallId: new Map(),
    subagentStreams: new Map(),
  }
}

function subagentStreamState(parentToolUseId: string, state: ClaudeAgentChunkMapperState): ClaudeAgentSubagentStreamState {
  const existing = state.subagentStreams.get(parentToolUseId)
  if (existing) {
    return existing
  }

  const next: ClaudeAgentSubagentStreamState = {
    message: createSubagentMessage(parentToolUseId),
    mapperState: createClaudeAgentChunkMapperState(`subagent-text-${parentToolUseId}`),
    projector: createSubagentProjectorState(),
    chunkCount: 0,
    emittedChunkCount: 0,
  }
  state.subagentStreams.set(parentToolUseId, next)
  return next
}

async function mapClaudeAgentMessageToChunksWithoutParentProjection(msg: SDKMessage, state: ClaudeAgentChunkMapperState): Promise<ClaudeAgentChunkMapperResult> {
  const base: ClaudeAgentChunkMapperResult = {
    chunks: [],
    sessionId: null,
    usage: null,
  }

  switch (msg.type) {
    case 'assistant':
      return mapAssistant(msg, state)
    case 'user':
      return mapUser(msg as SDKUserMessage, state)
    case 'stream_event':
      return mapStreamEvent(msg, state)
    case 'result':
      return mapResult(msg, state)
    default:
      return mapSystemOrUnknown(msg, state, base)
  }
}

/**
 * Handle system lifecycle events (task_started, task_progress, task_notification, tool_progress, etc.)
 */
function mapSystemOrUnknown(msg: SDKMessage, state: ClaudeAgentChunkMapperState, base: ClaudeAgentChunkMapperResult): ClaudeAgentChunkMapperResult {
  // Extract session_id from any message that carries it
  const sessionId = 'session_id' in msg && typeof (msg as { session_id?: unknown }).session_id === 'string'
    ? (msg as { session_id: string }).session_id
    : null

  const msgType = msg.type as string
  const chunks: UIMessageChunk[] = []

  // Handle task lifecycle events — emit as step markers with metadata
  if (msgType === 'system/task_started') {
    const taskMsg = msg as { type: string, task_id?: string, agent_name?: string, prompt?: string }
    chunks.push({
      type: 'start-step',
    })
    // Emit a text segment to announce the subagent
    const agentName = taskMsg.agent_name ?? 'Subagent'
    const textId = randomUUID()
    chunks.push(
      { type: 'text-start', id: textId, providerMetadata: { cradle: { systemEvent: 'task_started', taskId: taskMsg.task_id, agentName } } },
      { type: 'text-delta', id: textId, delta: `[${agentName} started]` },
      { type: 'text-end', id: textId },
    )
  }
  else if (msgType === 'system/task_notification') {
    const taskMsg = msg as { type: string, task_id?: string, status?: string, result?: string }
    const textId = randomUUID()
    const status = taskMsg.status ?? 'completed'
    chunks.push(
      { type: 'text-start', id: textId, providerMetadata: { cradle: { systemEvent: 'task_notification', taskId: taskMsg.task_id, status } } },
      { type: 'text-delta', id: textId, delta: `[Task ${status}]` },
      { type: 'text-end', id: textId },
      { type: 'finish-step' },
    )
  }
  else if (msgType === 'tool_progress') {
    const progressMsg = msg as { type: string, tool_use_id?: string, tool_name?: string, content?: string, parent_tool_use_id?: string | null }
    if (progressMsg.content && progressMsg.tool_use_id) {
      chunks.push({
        type: 'tool-input-delta',
        toolCallId: progressMsg.tool_use_id,
        inputTextDelta: progressMsg.content,
      })
    }
  }

  return { ...base, chunks, sessionId }
}

function mapAssistant(msg: SDKAssistantMessage, state: ClaudeAgentChunkMapperState): ClaudeAgentChunkMapperResult {
  const chunks: UIMessageChunk[] = []

  const flushTextSegment = (text: string) => {
    if (text.length === 0) {
      return
    }
    const result = emitAssistantTextSegment(text, state)
    chunks.push(...result.chunks)
  }

  let pendingText = ''
  for (const block of msg.message.content) {
    if (block.type === 'text') {
      pendingText += block.text
      continue
    }

    flushTextSegment(pendingText)
    pendingText = ''

    if (block.type === 'tool_use') {
      const mapped = mapContentBlock(block, state)
      chunks.push(...mapped.chunks)
      state.hadToolCallSinceLastText = true
      continue
    }

    const mapped = mapContentBlock(block, state)
    chunks.push(...mapped.chunks)
  }
  flushTextSegment(pendingText)

  return { chunks, sessionId: msg.session_id, usage: null }
}

async function mapUser(msg: SDKUserMessage, state: ClaudeAgentChunkMapperState): Promise<ClaudeAgentChunkMapperResult> {
  const chunks: UIMessageChunk[] = []
  const content = msg.message.content

  // Extract tool_result blocks from user message content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block !== null && 'type' in block) {
        const b = block as { type: string, tool_use_id?: string, content?: unknown, is_error?: boolean }
        if (b.type === 'tool_result' && b.tool_use_id) {
          const normalizedOutput = normalizeToolResultContent(b.content)
          if (b.is_error) {
            chunks.push({ type: 'tool-output-error', toolCallId: b.tool_use_id, errorText: normalizeToolErrorText(normalizedOutput) })
          }
          else {
            const subagentState = state.subagentStreams.get(b.tool_use_id)
            const subagentMessage = subagentState
              ? projectSubagentMessage(b.tool_use_id, subagentState)
              : null
            if (subagentState) {
              compactSubagentStreamState(subagentState, subagentMessage)
            }
            const output = createClaudeCodeToolResult(
              b.tool_use_id,
              normalizedOutput,
              state,
            )
            chunks.push({
              type: 'tool-output-available',
              toolCallId: b.tool_use_id,
              output: subagentMessage
                ? createSubagentOutput(subagentMessage, b.content ?? output)
                : output,
            })
          }
        }
      }
    }
  }

  return { chunks, sessionId: msg.session_id ?? null, usage: null }
}

function mapContentBlock(
  block: BetaContentBlock,
  state: ClaudeAgentChunkMapperState,
): { chunks: UIMessageChunk[] } {
  switch (block.type) {
    case 'text': {
      const chunks: UIMessageChunk[] = []
      if (!state.assistantStarted) {
        chunks.push({ type: 'text-start', id: state.textItemId })
        state.assistantStarted = true
      }
      if (block.text) {
        chunks.push({ type: 'text-delta', id: state.textItemId, delta: block.text })
      }
      return { chunks }
    }
    case 'thinking': {
      const itemId = `thinking-${state.textItemId}`
      const chunks: UIMessageChunk[] = [
        { type: 'reasoning-start', id: itemId },
      ]
      if (block.thinking) {
        chunks.push({ type: 'reasoning-delta', id: itemId, delta: block.thinking })
      }
      chunks.push({ type: 'reasoning-end', id: itemId })
      return { chunks }
    }
    case 'tool_use':
      if (!block.id || !block.name) {
        return { chunks: [] }
      }
      return emitToolUseChunks(block.id, block.name, block.input, state)
    default:
      return { chunks: [] }
  }
}

function mapStreamEvent(msg: SDKPartialAssistantMessage, state: ClaudeAgentChunkMapperState): ClaudeAgentChunkMapperResult {
  const chunks: UIMessageChunk[] = []

  switch (msg.event.type) {
    case 'content_block_delta': {
      const deltaEvent = msg.event as BetaRawContentBlockDeltaEvent
      if (deltaEvent.delta.type === 'text_delta') {
        // Rotate text segment ID if tool calls happened since last text
        if (state.hadToolCallSinceLastText) {
          state.textItemId = randomUUID()
          state.hadToolCallSinceLastText = false
          state.assistantStarted = false
        }
        if (!state.assistantStarted) {
          chunks.push({ type: 'text-start', id: state.textItemId })
          state.assistantStarted = true
        }
        const textDelta = deltaEvent.delta.text ?? ''
        appendEmittedText(state, state.textItemId, textDelta)
        chunks.push({ type: 'text-delta', id: state.textItemId, delta: textDelta })
      }
      else if (deltaEvent.delta.type === 'thinking_delta') {
        const itemId = `thinking-${deltaEvent.index}`
        chunks.push({ type: 'reasoning-delta', id: itemId, delta: deltaEvent.delta.thinking ?? '' })
      }
      else if (deltaEvent.delta.type === 'input_json_delta') {
        const partialJson = (deltaEvent.delta as { type: 'input_json_delta', partial_json: string }).partial_json
        const toolId = state.activeToolBlockIds.get(deltaEvent.index)
        if (toolId && partialJson) {
          appendToolInputText(state, toolId, partialJson)
          chunks.push({ type: 'tool-input-delta', toolCallId: toolId, inputTextDelta: partialJson })
        }
      }
      break
    }
    case 'content_block_start': {
      const startEvent = msg.event as BetaRawContentBlockStartEvent
      if (startEvent.content_block.type === 'thinking') {
        const itemId = `thinking-${startEvent.index}`
        chunks.push({ type: 'reasoning-start', id: itemId })
      }
      else if (startEvent.content_block.type === 'tool_use') {
        if (!startEvent.content_block.id || !startEvent.content_block.name) {
          break
        }
        state.hadToolCallSinceLastText = true
        state.activeToolBlockIds.set(startEvent.index, startEvent.content_block.id)
        const emitted = emitToolUseChunks(
          startEvent.content_block.id,
          startEvent.content_block.name,
          undefined,
          state,
        )
        chunks.push(...emitted.chunks)
      }
      break
    }
  }

  return { chunks, sessionId: msg.session_id, usage: null }
}

async function projectSubagentOutputChunk(
  parentToolUseId: string,
  chunks: UIMessageChunk[],
  state: ClaudeAgentChunkMapperState,
): Promise<UIMessageChunk | null> {
  const streamState = subagentStreamState(parentToolUseId, state)
  projectSubagentChunks(streamState, chunks)

  if (!shouldEmitSubagentProjection(streamState)) {
    state.subagentStreams.set(parentToolUseId, streamState)
    return null
  }

  const latestMessage = projectSubagentMessage(parentToolUseId, streamState)
  const preliminaryMessage = compactPreliminarySubagentMessage(latestMessage)
  streamState.message = latestMessage
  streamState.emittedChunkCount = streamState.chunkCount
  state.subagentStreams.set(parentToolUseId, streamState)
  return {
    type: 'tool-output-available',
    toolCallId: parentToolUseId,
    output: {
      ...createSubagentOutput(preliminaryMessage, undefined, {
        truncated: preliminaryMessage !== latestMessage,
      }),
    },
    preliminary: true,
  }
}

function projectSubagentMessage(
  parentToolUseId: string,
  streamState: ClaudeAgentSubagentStreamState,
): UIMessage {
  flushSubagentProjection(streamState)
  streamState.emittedChunkCount = streamState.chunkCount
  return streamState.message ?? createSubagentMessage(parentToolUseId)
}

function compactSubagentStreamState(
  streamState: ClaudeAgentSubagentStreamState,
  message: UIMessage | null,
): void {
  streamState.message = message
  streamState.projector = createSubagentProjectorState()
  streamState.chunkCount = 0
  streamState.emittedChunkCount = 0
}

function shouldEmitSubagentProjection(streamState: ClaudeAgentSubagentStreamState): boolean {
  const unprojectedCount = streamState.chunkCount - streamState.emittedChunkCount
  if (unprojectedCount <= 0) {
    return false
  }
  if (streamState.chunkCount < 32) {
    return true
  }
  return unprojectedCount >= readSubagentProjectionWindow(streamState.chunkCount)
}

function readSubagentProjectionWindow(chunkCount: number): number {
  if (chunkCount < 32) {
    return 1
  }
  return Math.max(16, chunkCount / 4)
}

function createSubagentMessage(parentToolUseId: string): UIMessage {
  return {
    id: `subagent-${parentToolUseId}`,
    role: 'assistant',
    parts: [],
  }
}

function createSubagentProjectorState(): ClaudeAgentSubagentProjectorState {
  return {
    activeTextParts: new Map(),
    activeReasoningParts: new Map(),
    partialToolCalls: new Map(),
  }
}

function projectSubagentChunks(
  streamState: ClaudeAgentSubagentStreamState,
  chunks: UIMessageChunk[],
): void {
  for (const chunk of chunks) {
    streamState.chunkCount += 1
    projectSubagentChunk(streamState, chunk)
  }
}

function projectSubagentChunk(
  streamState: ClaudeAgentSubagentStreamState,
  chunk: UIMessageChunk,
): void {
  const message = streamState.message ?? createSubagentMessage('unknown')
  streamState.message = message

  switch (chunk.type) {
    case 'text-start': {
      const part = {
        type: 'text',
        text: '',
        state: 'streaming',
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      } satisfies MutableTextPart
      streamState.projector.activeTextParts.set(chunk.id, { part, deltas: [] })
      message.parts.push(part)
      break
    }
    case 'text-delta': {
      const activePart = streamState.projector.activeTextParts.get(chunk.id)
      if (activePart) {
        activePart.deltas.push(chunk.delta)
        activePart.part.providerMetadata = chunk.providerMetadata ?? activePart.part.providerMetadata
      }
      break
    }
    case 'text-end': {
      const activePart = streamState.projector.activeTextParts.get(chunk.id)
      if (activePart) {
        flushProjectedTextPart(activePart)
        activePart.part.state = 'done'
        activePart.part.providerMetadata = chunk.providerMetadata ?? activePart.part.providerMetadata
        streamState.projector.activeTextParts.delete(chunk.id)
      }
      break
    }
    case 'reasoning-start': {
      const part = {
        type: 'reasoning',
        text: '',
        state: 'streaming',
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      } satisfies MutableReasoningPart
      streamState.projector.activeReasoningParts.set(chunk.id, { part, deltas: [] })
      message.parts.push(part)
      break
    }
    case 'reasoning-delta': {
      const activePart = streamState.projector.activeReasoningParts.get(chunk.id)
      if (activePart) {
        activePart.deltas.push(chunk.delta)
        activePart.part.providerMetadata = chunk.providerMetadata ?? activePart.part.providerMetadata
      }
      break
    }
    case 'reasoning-end': {
      const activePart = streamState.projector.activeReasoningParts.get(chunk.id)
      if (activePart) {
        flushProjectedTextPart(activePart)
        activePart.part.state = 'done'
        activePart.part.providerMetadata = chunk.providerMetadata ?? activePart.part.providerMetadata
        streamState.projector.activeReasoningParts.delete(chunk.id)
      }
      break
    }
    case 'tool-input-start': {
      streamState.projector.partialToolCalls.set(chunk.toolCallId, {
        deltas: [],
        toolName: chunk.toolName,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      upsertSubagentToolPart(message, {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        state: 'input-streaming',
        input: undefined,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      break
    }
    case 'tool-input-delta': {
      const partialToolCall = streamState.projector.partialToolCalls.get(chunk.toolCallId)
      if (partialToolCall) {
        partialToolCall.deltas.push(chunk.inputTextDelta)
        upsertSubagentToolPart(message, {
          toolCallId: chunk.toolCallId,
          toolName: partialToolCall.toolName,
          state: 'input-streaming',
          input: undefined,
          dynamic: partialToolCall.dynamic,
          title: partialToolCall.title,
        })
      }
      break
    }
    case 'tool-input-available':
      streamState.projector.partialToolCalls.delete(chunk.toolCallId)
      upsertSubagentToolPart(message, {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        state: 'input-available',
        input: chunk.input,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      break
    case 'tool-output-available':
      updateSubagentToolOutput(message, chunk.toolCallId, {
        state: 'output-available',
        output: chunk.output,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        preliminary: chunk.preliminary,
        dynamic: chunk.dynamic,
      })
      break
    case 'tool-output-error':
      updateSubagentToolOutput(message, chunk.toolCallId, {
        state: 'output-error',
        errorText: chunk.errorText,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        dynamic: chunk.dynamic,
      })
      break
    case 'tool-output-denied':
      updateSubagentToolOutput(message, chunk.toolCallId, { state: 'output-denied' })
      break
    case 'start-step':
      message.parts.push({ type: 'step-start' })
      break
    case 'finish-step':
      flushSubagentProjection(streamState)
      break
    case 'file':
      message.parts.push({
        type: 'file',
        mediaType: chunk.mediaType,
        url: chunk.url,
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      })
      break
    case 'source-url':
      message.parts.push({
        type: 'source-url',
        sourceId: chunk.sourceId,
        url: chunk.url,
        title: chunk.title,
        providerMetadata: chunk.providerMetadata,
      })
      break
    case 'source-document':
      message.parts.push({
        type: 'source-document',
        sourceId: chunk.sourceId,
        mediaType: chunk.mediaType,
        title: chunk.title,
        filename: chunk.filename,
        providerMetadata: chunk.providerMetadata,
      })
      break
  }
}

function flushSubagentProjection(streamState: ClaudeAgentSubagentStreamState): void {
  for (const activePart of streamState.projector.activeTextParts.values()) {
    flushProjectedTextPart(activePart)
  }
  for (const activePart of streamState.projector.activeReasoningParts.values()) {
    flushProjectedTextPart(activePart)
  }
  const message = streamState.message
  if (!message) {
    return
  }
  for (const [toolCallId, partialToolCall] of streamState.projector.partialToolCalls) {
    upsertSubagentToolPart(message, {
      toolCallId,
      toolName: partialToolCall.toolName,
      state: 'input-streaming',
      input: parseToolInputText(partialToolCall.deltas.join('')),
      dynamic: partialToolCall.dynamic,
      title: partialToolCall.title,
    })
  }
}

function flushProjectedTextPart<TPart extends MutableTextPart | MutableReasoningPart>(
  activePart: ProjectedTextPart<TPart>,
): void {
  if (activePart.deltas.length === 0) {
    return
  }
  activePart.part.text += activePart.deltas.join('')
  activePart.deltas = []
}

function upsertSubagentToolPart(
  message: UIMessage,
  options: {
    toolCallId: string
    toolName: string
    state: 'input-streaming' | 'input-available'
    input: unknown
    providerExecuted?: boolean
    providerMetadata?: ProviderMetadata
    dynamic?: boolean
    title?: string
  },
): void {
  const part = findSubagentToolPart(message, options.toolCallId)
  if (part) {
    assignToolPart(part, {
      state: options.state,
      input: options.input,
      providerExecuted: options.providerExecuted,
      title: options.title,
      providerMetadata: options.providerMetadata,
      isResultMetadata: false,
    })
    return
  }

  if (options.dynamic) {
    message.parts.push({
      type: 'dynamic-tool',
      toolName: options.toolName,
      toolCallId: options.toolCallId,
      state: options.state,
      input: options.input,
      providerExecuted: options.providerExecuted,
      title: options.title,
      ...(options.providerMetadata ? { callProviderMetadata: options.providerMetadata } : {}),
    } as UIMessage['parts'][number])
    return
  }

  message.parts.push({
    type: `tool-${options.toolName}`,
    toolCallId: options.toolCallId,
    state: options.state,
    input: options.input,
    providerExecuted: options.providerExecuted,
    title: options.title,
    ...(options.providerMetadata ? { callProviderMetadata: options.providerMetadata } : {}),
  } as UIMessage['parts'][number])
}

function updateSubagentToolOutput(
  message: UIMessage,
  toolCallId: string,
  options: {
    state: 'output-available' | 'output-error' | 'output-denied'
    output?: unknown
    errorText?: string
    providerExecuted?: boolean
    providerMetadata?: ProviderMetadata
    preliminary?: boolean
    dynamic?: boolean
  },
): void {
  const part = findSubagentToolPart(message, toolCallId)
  if (!part) {
    return
  }

  assignToolPart(part, {
    state: options.state,
    output: options.output,
    errorText: options.errorText,
    providerExecuted: options.providerExecuted,
    preliminary: options.preliminary,
    providerMetadata: options.providerMetadata,
    isResultMetadata: true,
  })
}

function findSubagentToolPart(message: UIMessage, toolCallId: string): MutableToolPart | undefined {
  return message.parts.find((part): part is MutableToolPart => 'toolCallId' in part && part.toolCallId === toolCallId)
}

function assignToolPart(
  part: MutableToolPart,
  values: {
    state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | 'output-denied'
    input?: unknown
    output?: unknown
    errorText?: string
    providerExecuted?: boolean
    preliminary?: boolean
    title?: string
    providerMetadata?: ProviderMetadata
    isResultMetadata: boolean
  },
): void {
  const target = part as MutableToolPart & Record<string, unknown>
  target.state = values.state
  if ('input' in values) {
    target.input = values.input
  }
  if ('output' in values) {
    target.output = values.output
  }
  if ('errorText' in values) {
    target.errorText = values.errorText
  }
  if (values.providerExecuted !== undefined) {
    target.providerExecuted = values.providerExecuted
  }
  if (values.preliminary !== undefined) {
    target.preliminary = values.preliminary
  }
  if (values.title !== undefined) {
    target.title = values.title
  }
  if (values.providerMetadata !== undefined) {
    target[values.isResultMetadata ? 'resultProviderMetadata' : 'callProviderMetadata'] = values.providerMetadata
  }
}

function compactPreliminarySubagentMessage(message: UIMessage): UIMessage {
  let remainingText = PRELIMINARY_SUBAGENT_TEXT_LIMIT
  let truncated = false
  const parts: UIMessage['parts'] = []

  for (const part of message.parts) {
    if (part.type !== 'text' && part.type !== 'reasoning') {
      parts.push(part)
      continue
    }

    if (remainingText <= 0) {
      truncated = true
      continue
    }

    if (part.text.length <= remainingText) {
      remainingText -= part.text.length
      parts.push(part)
      continue
    }

    truncated = true
    parts.push({
      ...part,
      text: part.text.slice(0, remainingText),
    } as UIMessage['parts'][number])
    remainingText = 0
  }

  if (!truncated) {
    return message
  }

  return {
    ...message,
    parts,
  }
}

function createSubagentOutput(
  message: UIMessage,
  result?: unknown,
  options: { truncated?: boolean } = {},
): ClaudeAgentSubagentOutput {
  return {
    type: 'cradle.subagent-output.v1',
    message,
    ...(options.truncated ? { truncated: true } : {}),
    ...(result === undefined ? {} : { result }),
  }
}

function mapResult(msg: SDKResultMessage, state: ClaudeAgentChunkMapperState): ClaudeAgentChunkMapperResult {
  const usage = msg.usage
    ? {
        promptTokens: msg.usage.input_tokens ?? 0,
        completionTokens: msg.usage.output_tokens ?? 0,
        totalTokens: (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0),
      }
    : null

  return { chunks: [], sessionId: msg.session_id, usage }
}

function emitAssistantTextSegment(
  text: string,
  state: ClaudeAgentChunkMapperState,
): { chunks: UIMessageChunk[] } {
  if (state.hadToolCallSinceLastText) {
    state.textItemId = randomUUID()
    state.hadToolCallSinceLastText = false
    state.assistantStarted = false
  }

  const previousText = readAccumulatedText(state.emittedTextByTextItemId.get(state.textItemId))
  const nextText = diffAssistantText(previousText, text)
  if (nextText.length === 0) {
    return { chunks: [] }
  }

  const chunks: UIMessageChunk[] = []
  if (!state.assistantStarted) {
    chunks.push({ type: 'text-start', id: state.textItemId })
    state.assistantStarted = true
  }
  appendEmittedText(state, state.textItemId, nextText)
  chunks.push({ type: 'text-delta', id: state.textItemId, delta: nextText })
  return { chunks }
}

function diffAssistantText(previousText: string, nextText: string): string {
  if (nextText.startsWith(previousText)) {
    return nextText.slice(previousText.length)
  }
  if (previousText.startsWith(nextText)) {
    return ''
  }

  let prefixLength = 0
  const limit = Math.min(previousText.length, nextText.length)
  while (prefixLength < limit && previousText[prefixLength] === nextText[prefixLength]) {
    prefixLength += 1
  }
  return nextText.slice(prefixLength)
}

function appendEmittedText(state: ClaudeAgentChunkMapperState, textItemId: string, text: string): void {
  appendAccumulatedText(state.emittedTextByTextItemId, textItemId, text)
}

function emitToolUseChunks(
  toolCallId: string,
  toolName: string,
  input: unknown,
  state: ClaudeAgentChunkMapperState,
): { chunks: UIMessageChunk[] } {
  const current = state.emittedToolStateByToolCallId.get(toolCallId) ?? { started: false, inputAvailable: false }
  const chunks: UIMessageChunk[] = []
  state.toolNamesByToolCallId.set(toolCallId, toolName)

  if (!current.started) {
    chunks.push({ type: 'tool-input-start', toolCallId, toolName })
    current.started = true
  }

  if (input !== undefined && !current.inputAvailable) {
    state.toolArgsByToolCallId.set(toolCallId, input)
    chunks.push({
      type: 'tool-input-available',
      toolCallId,
      toolName,
      input: createClaudeCodeToolInputPayload(toolName, input),
    })
    current.inputAvailable = true
  }

  state.emittedToolStateByToolCallId.set(toolCallId, current)
  return { chunks }
}

function appendToolInputText(
  state: ClaudeAgentChunkMapperState,
  toolCallId: string,
  inputTextDelta: string,
): void {
  appendAccumulatedText(state.toolInputTextByToolCallId, toolCallId, inputTextDelta)
}

function appendAccumulatedText(target: Map<string, TextAccumulator>, key: string, text: string): void {
  const accumulator = target.get(key) ?? { parts: [], length: 0 }
  accumulator.parts.push(text)
  accumulator.length += text.length
  target.set(key, accumulator)
}

function readAccumulatedText(accumulator: TextAccumulator | undefined): string {
  if (!accumulator) {
    return ''
  }
  if (accumulator.parts.length <= 1) {
    return accumulator.parts[0] ?? ''
  }
  const text = accumulator.parts.join('')
  accumulator.parts = [text]
  return text
}

function createClaudeCodeToolResult(
  toolCallId: string,
  result: unknown,
  state: ClaudeAgentChunkMapperState,
): unknown {
  const toolName = state.toolNamesByToolCallId.get(toolCallId)
  if (!toolName) {
    return result
  }

  const args = state.toolArgsByToolCallId.get(toolCallId) ?? parseToolInputText(readAccumulatedText(state.toolInputTextByToolCallId.get(toolCallId)))
  const enrichedResult = attachTodoWritePluginState(toolName, args, result)
  return createClaudeCodeToolResultPayload({
    apiName: toolName,
    args,
    result: enrichedResult,
  })
}

function attachTodoWritePluginState(
  toolName: string,
  input: unknown,
  output: unknown,
): unknown {
  if (!isTodoWriteToolName(toolName)) {
    return output
  }
  const pluginState = synthesizeTodoWritePluginState(input)
  if (!pluginState) {
    return output
  }

  if (isRecord(output)) {
    const existingPluginState = isRecord(output.pluginState) ? output.pluginState : {}
    return {
      ...output,
      pluginState: {
        ...existingPluginState,
        todos: pluginState.todos,
      },
    }
  }

  return {
    result: output,
    pluginState: {
      todos: pluginState.todos,
    },
  }
}

function parseToolInputText(inputText: string | undefined): unknown {
  if (!inputText) {
    return undefined
  }
  try {
    return JSON.parse(inputText)
  }
  catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalize tool_result content for the frontend classifier.
 * Objects/arrays are passed through as-is so the classifier can read
 * structured fields (e.g. TodoWriteOutput.newTodos, ExitPlanModeOutput.plan).
 * Strings are attempt-parsed as JSON in case the SDK serialized a structured output.
 */
function normalizeToolResultContent(content: unknown): unknown {
  if (content == null) {
    return ''
  }
  if (typeof content === 'object') {
    return content
  }
  if (typeof content === 'string') {
    try {
      return JSON.parse(content)
    }
    catch {
      return content
    }
  }
  return String(content)
}

function normalizeToolErrorText(output: unknown): string {
  if (typeof output === 'string') {
    return output || 'Tool execution failed'
  }
  if (output == null) {
    return 'Tool execution failed'
  }
  try {
    return JSON.stringify(output)
  }
  catch {
    return String(output)
  }
}
