import { randomUUID } from 'node:crypto'

import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage, SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessage, UIMessageChunk } from 'ai'
import { readUIMessageStream } from 'ai'

import type { TokenUsage } from '../../engine/ai-sdk-engine'

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
  emittedTextByTextItemId: Map<string, string>
  /** Tracks emitted tool lifecycle fragments so full assistant snapshots do not replay streamed tool blocks. */
  emittedToolStateByToolCallId: Map<string, { started: boolean, inputAvailable: boolean }>
  /** Maps content block index → tool_use block ID for streaming tool input deltas */
  activeToolBlockIds: Map<number, string>
  /** Accumulated child-agent chunk state keyed by parent tool call. */
  subagentStreams: Map<string, ClaudeAgentSubagentStreamState>
}

interface ClaudeAgentSubagentStreamState {
  chunks: UIMessageChunk[]
  message: UIMessage | null
}

interface ClaudeAgentSubagentOutput {
  type: 'cradle.subagent-output.v1'
  message: UIMessage
  result?: unknown
}

export interface ClaudeAgentChunkMapperResult {
  chunks: UIMessageChunk[]
  assistantStarted: boolean
  sessionId: string | null
  usage: TokenUsage | null
}

export async function mapClaudeAgentMessageToChunks(msg: SDKMessage, state: ClaudeAgentChunkMapperState): Promise<ClaudeAgentChunkMapperResult> {
  const base: ClaudeAgentChunkMapperResult = {
    chunks: [],
    assistantStarted: state.assistantStarted,
    sessionId: null,
    usage: null,
  }

  const parentToolUseId = 'parent_tool_use_id' in msg ? (msg as { parent_tool_use_id: string | null }).parent_tool_use_id : null

  const result = (() => {
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
  })()

  if (!parentToolUseId || result.chunks.length === 0) {
    return result
  }

  const preliminaryChunk = await projectSubagentOutputChunk(parentToolUseId, result.chunks, state)
  return {
    ...result,
    chunks: preliminaryChunk ? [preliminaryChunk] : [],
    assistantStarted: state.assistantStarted,
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
  let assistantStarted = state.assistantStarted

  const flushTextSegment = (text: string) => {
    if (text.length === 0) {
      return
    }
    const result = emitAssistantTextSegment(text, state, assistantStarted)
    chunks.push(...result.chunks)
    assistantStarted = result.assistantStarted
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
      const mapped = mapContentBlock(block, state.textItemId, assistantStarted, state)
      chunks.push(...mapped.chunks)
      state.hadToolCallSinceLastText = true
      continue
    }

    const mapped = mapContentBlock(block, state.textItemId, assistantStarted, state)
    chunks.push(...mapped.chunks)
    if (mapped.assistantStarted) {
      assistantStarted = true
    }
  }
  flushTextSegment(pendingText)

  return { chunks, assistantStarted, sessionId: msg.session_id, usage: null }
}

function mapUser(msg: SDKUserMessage, state: ClaudeAgentChunkMapperState): ClaudeAgentChunkMapperResult {
  const chunks: UIMessageChunk[] = []
  const content = msg.message.content

  // Extract tool_result blocks from user message content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block !== null && 'type' in block) {
        const b = block as { type: string, tool_use_id?: string, content?: unknown, is_error?: boolean }
        if (b.type === 'tool_result' && b.tool_use_id) {
          const output = typeof b.content === 'string'
            ? b.content
            : b.content != null
              ? JSON.stringify(b.content)
              : ''
          if (b.is_error) {
            chunks.push({ type: 'tool-output-error', toolCallId: b.tool_use_id, errorText: output || 'Tool execution failed' })
          }
          else {
            const subagentState = state.subagentStreams.get(b.tool_use_id)
            chunks.push({
              type: 'tool-output-available',
              toolCallId: b.tool_use_id,
              output: subagentState?.message
                ? createSubagentOutput(subagentState.message, b.content ?? output)
                : output,
            })
          }
        }
      }
    }
  }

  return { chunks, assistantStarted: state.assistantStarted, sessionId: msg.session_id ?? null, usage: null }
}

function mapContentBlock(
  block: BetaContentBlock,
  textItemId: string,
  assistantStarted: boolean,
  state?: ClaudeAgentChunkMapperState,
): { chunks: UIMessageChunk[], assistantStarted: boolean } {
  switch (block.type) {
    case 'text': {
      const chunks: UIMessageChunk[] = []
      if (!assistantStarted) {
        chunks.push({ type: 'text-start', id: textItemId })
      }
      if (block.text) {
        chunks.push({ type: 'text-delta', id: textItemId, delta: block.text })
      }
      return { chunks, assistantStarted: true }
    }
    case 'thinking': {
      const itemId = `thinking-${textItemId}`
      const chunks: UIMessageChunk[] = [
        { type: 'reasoning-start', id: itemId },
      ]
      if (block.thinking) {
        chunks.push({ type: 'reasoning-delta', id: itemId, delta: block.thinking })
      }
      chunks.push({ type: 'reasoning-end', id: itemId })
      return { chunks, assistantStarted }
    }
    case 'tool_use':
      if (!block.id || !block.name) {
        return { chunks: [], assistantStarted }
      }
      if (!state) {
        return {
          chunks: [
            { type: 'tool-input-start', toolCallId: block.id, toolName: block.name },
            ...(block.input ? [{ type: 'tool-input-available' as const, toolCallId: block.id, toolName: block.name, input: block.input }] : []),
          ],
          assistantStarted,
        }
      }
      return emitToolUseChunks(block.id, block.name, block.input, state, assistantStarted)
    default:
      return { chunks: [], assistantStarted }
  }
}

function mapStreamEvent(msg: SDKPartialAssistantMessage, state: ClaudeAgentChunkMapperState): ClaudeAgentChunkMapperResult {
  const chunks: UIMessageChunk[] = []
  let assistantStarted = state.assistantStarted

  switch (msg.event.type) {
    case 'content_block_delta': {
      const deltaEvent = msg.event as BetaRawContentBlockDeltaEvent
      if (deltaEvent.delta.type === 'text_delta') {
        // Rotate text segment ID if tool calls happened since last text
        if (state.hadToolCallSinceLastText) {
          state.textItemId = randomUUID()
          state.hadToolCallSinceLastText = false
          assistantStarted = false
        }
        if (!assistantStarted) {
          chunks.push({ type: 'text-start', id: state.textItemId })
          assistantStarted = true
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
          assistantStarted,
        )
        chunks.push(...emitted.chunks)
      }
      break
    }
  }

  return { chunks, assistantStarted, sessionId: msg.session_id, usage: null }
}

async function projectSubagentOutputChunk(
  parentToolUseId: string,
  chunks: UIMessageChunk[],
  state: ClaudeAgentChunkMapperState,
): Promise<UIMessageChunk | null> {
  const streamState = state.subagentStreams.get(parentToolUseId) ?? { chunks: [], message: null }
  streamState.chunks.push(...chunks)

  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of streamState.chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })

  let latestMessage: UIMessage | null = null
  for await (const message of readUIMessageStream<UIMessage>({
    message: {
      id: `subagent-${parentToolUseId}`,
      role: 'assistant',
      parts: [],
    },
    stream,
    terminateOnError: false,
  })) {
    latestMessage = message
  }

  if (!latestMessage) {
    state.subagentStreams.set(parentToolUseId, streamState)
    return null
  }

  streamState.message = latestMessage
  state.subagentStreams.set(parentToolUseId, streamState)
  return {
    type: 'tool-output-available',
    toolCallId: parentToolUseId,
    output: {
      ...createSubagentOutput(latestMessage),
    },
    preliminary: true,
  }
}

function createSubagentOutput(message: UIMessage, result?: unknown): ClaudeAgentSubagentOutput {
  return {
    type: 'cradle.subagent-output.v1',
    message,
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

  return { chunks: [], assistantStarted: state.assistantStarted, sessionId: msg.session_id, usage }
}

function emitAssistantTextSegment(
  text: string,
  state: ClaudeAgentChunkMapperState,
  assistantStarted: boolean,
): { chunks: UIMessageChunk[], assistantStarted: boolean } {
  if (state.hadToolCallSinceLastText) {
    state.textItemId = randomUUID()
    state.hadToolCallSinceLastText = false
    assistantStarted = false
  }

  const previousText = state.emittedTextByTextItemId.get(state.textItemId) ?? ''
  const nextText = diffAssistantText(previousText, text)
  if (nextText.length === 0) {
    return { chunks: [], assistantStarted }
  }

  const chunks: UIMessageChunk[] = []
  if (!assistantStarted) {
    chunks.push({ type: 'text-start', id: state.textItemId })
    assistantStarted = true
  }
  appendEmittedText(state, state.textItemId, nextText)
  chunks.push({ type: 'text-delta', id: state.textItemId, delta: nextText })
  return { chunks, assistantStarted }
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
  const current = state.emittedTextByTextItemId.get(textItemId) ?? ''
  state.emittedTextByTextItemId.set(textItemId, `${current}${text}`)
}

function emitToolUseChunks(
  toolCallId: string,
  toolName: string,
  input: unknown,
  state: ClaudeAgentChunkMapperState,
  assistantStarted: boolean,
): { chunks: UIMessageChunk[], assistantStarted: boolean } {
  const current = state.emittedToolStateByToolCallId.get(toolCallId) ?? { started: false, inputAvailable: false }
  const chunks: UIMessageChunk[] = []

  if (!current.started) {
    chunks.push({ type: 'tool-input-start', toolCallId, toolName })
    current.started = true
  }

  if (input !== undefined && !current.inputAvailable) {
    chunks.push({ type: 'tool-input-available', toolCallId, toolName, input })
    current.inputAvailable = true
  }

  state.emittedToolStateByToolCallId.set(toolCallId, current)
  return { chunks, assistantStarted }
}
