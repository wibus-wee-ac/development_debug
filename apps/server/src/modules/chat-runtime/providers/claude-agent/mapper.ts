// Input: Claude Agent SDK message types
// Output: Claude SDK message -> unified chat timeline mapper
// Position: apps/server/src/modules/chat-runtime/providers/claude-agent/mapper.ts

import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { BetaContentBlock, BetaRawContentBlockDeltaEvent, BetaRawContentBlockStartEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages'

import type { TimelineInputEvent, TokenUsage } from '../../runtime-provider-types'

const BACKEND = 'claude-agent' as const

export interface ClaudeAgentTimelineMapperState {
  textItemId: string
  assistantStarted: boolean
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

  for (const block of msg.message.content) {
    const mapped = mapContentBlock(block, state.textItemId, assistantStarted)
    events.push(...mapped.events)
    if (mapped.assistantStarted) {
      assistantStarted = true
    }
  }

  return { events, assistantStarted, sessionId: msg.session_id, usage: null }
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
  const { textItemId } = state

  switch (msg.event.type) {
    case 'content_block_delta': {
      const deltaEvent = msg.event as BetaRawContentBlockDeltaEvent
      if (deltaEvent.delta.type === 'text_delta') {
        if (!assistantStarted) {
          events.push({ type: 'assistant.message.started', itemId: textItemId, source: { backend: BACKEND, eventType: 'stream_event', itemId: textItemId } })
          assistantStarted = true
        }
        events.push({
          type: 'assistant.text.delta',
          itemId: textItemId,
          delta: deltaEvent.delta.text,
          source: { backend: BACKEND, eventType: 'content_block_delta', itemId: textItemId },
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
      break
    }
    case 'content_block_start': {
      const startEvent = msg.event as BetaRawContentBlockStartEvent
      if (startEvent.content_block.type === 'thinking') {
        const itemId = `thinking-${startEvent.index}`
        events.push({ type: 'reasoning.started', itemId, source: { backend: BACKEND, eventType: 'content_block_start', itemId } })
      }
      else if (startEvent.content_block.type === 'tool_use') {
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
