/**
 * Output: AI SDK UIMessageChunk events projected from Claude Agent SDK messages.
 * Input: Claude Agent SDK stream messages, tool-use snapshots, result messages, and subagent parent tool ids.
 * Position: Claude Agent provider package event mapper between SDK-native events and Chat Runtime chunks.
 */

import { randomUUID } from 'node:crypto'

import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage, SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessageChunk } from 'ai'

import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import type { ClaudeAgentSubagentProjection } from './subagent-projector'
import {
  compactClaudeAgentSubagentProjection,
  createClaudeAgentSubagentOutput,
  createClaudeAgentSubagentProjection,
  projectClaudeAgentSubagentMessage,
  projectClaudeAgentSubagentOutputChunk,
} from './subagent-projector'
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
  emittedToolStateByToolCallId: Map<string, { started: boolean, inputAvailable: boolean, outputAvailable?: boolean }>
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
  /** Maps content block index → reasoning item ID for currently-streaming thinking blocks. */
  activeThinkingBlockByIndex: Map<number, string>
  /** Content block indices whose thinking blocks were fully emitted via stream events (reasoning-end sent). */
  completedThinkingBlockIndices: Set<number>
}

interface ClaudeAgentSubagentStreamState extends ClaudeAgentSubagentProjection {
  mapperState: ClaudeAgentChunkMapperState
}

interface TextAccumulator {
  parts: string[]
  length: number
}

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

    const preliminaryChunk = projectClaudeAgentSubagentOutputChunk(parentToolUseId, streamState, result.chunks)
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
  state.activeThinkingBlockByIndex ??= new Map()
  state.completedThinkingBlockIndices ??= new Set()
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
    activeThinkingBlockByIndex: new Map(),
    completedThinkingBlockIndices: new Set(),
  }
}

function subagentStreamState(parentToolUseId: string, state: ClaudeAgentChunkMapperState): ClaudeAgentSubagentStreamState {
  const existing = state.subagentStreams.get(parentToolUseId)
  if (existing) {
    return existing
  }

  const next: ClaudeAgentSubagentStreamState = {
    ...createClaudeAgentSubagentProjection(parentToolUseId),
    mapperState: createClaudeAgentChunkMapperState(`subagent-text-${parentToolUseId}`),
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
  for (let blockIndex = 0; blockIndex < msg.message.content.length; blockIndex++) {
    const block = msg.message.content[blockIndex]!
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

    // Skip thinking blocks that were fully handled by stream events — they already
    // emitted reasoning-start/delta/end, and the snapshot would create a duplicate part.
    if (block.type === 'thinking' && state.completedThinkingBlockIndices.has(blockIndex)) {
      continue
    }

    const mapped = mapContentBlock(block, state)
    chunks.push(...mapped.chunks)
  }
  flushTextSegment(pendingText)

  const usage = msg.message.usage
    ? {
        promptTokens: msg.message.usage.input_tokens ?? 0,
        completionTokens: msg.message.usage.output_tokens ?? 0,
        totalTokens: (msg.message.usage.input_tokens ?? 0) + (msg.message.usage.output_tokens ?? 0),
      }
    : null

  return { chunks, sessionId: msg.session_id, usage }
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
              ? projectClaudeAgentSubagentMessage(b.tool_use_id, subagentState)
              : null
            if (subagentState) {
              compactClaudeAgentSubagentProjection(subagentState, subagentMessage)
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
                ? createClaudeAgentSubagentOutput(subagentMessage, b.content ?? output)
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
  let usage: TokenUsage | null = null

  switch (msg.event.type) {
    case 'message_delta': {
      const messageDeltaEvent = msg.event as { type: 'message_delta', usage?: { input_tokens?: number, output_tokens?: number } }
      if (messageDeltaEvent.usage) {
        usage = {
          promptTokens: messageDeltaEvent.usage.input_tokens ?? 0,
          completionTokens: messageDeltaEvent.usage.output_tokens ?? 0,
          totalTokens: (messageDeltaEvent.usage.input_tokens ?? 0) + (messageDeltaEvent.usage.output_tokens ?? 0),
        }
      }
      break
    }
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
        state.activeThinkingBlockByIndex.set(startEvent.index, itemId)
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
    case 'content_block_stop': {
      const stopEvent = msg.event as { type: 'content_block_stop', index: number }
      const thinkingItemId = state.activeThinkingBlockByIndex.get(stopEvent.index)
      if (thinkingItemId !== undefined) {
        state.activeThinkingBlockByIndex.delete(stopEvent.index)
        state.completedThinkingBlockIndices.add(stopEvent.index)
        chunks.push({ type: 'reasoning-end', id: thinkingItemId })
      }
      break
    }
  }

  return { chunks, sessionId: msg.session_id, usage }
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

  const exitPlan = readExitPlanModePlan(toolName, input)
  if (exitPlan && !current.outputAvailable) {
    chunks.push({
      type: 'tool-output-available',
      toolCallId,
      output: createClaudeCodeToolResultPayload({
        apiName: toolName,
        args: input,
        result: { plan: exitPlan },
      }),
    })
    current.outputAvailable = true
  }

  state.emittedToolStateByToolCallId.set(toolCallId, current)
  return { chunks }
}

function readExitPlanModePlan(toolName: string, input: unknown): string | null {
  if (toolName !== 'ExitPlanMode' && toolName !== 'exit_plan_mode' && toolName !== 'exitplanmode') {
    return null
  }
  if (!isRecord(input) || typeof input.plan !== 'string') {
    return null
  }
  const plan = input.plan.trim()
  return plan.length > 0 ? plan : null
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
