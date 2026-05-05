// Input: ACP SessionNotification.update events from ClientSideConnection
// Output: AcpResponsesConverter class that converts ACP updates to ResponseStreamEvent arrays
// Position: ACP capability module used by acp-connection to produce OpenAI-style stream events

import { randomUUID } from 'node:crypto'

import type {
  ContentBlock,
  ContentChunk,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'
import type {
  ResponseFunctionToolCallItem,
  ResponseOutputMessage,
  ResponseOutputText,
  ResponseReasoningSummaryPartAddedEvent,
  ResponseReasoningSummaryPartDoneEvent,
} from 'openai/resources/responses/responses'

import type { ResponseStreamEvent } from '../../features/chat/chat-provider'

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
  private currentTextValue = ''
  private currentReasoningItemId: string | null = null
  private currentReasoningText = ''
  private currentReasoningSummaryIndex = 0
  private currentReasoningOutputIndex: number | null = null
  private outputIndex = 0
  private sequenceNumber = 0

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
        output_index: this.currentReasoningOutputIndex ?? this.outputIndex,
        part: this.buildReasoningPart('done'),
        sequence_number: this.nextSequenceNumber(),
        summary_index: this.currentReasoningSummaryIndex - 1,
      })
      this.currentReasoningItemId = null
      this.currentReasoningText = ''
      this.currentReasoningOutputIndex = null
    }

    if (this.currentTextItemId) {
      chunks.push({
        type: 'response.output_item.done',
        output_index: this.outputIndex,
        item: this.buildMessageItem('completed'),
        sequence_number: this.nextSequenceNumber(),
      })
      this.currentTextItemId = null
      this.currentTextValue = ''
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
        output_index: this.currentReasoningOutputIndex ?? this.outputIndex,
        part: this.buildReasoningPart('done'),
        sequence_number: this.nextSequenceNumber(),
        summary_index: this.currentReasoningSummaryIndex - 1,
      })
      this.currentReasoningItemId = null
      this.currentReasoningText = ''
      this.currentReasoningOutputIndex = null
    }

    if (!this.currentTextItemId) {
      this.currentTextItemId = randomUUID()
      this.currentTextValue = ''
      this.outputIndex++
      chunks.push({
        type: 'response.output_item.added',
        output_index: this.outputIndex,
        item: this.buildMessageItem('in_progress'),
        sequence_number: this.nextSequenceNumber(),
      })
    }

    this.currentTextValue += text
    chunks.push({
      type: 'response.output_text.delta',
      item_id: this.currentTextItemId,
      content_index: 0,
      delta: text,
      logprobs: [],
      output_index: this.outputIndex,
      sequence_number: this.nextSequenceNumber(),
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
        item: this.buildMessageItem('completed'),
        sequence_number: this.nextSequenceNumber(),
      })
      this.currentTextItemId = null
      this.currentTextValue = ''
    }

    if (!this.currentReasoningItemId) {
      this.currentReasoningItemId = randomUUID()
      this.currentReasoningText = ''
      this.currentReasoningSummaryIndex = 0
      this.currentReasoningOutputIndex = this.outputIndex + 1
      chunks.push({
        type: 'response.reasoning_summary_part.added',
        item_id: this.currentReasoningItemId,
        output_index: this.currentReasoningOutputIndex,
        part: this.buildReasoningPart('added'),
        sequence_number: this.nextSequenceNumber(),
        summary_index: this.currentReasoningSummaryIndex,
      })
      this.currentReasoningSummaryIndex++
    }

    this.currentReasoningText += text
    chunks.push({
      type: 'response.reasoning_summary_text.delta',
      item_id: this.currentReasoningItemId,
      output_index: this.currentReasoningOutputIndex ?? this.outputIndex,
      sequence_number: this.nextSequenceNumber(),
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
      item: this.buildFunctionCallItem({
        id: callId,
        callId,
        name: update.title,
        argumentsText: '',
        status: 'in_progress',
      }),
      sequence_number: this.nextSequenceNumber(),
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
        item: this.buildFunctionCallItem({
          id: callId,
          callId,
          name: update.title,
          argumentsText: encodedArgs,
          status: 'completed',
        }),
        sequence_number: this.nextSequenceNumber(),
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
        item: this.buildFunctionCallItem({
          id: update.toolCallId,
          callId: update.toolCallId,
          name: '',
          argumentsText: encodedArgs,
          status: 'completed',
        }),
        sequence_number: this.nextSequenceNumber(),
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
        output_index: this.currentReasoningOutputIndex ?? this.outputIndex,
        part: this.buildReasoningPart('done'),
        sequence_number: this.nextSequenceNumber(),
        summary_index: this.currentReasoningSummaryIndex - 1,
      })
      this.currentReasoningItemId = null
      this.currentReasoningText = ''
      this.currentReasoningOutputIndex = null
    }

    if (this.currentTextItemId) {
      chunks.push({
        type: 'response.output_item.done',
        output_index: this.outputIndex,
        item: this.buildMessageItem('completed'),
        sequence_number: this.nextSequenceNumber(),
      })
      this.currentTextItemId = null
      this.currentTextValue = ''
    }

    return chunks
  }

  private nextSequenceNumber(): number {
    const next = this.sequenceNumber
    this.sequenceNumber += 1
    return next
  }

  private buildMessageItem(status: ResponseOutputMessage['status']): ResponseOutputMessage {
    const content: ResponseOutputMessage['content'] = this.currentTextValue.length > 0
      ? [this.buildOutputTextPart(this.currentTextValue)]
      : []

    return {
      type: 'message',
      id: this.currentTextItemId!,
      role: 'assistant',
      status,
      content,
    }
  }

  private buildOutputTextPart(text: string): ResponseOutputText {
    return {
      type: 'output_text',
      text,
      annotations: [],
    }
  }

  private buildReasoningPart(
    _phase: 'added' | 'done',
  ): ResponseReasoningSummaryPartAddedEvent.Part | ResponseReasoningSummaryPartDoneEvent.Part {
    return {
      type: 'summary_text',
      text: this.currentReasoningText,
    }
  }

  private buildFunctionCallItem(args: {
    id: string
    callId: string
    name: string
    argumentsText: string
    status: ResponseFunctionToolCallItem['status']
  }): ResponseFunctionToolCallItem {
    return {
      type: 'function_call',
      id: args.id,
      call_id: args.callId,
      name: args.name,
      arguments: args.argumentsText,
      status: args.status,
    }
  }
}
