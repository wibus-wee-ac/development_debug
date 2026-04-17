// Input: ACP SessionNotification.update events from ClientSideConnection
// Output: AcpStreamConverter class that converts ACP updates to AI SDK UIMessageChunk arrays
// Position: Main-process library used by acp-connection to produce UIMessageChunk for IPC streaming

import { randomUUID } from 'node:crypto'

import type {
  ContentBlock,
  ContentChunk,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'
import type { UIMessageChunk } from 'ai'

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

export function mapStopReason(
  acpStopReason: string,
): 'stop' | 'length' | 'content-filter' | 'error' | 'other' {
  switch (acpStopReason) {
    case 'end_turn':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'refusal':
      return 'content-filter'
    case 'cancelled':
      return 'stop'
    default:
      return 'other'
  }
}

export class AcpStreamConverter {
  private currentTextId: string | null = null
  private currentReasoningId: string | null = null

  convert(update: SessionUpdate): UIMessageChunk[] {
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

  flush(): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    if (this.currentReasoningId) {
      chunks.push({ type: 'reasoning-end', id: this.currentReasoningId })
      this.currentReasoningId = null
    }
    if (this.currentTextId) {
      chunks.push({ type: 'text-end', id: this.currentTextId })
      this.currentTextId = null
    }
    return chunks
  }

  private handleAgentMessage(update: ContentChunk): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    const text = extractText(update.content)
    if (text === null) {
      return chunks
    }

    if (this.currentReasoningId) {
      chunks.push({ type: 'reasoning-end', id: this.currentReasoningId })
      this.currentReasoningId = null
    }

    if (!this.currentTextId) {
      this.currentTextId = randomUUID()
      chunks.push({ type: 'text-start', id: this.currentTextId })
    }

    chunks.push({ type: 'text-delta', id: this.currentTextId, delta: text })
    return chunks
  }

  private handleAgentThought(update: ContentChunk): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    const text = extractText(update.content)
    if (text === null) {
      return chunks
    }

    if (this.currentTextId) {
      chunks.push({ type: 'text-end', id: this.currentTextId })
      this.currentTextId = null
    }

    if (!this.currentReasoningId) {
      this.currentReasoningId = randomUUID()
      chunks.push({ type: 'reasoning-start', id: this.currentReasoningId })
    }

    chunks.push({ type: 'reasoning-delta', id: this.currentReasoningId, delta: text })
    return chunks
  }

  private handleToolCall(update: ToolCall): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []

    chunks.push(...this.closeOpenSpans())
    chunks.push({ type: 'tool-input-start', toolCallId: update.toolCallId, toolName: update.title })

    if (update.rawInput !== undefined) {
      chunks.push({ type: 'tool-input-available', toolCallId: update.toolCallId, toolName: update.title, input: update.rawInput })
    }

    if (update.status === 'completed' && update.rawOutput !== undefined) {
      chunks.push({ type: 'tool-output-available', toolCallId: update.toolCallId, output: update.rawOutput })
    }

    return chunks
  }

  private handleToolCallUpdate(update: ToolCallUpdate): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []

    if (update.status === 'completed') {
      chunks.push({ type: 'tool-output-available', toolCallId: update.toolCallId, output: update.rawOutput ?? null })
    }
    else if (update.status === 'failed') {
      const errorText = update.rawOutput != null ? String(update.rawOutput) : 'Tool call failed'
      chunks.push({ type: 'tool-output-error', toolCallId: update.toolCallId, errorText })
    }

    return chunks
  }

  private closeOpenSpans(): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    if (this.currentReasoningId) {
      chunks.push({ type: 'reasoning-end', id: this.currentReasoningId })
      this.currentReasoningId = null
    }
    if (this.currentTextId) {
      chunks.push({ type: 'text-end', id: this.currentTextId })
      this.currentTextId = null
    }
    return chunks
  }
}
