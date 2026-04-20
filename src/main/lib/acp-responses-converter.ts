// Input: ACP SessionNotification.update events from ClientSideConnection
// Output: AcpResponsesConverter class that converts ACP updates to ResponseStreamEvent arrays
// Position: Main-process library used by acp-connection to produce OpenAI-style stream events

import { randomUUID } from 'node:crypto'

import type {
  ContentBlock,
  ContentChunk,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'

import type { ResponseStreamEvent } from './chat-provider'

export type { SessionUpdate }

export interface AcpSessionUpdateData {
  agentId: string
  sessionId: string
  update: SessionUpdate
}

function extractText(block: ContentBlock): string | null {
  if (block.type === 'text') {
    return block.text
  }
  return null
}

/**
 * Stateful converter that translates ACP session update events into
 * OpenAI Responses API-style stream events (`ResponseStreamEvent`).
 *
 * Create one instance per in-flight ACP prompt session.  Call `convert()`
 * for each `SessionUpdate` received, then `flush()` once after the prompt
 * promise resolves to close any open spans.
 *
 * ACP tool output (server-side tool execution) has no equivalent slot in the
 * OpenAI Responses API format.  We encode `{ input, output }` as a JSON string
 * in the `arguments` field of the `response.output_item.done` event for
 * function_call items.  The frontend converter decodes this.
 */
export class AcpResponsesConverter {
  private currentTextItemId: string | null = null
  private currentReasoningItemId: string | null = null
  private currentReasoningSummaryIndex = 0
  private outputIndex = 0

  convert(update: SessionUpdate): ResponseStreamEvent[] {
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

  flush(): ResponseStreamEvent[] {
    const chunks: ResponseStreamEvent[] = []

    if (this.currentReasoningSummaryIndex > 0 && this.currentReasoningItemId) {
      chunks.push({
        type: 'response.reasoning_summary_part.done',
        item_id: this.currentReasoningItemId,
        summary_index: this.currentReasoningSummaryIndex - 1,
      })
      this.currentReasoningItemId = null
    }

    if (this.currentTextItemId) {
      chunks.push({
        type: 'response.output_item.done',
        output_index: this.outputIndex,
        item: {
          type: 'message',
          id: this.currentTextItemId,
        },
      })
      this.currentTextItemId = null
    }

    return chunks
  }

  private handleAgentMessage(update: ContentChunk): ResponseStreamEvent[] {
    const chunks: ResponseStreamEvent[] = []
    const text = extractText(update.content)
    if (text === null) {
      return chunks
    }

    // Close any open reasoning span before text
    if (this.currentReasoningItemId) {
      chunks.push({
        type: 'response.reasoning_summary_part.done',
        item_id: this.currentReasoningItemId,
        summary_index: this.currentReasoningSummaryIndex - 1,
      })
      this.currentReasoningItemId = null
    }

    if (!this.currentTextItemId) {
      this.currentTextItemId = randomUUID()
      this.outputIndex++
      chunks.push({
        type: 'response.output_item.added',
        output_index: this.outputIndex,
        item: {
          type: 'message',
          id: this.currentTextItemId,
        },
      })
    }

    chunks.push({
      type: 'response.output_text.delta',
      item_id: this.currentTextItemId,
      delta: text,
    })

    return chunks
  }

  private handleAgentThought(update: ContentChunk): ResponseStreamEvent[] {
    const chunks: ResponseStreamEvent[] = []
    const text = extractText(update.content)
    if (text === null) {
      return chunks
    }

    // Close any open text span before reasoning
    if (this.currentTextItemId) {
      chunks.push({
        type: 'response.output_item.done',
        output_index: this.outputIndex,
        item: {
          type: 'message',
          id: this.currentTextItemId,
        },
      })
      this.currentTextItemId = null
    }

    if (!this.currentReasoningItemId) {
      this.currentReasoningItemId = randomUUID()
      this.currentReasoningSummaryIndex = 0
      chunks.push({
        type: 'response.reasoning_summary_part.added',
        item_id: this.currentReasoningItemId,
        summary_index: this.currentReasoningSummaryIndex,
      })
      this.currentReasoningSummaryIndex++
    }

    chunks.push({
      type: 'response.reasoning_summary_text.delta',
      item_id: this.currentReasoningItemId,
      summary_index: this.currentReasoningSummaryIndex - 1,
      delta: text,
    })

    return chunks
  }

  private handleToolCall(update: ToolCall): ResponseStreamEvent[] {
    const chunks: ResponseStreamEvent[] = []

    // Close any open spans
    chunks.push(...this.closeOpenSpans())

    this.outputIndex++
    const callId = update.toolCallId

    chunks.push({
      type: 'response.output_item.added',
      output_index: this.outputIndex,
      item: {
        type: 'function_call',
        id: callId,
        call_id: callId,
        name: update.title,
        arguments: '',
      },
    })

    if (update.status === 'completed') {
      // Encode both input and output so the frontend can extract tool output
      const encodedArgs = JSON.stringify({
        input: update.rawInput ?? null,
        output: update.rawOutput ?? null,
      })
      chunks.push({
        type: 'response.output_item.done',
        output_index: this.outputIndex,
        item: {
          type: 'function_call',
          id: callId,
          call_id: callId,
          name: update.title,
          arguments: encodedArgs,
          status: 'completed',
        },
      })
    }

    return chunks
  }

  private handleToolCallUpdate(update: ToolCallUpdate): ResponseStreamEvent[] {
    const chunks: ResponseStreamEvent[] = []

    if (update.status === 'completed') {
      const encodedArgs = JSON.stringify({
        input: null,
        output: update.rawOutput ?? null,
      })
      chunks.push({
        type: 'response.output_item.done',
        output_index: this.outputIndex,
        item: {
          type: 'function_call',
          id: update.toolCallId,
          call_id: update.toolCallId,
          name: '',
          arguments: encodedArgs,
          status: 'completed',
        },
      })
    }

    return chunks
  }

  private closeOpenSpans(): ResponseStreamEvent[] {
    const chunks: ResponseStreamEvent[] = []

    if (this.currentReasoningItemId) {
      chunks.push({
        type: 'response.reasoning_summary_part.done',
        item_id: this.currentReasoningItemId,
        summary_index: this.currentReasoningSummaryIndex - 1,
      })
      this.currentReasoningItemId = null
    }

    if (this.currentTextItemId) {
      chunks.push({
        type: 'response.output_item.done',
        output_index: this.outputIndex,
        item: {
          type: 'message',
          id: this.currentTextItemId,
        },
      })
      this.currentTextItemId = null
    }

    return chunks
  }
}
