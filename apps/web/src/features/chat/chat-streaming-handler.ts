// Input: UIMessageChunk from SSE stream, useChatStore
// Output: ChatStreamingHandler — accumulates chunks into UIMessage in the store
// Position: Bridge between SSE transport ReadableStream and Zustand store state

import type { UIMessage, UIMessageChunk } from 'ai'

import type { StoredChunkEnvelope } from './sse-chat-transport'
import { useChatStore } from '~/store/chat'

// ── Types ───────────────────────────────────────────────────

type AnyToolPart = {
  type: string
  toolName: string
  toolCallId: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
}

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
      case 'text-start': {
        const meta = (chunk as unknown as { providerMetadata?: unknown }).providerMetadata
        const textPart: Record<string, unknown> = { type: 'text', text: '' }
        if (meta) textPart.providerMetadata = meta
        this.updateParts(parts => [...parts, textPart as unknown as UIMessage['parts'][number]])
        break
      }

      case 'text-delta':
        this.updateParts((parts) => {
          const lastText = findLastTextPart(parts)
          if (lastText) {
            return replaceLast(parts, lastText.index, {
              ...lastText.part,
              text: lastText.part.text + (chunk as { delta: string }).delta,
            })
          }
          // No open text part, create one
          return [...parts, { type: 'text' as const, text: (chunk as { delta: string }).delta }]
        })
        break

      case 'text-end':
        // No-op — text part stays in parts, just won't receive more deltas
        break

      case 'reasoning-start':
        this.updateParts(parts => [...parts, {
          type: 'reasoning' as const,
          text: '',
          reasoning: '',
          details: [{ type: 'text' as const, text: '' }],
        }])
        break

      case 'reasoning-delta':
        this.updateParts((parts) => {
          const lastReasoning = findLastReasoningPart(parts)
          if (lastReasoning) {
            const delta = (chunk as { delta: string }).delta
            return replaceLast(parts, lastReasoning.index, {
              ...lastReasoning.part,
              text: lastReasoning.part.text + delta,
              reasoning: (lastReasoning.part as { reasoning: string }).reasoning + delta,
            })
          }
          return parts
        })
        break

      case 'reasoning-end':
        // Mark reasoning as done (state change)
        this.updateParts((parts) => {
          const lastReasoning = findLastReasoningPart(parts)
          if (lastReasoning) {
            return replaceLast(parts, lastReasoning.index, {
              ...lastReasoning.part,
              state: 'done',
            })
          }
          return parts
        })
        break

      case 'tool-input-start':
        this.handleToolChunk(chunk)
        break

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
        // Unknown chunk type — ignore
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

  private handleToolChunk(chunk: UIMessageChunk): void {
    const toolChunk = chunk as unknown as { toolCallId: string, toolName: string, providerMetadata?: Record<string, unknown> }
    const toolPart: Record<string, unknown> = {
      type: 'dynamic-tool',
      toolCallId: toolChunk.toolCallId,
      toolName: toolChunk.toolName,
      state: 'input-streaming',
      input: undefined,
    }
    if (toolChunk.providerMetadata) {
      toolPart.callProviderMetadata = toolChunk.providerMetadata
    }
    this.updateParts(parts => [...parts, toolPart as unknown as UIMessage['parts'][number]])
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

    this.updateParts((parts) => {
      let updated = [...parts]
      for (const chunk of chunks) {
        updated = applyToolChunk(updated, chunk)
      }
      return updated
    })
  }
}

// ── Helpers ─────────────────────────────────────────────────

function findLastTextPart(parts: UIMessage['parts']): { index: number, part: { type: 'text', text: string } } | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].type === 'text') {
      return { index: i, part: parts[i] as { type: 'text', text: string } }
    }
    // If we hit a non-text part, the last text is "closed"
    if (parts[i].type !== 'text') break
  }
  return null
}

function findLastReasoningPart(parts: UIMessage['parts']): { index: number, part: Record<string, unknown> } | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].type === 'reasoning') {
      return { index: i, part: parts[i] as unknown as Record<string, unknown> }
    }
  }
  return null
}

function replaceLast(parts: UIMessage['parts'], index: number, newPart: unknown): UIMessage['parts'] {
  const updated = [...parts]
  updated[index] = newPart as UIMessage['parts'][number]
  return updated
}

function applyToolChunk(parts: UIMessage['parts'], chunk: UIMessageChunk): UIMessage['parts'] {
  const toolChunk = chunk as unknown as { type: string, toolCallId: string, input?: unknown, output?: unknown, errorText?: string }
  const idx = parts.findIndex(
    p => p.type === 'dynamic-tool' && (p as unknown as AnyToolPart).toolCallId === toolChunk.toolCallId,
  )
  if (idx === -1) return parts

  const existing = parts[idx] as unknown as AnyToolPart
  const updated = [...parts]

  switch (toolChunk.type) {
    case 'tool-input-available':
      updated[idx] = { ...existing, state: 'input-available', input: toolChunk.input } as unknown as UIMessage['parts'][number]
      break
    case 'tool-input-error':
      updated[idx] = { ...existing, state: 'output-error', input: toolChunk.input, errorText: toolChunk.errorText } as unknown as UIMessage['parts'][number]
      break
    case 'tool-output-available':
      updated[idx] = { ...existing, state: 'output-available', output: toolChunk.output } as unknown as UIMessage['parts'][number]
      break
  }

  return updated
}
