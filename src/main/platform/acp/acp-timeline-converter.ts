// Input: ACP SessionUpdate events and Cradle timeline event contracts
// Output: AcpTimelineConverter that maps ACP transport updates into typed timeline facts
// Position: ACP adapter boundary for normalizing backend-native streaming into Cradle-owned events

import { randomUUID } from 'node:crypto'

import type {
  ContentBlock,
  ContentChunk,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'

import type { ProviderKind } from '../../features/agent-runtime/runtime-provider-types'
import type { TimelineInputEvent } from '../../features/backend-control-plane/timeline-events'

export type { SessionUpdate }

export interface AcpTimelineConverterOptions {
  backend: ProviderKind
}

function extractText(block: ContentBlock): string | null {
  if (block.type === 'text') {
    return block.text
  }
  return null
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

export class AcpTimelineConverter {
  private readonly backend: ProviderKind
  private currentMessageItemId: string | null = null
  private currentReasoningItemId: string | null = null

  constructor(options: AcpTimelineConverterOptions) {
    this.backend = options.backend
  }

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
          backend: this.backend,
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
          backend: this.backend,
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
            backend: this.backend,
            eventType: 'agent_message_chunk',
            itemId: this.currentMessageItemId,
          },
        },
        {
          type: 'assistant.text.delta',
          itemId: this.currentMessageItemId,
          delta: text,
          source: {
            backend: this.backend,
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
        backend: this.backend,
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
            backend: this.backend,
            eventType: 'agent_thought_chunk',
            itemId: this.currentReasoningItemId,
          },
        },
        {
          type: 'reasoning.delta',
          itemId: this.currentReasoningItemId,
          delta: text,
          source: {
            backend: this.backend,
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
        backend: this.backend,
        eventType: 'agent_thought_chunk',
        itemId: this.currentReasoningItemId,
      },
    }]
  }

  private handleToolCall(update: ToolCall): TimelineInputEvent[] {
    const itemId = update.toolCallId
    const events: TimelineInputEvent[] = [{
      type: 'command.started',
      itemId,
      command: update.title,
      input: stringifyPayload(update.rawInput),
      source: {
        backend: this.backend,
        eventType: 'tool_call',
        eventId: itemId,
        itemId,
      },
    }]

    const output = stringifyPayload(update.rawOutput)
    if (update.status === 'completed') {
      events.push({
        type: 'command.completed',
        itemId,
        exitCode: 0,
        output,
        source: {
          backend: this.backend,
          eventType: 'tool_call',
          eventId: itemId,
          itemId,
        },
      })
    }

    return events
  }

  private handleToolCallUpdate(update: ToolCallUpdate): TimelineInputEvent[] {
    const itemId = update.toolCallId
    const output = stringifyPayload(update.rawOutput)
    const events: TimelineInputEvent[] = []

    if (output) {
      events.push({
        type: 'command.output.delta',
        itemId,
        stream: 'stdout',
        delta: output,
        source: {
          backend: this.backend,
          eventType: 'tool_call_update',
          eventId: itemId,
          itemId,
        },
      })
    }

    if (update.status === 'completed') {
      events.push({
        type: 'command.completed',
        itemId,
        exitCode: 0,
        output,
        source: {
          backend: this.backend,
          eventType: 'tool_call_update',
          eventId: itemId,
          itemId,
        },
      })
    }

    return events
  }
}
