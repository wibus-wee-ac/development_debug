// Input: ACP SessionUpdate notifications
// Output: unified chat timeline events for the server chat-runtime owner
// Position: apps/server chat-runtime ACP event normalization boundary

import { randomUUID } from 'node:crypto'

import type {
  ContentBlock,
  ContentChunk,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'

import type { TimelineInputEvent } from '../../runtime-provider-types'

export class AcpTimelineMapper {
  private currentMessageItemId: string | null = null
  private currentReasoningItemId: string | null = null

  convert(update: SessionUpdate): TimelineInputEvent[] {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        return this.handleAgentMessage(update as ContentChunk & { sessionUpdate: 'agent_message_chunk' })
      case 'agent_thought_chunk':
        return this.handleAgentThought(update as ContentChunk & { sessionUpdate: 'agent_thought_chunk' })
      case 'tool_call':
        return this.handleToolCall(update as ToolCall & { sessionUpdate: 'tool_call' })
      case 'tool_call_update':
        return this.handleToolCallUpdate(update as ToolCallUpdate & { sessionUpdate: 'tool_call_update' })
      default:
        return []
    }
  }

  flush(): TimelineInputEvent[] {
    const events: TimelineInputEvent[] = []

    if (this.currentReasoningItemId) {
      events.push({
        type: 'reasoning.completed',
        itemId: this.currentReasoningItemId,
        source: {
          backend: 'acp-chat',
          eventType: 'session.flush',
          itemId: this.currentReasoningItemId,
        },
      })
      this.currentReasoningItemId = null
    }

    if (this.currentMessageItemId) {
      events.push({
        type: 'assistant.message.completed',
        itemId: this.currentMessageItemId,
        source: {
          backend: 'acp-chat',
          eventType: 'session.flush',
          itemId: this.currentMessageItemId,
        },
      })
      this.currentMessageItemId = null
    }

    return events
  }

  private handleAgentMessage(update: ContentChunk): TimelineInputEvent[] {
    const text = extractText(update.content)
    if (text === null) {
      return []
    }

    if (!this.currentMessageItemId) {
      this.currentMessageItemId = randomUUID()
      return [
        {
          type: 'assistant.message.started',
          itemId: this.currentMessageItemId,
          source: {
            backend: 'acp-chat',
            eventType: 'agent_message_chunk',
            itemId: this.currentMessageItemId,
          },
        },
        {
          type: 'assistant.text.delta',
          itemId: this.currentMessageItemId,
          delta: text,
          source: {
            backend: 'acp-chat',
            eventType: 'agent_message_chunk',
            itemId: this.currentMessageItemId,
          },
        },
      ]
    }

    return [{
      type: 'assistant.text.delta',
      itemId: this.currentMessageItemId,
      delta: text,
      source: {
        backend: 'acp-chat',
        eventType: 'agent_message_chunk',
        itemId: this.currentMessageItemId,
      },
    }]
  }

  private handleAgentThought(update: ContentChunk): TimelineInputEvent[] {
    const text = extractText(update.content)
    if (text === null) {
      return []
    }

    if (!this.currentReasoningItemId) {
      this.currentReasoningItemId = randomUUID()
      return [
        {
          type: 'reasoning.started',
          itemId: this.currentReasoningItemId,
          source: {
            backend: 'acp-chat',
            eventType: 'agent_thought_chunk',
            itemId: this.currentReasoningItemId,
          },
        },
        {
          type: 'reasoning.delta',
          itemId: this.currentReasoningItemId,
          delta: text,
          source: {
            backend: 'acp-chat',
            eventType: 'agent_thought_chunk',
            itemId: this.currentReasoningItemId,
          },
        },
      ]
    }

    return [{
      type: 'reasoning.delta',
      itemId: this.currentReasoningItemId,
      delta: text,
      source: {
        backend: 'acp-chat',
        eventType: 'agent_thought_chunk',
        itemId: this.currentReasoningItemId,
      },
    }]
  }

  private handleToolCall(update: ToolCall): TimelineInputEvent[] {
    const output = stringifyPayload(update.rawOutput)
    const events: TimelineInputEvent[] = [{
      type: 'command.started',
      itemId: update.toolCallId,
      command: update.title,
      source: {
        backend: 'acp-chat',
        eventType: 'tool_call',
        eventId: update.toolCallId,
        itemId: update.toolCallId,
      },
    }]

    if (update.status === 'completed') {
      events.push({
        type: 'command.completed',
        itemId: update.toolCallId,
        exitCode: 0,
        output,
        source: {
          backend: 'acp-chat',
          eventType: 'tool_call',
          eventId: update.toolCallId,
          itemId: update.toolCallId,
        },
      })
    }

    return events
  }

  private handleToolCallUpdate(update: ToolCallUpdate): TimelineInputEvent[] {
    const output = stringifyPayload(update.rawOutput)
    const events: TimelineInputEvent[] = []

    if (output) {
      events.push({
        type: 'command.output.delta',
        itemId: update.toolCallId,
        stream: 'stdout',
        delta: output,
        source: {
          backend: 'acp-chat',
          eventType: 'tool_call_update',
          eventId: update.toolCallId,
          itemId: update.toolCallId,
        },
      })
    }

    if (update.status === 'completed') {
      events.push({
        type: 'command.completed',
        itemId: update.toolCallId,
        exitCode: 0,
        output,
        source: {
          backend: 'acp-chat',
          eventType: 'tool_call_update',
          eventId: update.toolCallId,
          itemId: update.toolCallId,
        },
      })
    }

    return events
  }
}

function extractText(block: ContentBlock): string | null {
  return block.type === 'text' ? block.text : null
}

function stringifyPayload(value: unknown): string | null {
  if (value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}