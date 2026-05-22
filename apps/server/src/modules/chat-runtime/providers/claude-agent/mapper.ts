import { randomUUID } from 'node:crypto'

import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage, SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { BetaContentBlock, BetaRawContentBlockDeltaEvent, BetaRawContentBlockStartEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { UIMessageChunk } from 'ai'
import { z } from 'zod'

import type { TokenUsage } from '../../engine/ai-sdk-engine'

export interface ClaudeAgentChunkMapperState {
  textItemId: string
  assistantStarted: boolean
  /** True when tool calls have been emitted since last text segment — next text gets a fresh ID */
  hadToolCallSinceLastText: boolean
  /** Maps content block index → tool_use block ID for streaming tool input deltas */
  activeToolBlockIds: Map<number, string>
  /** Current parent_tool_use_id for subagent nesting */
  currentParentToolUseId: string | null
}

export interface ClaudeAgentChunkMapperResult {
  chunks: UIMessageChunk[]
  assistantStarted: boolean
  sessionId: string | null
  usage: TokenUsage | null
}

const ChunkProviderMetadataSchema = z.object({
  cradle: z.record(z.string(), z.unknown()).default({}),
}).passthrough().default({ cradle: {} })
const ChunkProviderMetadataCarrierSchema = z.object({
  providerMetadata: z.unknown().optional(),
}).passthrough()
const UiMessageChunkSchema = z.custom<UIMessageChunk>()

const ParentToolUseMessageSchema = z.object({
  parent_tool_use_id: z.string().nullable().default(null),
}).passthrough()

const SessionCarrierMessageSchema = z.object({
  session_id: z.string().nullable().default(null),
}).passthrough()

const TaskStartedMessageSchema = z.object({
  type: z.literal('system/task_started'),
  task_id: z.string().optional(),
  agent_name: z.string().default('Subagent'),
}).passthrough()

const TaskNotificationMessageSchema = z.object({
  type: z.literal('system/task_notification'),
  task_id: z.string().optional(),
  status: z.string().default('completed'),
}).passthrough()

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

const ToolResultContentTextSchema = z.union([
  z.string(),
  z.null().transform(() => ''),
  JsonValueSchema.transform(value => JSON.stringify(value)),
])

const ToolProgressMessageSchema = z.object({
  type: z.literal('tool_progress'),
  tool_use_id: z.string().min(1),
  content: z.string().min(1),
}).passthrough()

const UserToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().min(1),
  content: ToolResultContentTextSchema,
  is_error: z.boolean().default(false),
}).passthrough()

const UserToolResultContentSchema = z.array(UserToolResultBlockSchema)

const UserMessageToolResultContentSchema = z.object({
  message: z.object({
    content: UserToolResultContentSchema,
  }).passthrough(),
  session_id: z.string().nullable().default(null),
}).passthrough()

/**
 * Attach parentToolUseId metadata to a chunk when inside a subagent context.
 */
function withParentMeta(chunk: UIMessageChunk, parentToolUseId: string | null): UIMessageChunk {
  if (!parentToolUseId) {
    return chunk
  }
  const providerMetadata = ChunkProviderMetadataSchema.parse(
    ChunkProviderMetadataCarrierSchema.parse(chunk).providerMetadata,
  )

  return UiMessageChunkSchema.parse({
    ...(chunk as object),
    providerMetadata: {
      ...providerMetadata,
      cradle: {
        ...providerMetadata.cradle,
        parentToolUseId,
      },
    },
  })
}

export function mapClaudeAgentMessageToChunks(msg: SDKMessage, state: ClaudeAgentChunkMapperState): ClaudeAgentChunkMapperResult {
  const base: ClaudeAgentChunkMapperResult = {
    chunks: [],
    assistantStarted: state.assistantStarted,
    sessionId: null,
    usage: null,
  }

  // Track parent context for subagent messages
  const parentToolUseId = ParentToolUseMessageSchema.parse(msg).parent_tool_use_id
  state.currentParentToolUseId = parentToolUseId

  switch (msg.type) {
    case 'assistant':
      return mapAssistant(msg, state, parentToolUseId)
    case 'user':
      return mapUser(msg as SDKUserMessage, state, parentToolUseId)
    case 'stream_event':
      return mapStreamEvent(msg, state, parentToolUseId)
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
  const msgType = msg.type as string
  const chunks: UIMessageChunk[] = []

  // Handle task lifecycle events as text parts with provider metadata.
  if (msgType === 'system/task_started') {
    const taskMsg = TaskStartedMessageSchema.parse(msg)
    const textId = randomUUID()
    chunks.push(
      { type: 'text-start', id: textId, providerMetadata: { cradle: { systemEvent: 'task_started', taskId: taskMsg.task_id, agentName: taskMsg.agent_name } } },
      { type: 'text-delta', id: textId, delta: `[${taskMsg.agent_name} started]` },
      { type: 'text-end', id: textId },
    )
  }
  else if (msgType === 'system/task_notification') {
    const taskMsg = TaskNotificationMessageSchema.parse(msg)
    const textId = randomUUID()
    chunks.push(
      { type: 'text-start', id: textId, providerMetadata: { cradle: { systemEvent: 'task_notification', taskId: taskMsg.task_id, status: taskMsg.status } } },
      { type: 'text-delta', id: textId, delta: `[Task ${taskMsg.status}]` },
      { type: 'text-end', id: textId },
    )
  }
  else if (msgType === 'tool_progress') {
    const progressMsg = ToolProgressMessageSchema.parse(msg)
    chunks.push({
      type: 'tool-input-delta',
      toolCallId: progressMsg.tool_use_id,
      inputTextDelta: progressMsg.content,
    })
  }

  return { ...base, chunks: chunks.map(chunk => withParentMeta(chunk, state.currentParentToolUseId)), sessionId: SessionCarrierMessageSchema.parse(msg).session_id }
}

function mapAssistant(msg: SDKAssistantMessage, state: ClaudeAgentChunkMapperState, parentToolUseId: string | null): ClaudeAgentChunkMapperResult {
  const chunks: UIMessageChunk[] = []
  let assistantStarted = state.assistantStarted

  // If tool calls happened since last text, rotate to a new text segment ID
  if (state.hadToolCallSinceLastText) {
    state.textItemId = randomUUID()
    state.hadToolCallSinceLastText = false
    assistantStarted = false
  }

  let hadToolCall = false
  for (const block of msg.message.content) {
    const mapped = mapContentBlock(block, state.textItemId, assistantStarted)
    chunks.push(...mapped.chunks.map(c => withParentMeta(c, parentToolUseId)))
    if (mapped.assistantStarted) {
      assistantStarted = true
    }
    if (block.type === 'tool_use') {
      hadToolCall = true
    }
  }

  if (hadToolCall) {
    state.hadToolCallSinceLastText = true
  }

  return { chunks, assistantStarted, sessionId: msg.session_id, usage: null }
}

function mapUser(msg: SDKUserMessage, state: ClaudeAgentChunkMapperState, parentToolUseId: string | null): ClaudeAgentChunkMapperResult {
  const chunks: UIMessageChunk[] = []
  const parsedMsg = UserMessageToolResultContentSchema.parse(msg)

  for (const block of parsedMsg.message.content) {
    if (block.is_error) {
      chunks.push(withParentMeta({ type: 'tool-output-error', toolCallId: block.tool_use_id, errorText: block.content }, parentToolUseId))
    }
    else {
      chunks.push(withParentMeta({ type: 'tool-output-available', toolCallId: block.tool_use_id, output: block.content }, parentToolUseId))
    }
  }

  return { chunks, assistantStarted: state.assistantStarted, sessionId: parsedMsg.session_id, usage: null }
}

function mapContentBlock(
  block: BetaContentBlock,
  textItemId: string,
  assistantStarted: boolean,
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
      return {
        chunks: [
          { type: 'tool-input-start', toolCallId: block.id, toolName: block.name },
          ...(block.input ? [{ type: 'tool-input-available' as const, toolCallId: block.id, toolName: block.name, input: block.input }] : []),
        ],
        assistantStarted,
      }
    default:
      return { chunks: [], assistantStarted }
  }
}

function mapStreamEvent(msg: SDKPartialAssistantMessage, state: ClaudeAgentChunkMapperState, parentToolUseId: string | null): ClaudeAgentChunkMapperResult {
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
          chunks.push(withParentMeta({ type: 'text-start', id: state.textItemId }, parentToolUseId))
          assistantStarted = true
        }
        chunks.push(withParentMeta({ type: 'text-delta', id: state.textItemId, delta: deltaEvent.delta.text }, parentToolUseId))
      }
      else if (deltaEvent.delta.type === 'thinking_delta') {
        const itemId = `thinking-${deltaEvent.index}`
        chunks.push(withParentMeta({ type: 'reasoning-delta', id: itemId, delta: deltaEvent.delta.thinking }, parentToolUseId))
      }
      else if (deltaEvent.delta.type === 'input_json_delta') {
        const partialJson = (deltaEvent.delta as { type: 'input_json_delta', partial_json: string }).partial_json
        const toolId = state.activeToolBlockIds.get(deltaEvent.index)
        if (toolId && partialJson) {
          chunks.push(withParentMeta({ type: 'tool-input-delta', toolCallId: toolId, inputTextDelta: partialJson }, parentToolUseId))
        }
      }
      break
    }
    case 'content_block_start': {
      const startEvent = msg.event as BetaRawContentBlockStartEvent
      if (startEvent.content_block.type === 'thinking') {
        const itemId = `thinking-${startEvent.index}`
        chunks.push(withParentMeta({ type: 'reasoning-start', id: itemId }, parentToolUseId))
      }
      else if (startEvent.content_block.type === 'tool_use') {
        state.hadToolCallSinceLastText = true
        state.activeToolBlockIds.set(startEvent.index, startEvent.content_block.id)
        chunks.push(withParentMeta({ type: 'tool-input-start', toolCallId: startEvent.content_block.id, toolName: startEvent.content_block.name }, parentToolUseId))
      }
      break
    }
  }

  return { chunks, assistantStarted, sessionId: msg.session_id, usage: null }
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
