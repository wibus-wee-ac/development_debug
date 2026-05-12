// Input: Claude Agent SDK message types
// Output: Claude SDK message -> unified chat timeline mapper
// Position: apps/server/src/modules/chat-runtime/providers/claude-agent/mapper.ts

import { randomUUID } from 'node:crypto'

import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage, SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { BetaContentBlock, BetaRawContentBlockDeltaEvent, BetaRawContentBlockStartEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages'

import type { TimelineInputEvent, TokenUsage } from '../../runtime-provider-types'

const BACKEND = 'claude-agent' as const

export interface ClaudeAgentTimelineMapperState {
  textItemId: string
  assistantStarted: boolean
  /** True when tool calls have been emitted since last text segment — next text gets a fresh ID */
  hadToolCallSinceLastText: boolean
  /** Maps content block index → tool_use block ID for streaming tool input deltas */
  activeToolBlockIds: Map<number, string>
}

export interface ClaudeAgentTimelineMapperResult {
  events: TimelineInputEvent[]
  assistantStarted: boolean
  sessionId: string | null
  usage: TokenUsage | null
}

export function mapClaudeAgentMessageToTimeline(msg: SDKMessage, state: ClaudeAgentTimelineMapperState): ClaudeAgentTimelineMapperResult {
  const base: ClaudeAgentTimelineMapperResult = {
    events: [],
    assistantStarted: state.assistantStarted,
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
      if ('session_id' in msg && typeof msg.session_id === 'string') {
        return { ...base, sessionId: msg.session_id }
      }
      return base
  }
}

function mapAssistant(msg: SDKAssistantMessage, state: ClaudeAgentTimelineMapperState): ClaudeAgentTimelineMapperResult {
  const events: TimelineInputEvent[] = []
  let assistantStarted = state.assistantStarted

  // If tool calls happened since last text, rotate to a new text segment ID
  if (state.hadToolCallSinceLastText) {
    state.textItemId = randomUUID()
    state.hadToolCallSinceLastText = false
    // New text segment starts fresh — the previous one was already completed
    assistantStarted = false
  }

  let hadToolCall = false
  for (const block of msg.message.content) {
    const mapped = mapContentBlock(block, state.textItemId, assistantStarted)
    events.push(...mapped.events)
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

  return { events, assistantStarted, sessionId: msg.session_id, usage: null }
}

function mapUser(msg: SDKUserMessage, state: ClaudeAgentTimelineMapperState): ClaudeAgentTimelineMapperResult {
  const events: TimelineInputEvent[] = []
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
              : null
          events.push({
            type: 'tool_call.completed',
            itemId: b.tool_use_id,
            result: b.is_error ? `Error: ${output ?? 'Tool execution failed'}` : output,
            source: { backend: BACKEND, eventType: 'tool_result', itemId: b.tool_use_id },
          })
        }
      }
    }
  }

  return { events, assistantStarted: state.assistantStarted, sessionId: msg.session_id ?? null, usage: null }
}

function mapContentBlock(
  block: BetaContentBlock,
  textItemId: string,
  assistantStarted: boolean,
): { events: TimelineInputEvent[], assistantStarted: boolean } {
  switch (block.type) {
    case 'text': {
      const events: TimelineInputEvent[] = []
      if (!assistantStarted) {
        events.push({
          type: 'assistant.message.started',
          itemId: textItemId,
          source: { backend: BACKEND, eventType: 'assistant', itemId: textItemId },
        })
      }
      if (block.text) {
        events.push({
          type: 'assistant.text.delta',
          itemId: textItemId,
          delta: block.text,
          source: { backend: BACKEND, eventType: 'assistant.text', itemId: textItemId },
        })
      }
      return { events, assistantStarted: true }
    }
    case 'thinking': {
      const itemId = `thinking-${textItemId}`
      const events: TimelineInputEvent[] = [
        { type: 'reasoning.started', itemId, source: { backend: BACKEND, eventType: 'assistant.thinking', itemId } },
      ]
      if (block.thinking) {
        events.push({
          type: 'reasoning.delta',
          itemId,
          delta: block.thinking,
          source: { backend: BACKEND, eventType: 'assistant.thinking', itemId },
        })
      }
      events.push({ type: 'reasoning.completed', itemId, source: { backend: BACKEND, eventType: 'assistant.thinking', itemId } })
      return { events, assistantStarted }
    }
    case 'tool_use':
      return {
        events: [{
          type: 'tool_call.started',
          itemId: block.id,
          toolName: block.name,
          toolInput: block.input ? JSON.stringify(block.input) : null,
          source: { backend: BACKEND, eventType: 'tool_use', itemId: block.id },
        }],
        assistantStarted,
      }
    default:
      return { events: [], assistantStarted }
  }
}

function mapStreamEvent(msg: SDKPartialAssistantMessage, state: ClaudeAgentTimelineMapperState): ClaudeAgentTimelineMapperResult {
  const events: TimelineInputEvent[] = []
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
          events.push({ type: 'assistant.message.started', itemId: state.textItemId, source: { backend: BACKEND, eventType: 'stream_event', itemId: state.textItemId } })
          assistantStarted = true
        }
        events.push({
          type: 'assistant.text.delta',
          itemId: state.textItemId,
          delta: deltaEvent.delta.text,
          source: { backend: BACKEND, eventType: 'content_block_delta', itemId: state.textItemId },
        })
      }
      else if (deltaEvent.delta.type === 'thinking_delta') {
        const itemId = `thinking-${deltaEvent.index}`
        events.push({
          type: 'reasoning.delta',
          itemId,
          delta: deltaEvent.delta.thinking,
          source: { backend: BACKEND, eventType: 'thinking_delta', itemId },
        })
      }
      else if (deltaEvent.delta.type === 'input_json_delta') {
        const partialJson = (deltaEvent.delta as { type: 'input_json_delta', partial_json: string }).partial_json
        const toolId = state.activeToolBlockIds.get(deltaEvent.index)
        if (toolId && partialJson) {
          events.push({
            type: 'tool_call.input.delta',
            itemId: toolId,
            delta: partialJson,
            source: { backend: BACKEND, eventType: 'input_json_delta', itemId: toolId },
          })
        }
      }
      break
    }
    case 'content_block_start': {
      const startEvent = msg.event as BetaRawContentBlockStartEvent
      if (startEvent.content_block.type === 'thinking') {
        const itemId = `thinking-${startEvent.index}`
        events.push({ type: 'reasoning.started', itemId, source: { backend: BACKEND, eventType: 'content_block_start', itemId } })
      }
      else if (startEvent.content_block.type === 'tool_use') {
        state.hadToolCallSinceLastText = true
        state.activeToolBlockIds.set(startEvent.index, startEvent.content_block.id)
        events.push({
          type: 'tool_call.started',
          itemId: startEvent.content_block.id,
          toolName: startEvent.content_block.name,
          toolInput: null,
          source: { backend: BACKEND, eventType: 'content_block_start', itemId: startEvent.content_block.id },
        })
      }
      break
    }
  }

  return { events, assistantStarted, sessionId: msg.session_id, usage: null }
}

function mapResult(msg: SDKResultMessage, state: ClaudeAgentTimelineMapperState): ClaudeAgentTimelineMapperResult {
  const usage = msg.usage
    ? {
        promptTokens: msg.usage.input_tokens ?? 0,
        completionTokens: msg.usage.output_tokens ?? 0,
        totalTokens: (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0),
      }
    : null

  return { events: [], assistantStarted: state.assistantStarted, sessionId: msg.session_id, usage }
}
