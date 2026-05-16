// Input: UIMessageChunk from SSE stream, useChatStore
// Output: ChatStreamingHandler — accumulates chunks into UIMessage in the store
// Position: Bridge between SSE transport ReadableStream and Zustand store state

import type { UIMessage, UIMessageChunk } from 'ai'

import type { StoredChunkEnvelope } from './sse-chat-transport'
import {
  applyAssistantChunk,
  applyAssistantChunks,
  createAssistantChunkProjection,
  type AssistantChunkProjection,
} from './chat-chunk-reducer'
import { useChatStore } from '~/store/chat'

// ── Handler ─────────────────────────────────────────────────

/**
 * Accumulates UIMessageChunks from an SSE stream into a UIMessage stored in Zustand.
 * Implements the full chunk state machine matching the AI SDK protocol.
 *
 * Usage:
 *   const handler = new ChatStreamingHandler(sessionId, messageId)
 *   handler.start(controller)
 *   for await (const chunk of stream) handler.handleChunk(chunk)
 *   handler.finish()
 */
export class ChatStreamingHandler {
  private sessionId: string
  private messageId: string
  private toolUpdateTimer: ReturnType<typeof setTimeout> | null = null
  private pendingToolChunks: UIMessageChunk[] = []
  private projection: AssistantChunkProjection = createAssistantChunkProjection()
  private terminated = false

  constructor(sessionId: string, messageId: string) {
    this.sessionId = sessionId
    this.messageId = messageId
  }

  /**
   * Register this handler with the store and create the initial assistant message.
   */
  start(controller: AbortController): void {
    const store = useChatStore.getState()
    this.projection = createAssistantChunkProjection()

    // Create initial empty assistant message
    const message: UIMessage = {
      id: this.messageId,
      role: 'assistant',
      parts: [],
    }
    store.appendMessage(this.sessionId, message)
    store.startGeneration(this.sessionId, this.messageId, controller)
  }

  /**
   * Process a single chunk envelope from the SSE stream.
   * Subagent chunks (parentToolCallId != null) are routed to the subagent map.
   * Main chunks produce an immutable update to the message in the store.
   */
  handleChunk(envelope: StoredChunkEnvelope): void {
    const { chunk, parentToolCallId } = envelope

    // Route subagent chunks to a separate collection
    if (parentToolCallId) {
      useChatStore.getState().appendSubagentChunk(this.messageId, parentToolCallId, chunk)
      return
    }

    switch (chunk.type) {
      case 'tool-input-available':
      case 'tool-input-error':
      case 'tool-output-available':
        // Throttle tool updates at 300ms
        this.scheduleToolUpdate(chunk)
        break

      case 'finish':
      case 'abort':
        // Terminal events handled externally (finish/fail)
        break

      case 'error': {
        const errorChunk = chunk as { errorText?: string }
        this.fail(errorChunk.errorText ?? 'Unknown error')
        break
      }

      default:
        this.applyChunk(chunk)
        break
    }
  }

  /**
   * Mark generation as complete. Call after the stream ends normally.
   */
  finish(): void {
    if (this.terminated) return
    this.terminated = true
    this.flushToolUpdates()
    useChatStore.getState().finishGeneration(this.messageId)
  }

  /**
   * Mark generation as failed with an error message.
   */
  fail(error: string): void {
    if (this.terminated) return
    this.terminated = true
    this.flushToolUpdates()
    useChatStore.getState().failGeneration(this.messageId, error)
  }

  /**
   * Clean up any pending timers.
   */
  dispose(): void {
    if (this.toolUpdateTimer) {
      clearTimeout(this.toolUpdateTimer)
      this.toolUpdateTimer = null
    }
  }

  // ── Private ─────────────────────────────────────────────

  private updateParts(updater: (parts: UIMessage['parts']) => UIMessage['parts']): void {
    useChatStore.getState().updateMessage(this.sessionId, this.messageId, (msg) => ({
      ...msg,
      parts: updater(msg.parts),
    }))
  }

  private applyChunk(chunk: UIMessageChunk): void {
    const nextProjection = applyAssistantChunk(this.projection, chunk)
    if (nextProjection === this.projection) {
      return
    }
    this.projection = nextProjection
    this.syncProjectionParts()
  }

  private scheduleToolUpdate(chunk: UIMessageChunk): void {
    this.pendingToolChunks.push(chunk)
    if (!this.toolUpdateTimer) {
      this.toolUpdateTimer = setTimeout(() => {
        this.flushToolUpdates()
      }, 300)
    }
  }

  private flushToolUpdates(): void {
    if (this.toolUpdateTimer) {
      clearTimeout(this.toolUpdateTimer)
      this.toolUpdateTimer = null
    }
    if (this.pendingToolChunks.length === 0) return

    const chunks = this.pendingToolChunks
    this.pendingToolChunks = []

    const nextProjection = applyAssistantChunks(this.projection, chunks)
    if (nextProjection === this.projection) {
      return
    }
    this.projection = nextProjection
    this.syncProjectionParts()
  }

  private syncProjectionParts(): void {
    const nextParts = this.projection.parts
    this.updateParts(() => nextParts)
  }
}
