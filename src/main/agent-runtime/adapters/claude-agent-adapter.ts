// Input: Claude Agent SDK message types (SDKMessage variants)
// Output: Pure functions mapping Claude Agent SDK messages → TimelineInputEvent
// Position: Adapter layer separating SDK message shapes from internal timeline facts. Testable in isolation.

import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { BetaContentBlock, BetaRawContentBlockDeltaEvent, BetaRawContentBlockStartEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages'

import type { TimelineInputEvent } from '../../backend-control-plane/timeline-events'
import type { TokenUsage } from '../runtime-provider-types'

const BACKEND = 'claude-agent' as const

// ── Public Adapter ──────────────────────────────────────────────────────────

export interface ClaudeAgentAdapterState {
  textItemId: string
  assistantStarted: boolean
}

export interface ClaudeAgentAdapterResult {
  events: TimelineInputEvent[]
  assistantStarted: boolean
  sessionId: string | null
  usage: TokenUsage | null
}

/**
 * Map an SDKMessage into zero or more TimelineInputEvents.
 * Pure function — no side effects.
 */
export function mapClaudeAgentMessage(
  msg: SDKMessage,
  state: ClaudeAgentAdapterState,
): ClaudeAgentAdapterResult {
  const base: ClaudeAgentAdapterResult = {
    events: [],
    assistantStarted: state.assistantStarted,
    sessionId: null,
    usage: null,
  }

  switch (msg.type) {
    case 'assistant':
      return mapAssistant(msg, state)
    case 'stream_event':
      return mapStreamEvent(msg, state)
    case 'result':
      return mapResult(msg, state)
    default:
      // All other SDK message types (system, user, status, etc.) — no timeline mapping needed
      if ('session_id' in msg && typeof msg.session_id === 'string') {
        return { ...base, sessionId: msg.session_id }
      }
      return base
  }
}

// ── Private Helpers ─────────────────────────────────────────────────────────

function mapAssistant(
  msg: SDKAssistantMessage,
  state: ClaudeAgentAdapterState,
): ClaudeAgentAdapterResult {
  const events: TimelineInputEvent[] = []
  let assistantStarted = state.assistantStarted
  const { textItemId } = state

  const content = msg.message.content
  for (const block of content) {
    const mapped = mapContentBlock(block, textItemId, assistantStarted)
    events.push(...mapped.events)
    if (mapped.assistantStarted) {
      assistantStarted = true
    }
  }

  return {
    events,
    assistantStarted,
    sessionId: msg.session_id,
    usage: null,
  }
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
      const thinkId = `thinking-${textItemId}`
      return {
        events: [
          {
            type: 'reasoning.started',
            itemId: thinkId,
            source: { backend: BACKEND, eventType: 'assistant.thinking', itemId: thinkId },
          },
          ...(block.thinking
            ? [{
                type: 'reasoning.delta' as const,
                itemId: thinkId,
                delta: block.thinking,
                source: { backend: BACKEND, eventType: 'assistant.thinking', itemId: thinkId },
              }]
            : []),
          {
            type: 'reasoning.completed',
            itemId: thinkId,
            source: { backend: BACKEND, eventType: 'assistant.thinking', itemId: thinkId },
          },
        ],
        assistantStarted,
      }
    }
    case 'tool_use': {
      const toolId = block.id
      return {
        events: [{
          type: 'tool_call.started',
          itemId: toolId,
          toolName: block.name,
          toolInput: block.input ? JSON.stringify(block.input) : null,
          source: { backend: BACKEND, eventType: 'tool_use', itemId: toolId },
        }],
        assistantStarted,
      }
    }
    default:
      return { events: [], assistantStarted }
  }
}

function mapStreamEvent(
  msg: SDKPartialAssistantMessage,
  state: ClaudeAgentAdapterState,
): ClaudeAgentAdapterResult {
  const event = msg.event
  const events: TimelineInputEvent[] = []
  let assistantStarted = state.assistantStarted
  const { textItemId } = state

  switch (event.type) {
    case 'content_block_delta': {
      const deltaEvent = event as BetaRawContentBlockDeltaEvent
      const delta = deltaEvent.delta
      if (delta.type === 'text_delta') {
        if (!assistantStarted) {
          events.push({
            type: 'assistant.message.started',
            itemId: textItemId,
            source: { backend: BACKEND, eventType: 'stream_event', itemId: textItemId },
          })
          assistantStarted = true
        }
        events.push({
          type: 'assistant.text.delta',
          itemId: textItemId,
          delta: delta.text,
          source: { backend: BACKEND, eventType: 'content_block_delta', itemId: textItemId },
        })
      }
      else if (delta.type === 'thinking_delta') {
        const thinkId = `thinking-${deltaEvent.index}`
        events.push({
          type: 'reasoning.delta',
          itemId: thinkId,
          delta: delta.thinking,
          source: { backend: BACKEND, eventType: 'thinking_delta', itemId: thinkId },
        })
      }
      break
    }
    case 'content_block_start': {
      const startEvent = event as BetaRawContentBlockStartEvent
      const block = startEvent.content_block
      if (block.type === 'thinking') {
        const thinkId = `thinking-${startEvent.index}`
        events.push({
          type: 'reasoning.started',
          itemId: thinkId,
          source: { backend: BACKEND, eventType: 'content_block_start', itemId: thinkId },
        })
      }
      else if (block.type === 'tool_use') {
        events.push({
          type: 'tool_call.started',
          itemId: block.id,
          toolName: block.name,
          toolInput: null,
          source: { backend: BACKEND, eventType: 'content_block_start', itemId: block.id },
        })
      }
      break
    }
    case 'content_block_stop': {
      // Could emit reasoning.completed for thinking blocks
      // but we lack block-type info at stop event — not critical
      break
    }
  }

  return {
    events,
    assistantStarted,
    sessionId: msg.session_id,
    usage: null,
  }
}

function mapResult(
  msg: SDKResultMessage,
  state: ClaudeAgentAdapterState,
): ClaudeAgentAdapterResult {
  let usage: TokenUsage | null = null

  if (msg.usage) {
    const u = msg.usage
    const input = u.input_tokens ?? 0
    const output = u.output_tokens ?? 0
    usage = {
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
    }
  }

  return {
    events: [],
    assistantStarted: state.assistantStarted,
    sessionId: msg.session_id,
    usage,
  }
}
