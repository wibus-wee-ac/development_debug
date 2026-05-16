// Input: chat delta events from SSE stream, useChatStore
// Output: ChatStreamingHandler — accumulates sequenced part deltas into UIMessage in the store
// Position: Bridge between SSE transport ReadableStream and Zustand store state

import type { UIMessage } from 'ai'

import {
  applyChatPartDeltas,
  type ChatPartDelta,
  type ChatStreamEvent,
  type SubagentMessageContext,
} from './chat-delta-events'
import { useChatStore } from '~/store/chat'

// ── Handler ─────────────────────────────────────────────────

/**
 * Applies server-computed message part deltas into UIMessage snapshots stored in Zustand.
 *
 * Usage:
 *   const handler = new ChatStreamingHandler(sessionId, messageId)
 *   handler.start(controller)
 *   for await (const event of stream) handler.handleEvent(event)
 *   handler.finish()
 */
export class ChatStreamingHandler {
  private sessionId: string
  private messageId: string
  private activeMessageId: string | null = null
  private seenSeqsByStream = new Map<string, Set<number>>()
  private terminated = false

  constructor(sessionId: string, messageId: string) {
    this.sessionId = sessionId
    this.messageId = messageId
  }

  /**
   * Register this handler with the store and create the initial assistant message.
   */
  start(controller: AbortController): void {
    useChatStore.getState().startGeneration(this.sessionId, this.messageId, controller)
  }

  /**
   * Process a single chat stream event from the SSE stream.
   */
  handleEvent(event: ChatStreamEvent): void {
    switch (event.type) {
      case 'message_delta':
        this.applyMainDeltas(event.data.messageId, event.data.deltas)
        break
      case 'subagent_message_delta':
        this.applySubagentDeltas(event.data.context, event.data.deltas)
        break
      case 'run_completed':
      case 'run_aborted':
        this.finish()
        break
      case 'run_failed':
        this.fail(event.data.errorText)
        break
    }
  }

  /**
   * Mark generation as complete. Call after the stream ends normally.
   */
  finish(): void {
    if (this.terminated) return
    this.terminated = true
    useChatStore.getState().finishGeneration(this.activeMessageId ?? this.messageId)
  }

  /**
   * Mark generation as failed with an error message.
   */
  fail(error: string): void {
    if (this.terminated) return
    this.terminated = true
    useChatStore.getState().failGeneration(this.activeMessageId ?? this.messageId, error)
  }

  /**
   * Clean up any pending timers.
   */
  dispose(): void {
  }

  // ── Private ─────────────────────────────────────────────

  private applyMainDeltas(messageId: string, deltas: ChatPartDelta[]): void {
    const nextDeltas = this.readNewDeltas(`message:${messageId}`, deltas)
    if (nextDeltas.length === 0) {
      return
    }
    this.activateServerMessage(messageId)
    useChatStore.getState().updateMessage(this.sessionId, messageId, message => applyChatPartDeltas(message, nextDeltas))
  }

  private applySubagentDeltas(context: SubagentMessageContext, deltas: ChatPartDelta[]): void {
    const nextDeltas = this.readNewDeltas(
      `subagent:${context.parentMessageId}:${context.parentToolCallId}:${context.messageId}`,
      deltas,
    )
    if (nextDeltas.length === 0) {
      return
    }
    const store = useChatStore.getState()
    const current = store.subagentMessagesMap
      .get(context.parentMessageId)
      ?.get(context.parentToolCallId)
      ?.find(message => message.id === context.messageId) ?? {
        id: context.messageId,
        role: 'assistant' as const,
        parts: [],
      }
    store.upsertSubagentMessage(
      context.parentMessageId,
      context.parentToolCallId,
      applyChatPartDeltas(current, nextDeltas),
    )
  }

  private activateServerMessage(messageId: string): void {
    if (this.activeMessageId === messageId) {
      return
    }
    const store = useChatStore.getState()
    const existing = store.messagesMap.get(this.sessionId)?.some(message => message.id === messageId) ?? false
    if (!existing) {
      const message: UIMessage = {
        id: messageId,
        role: 'assistant',
        parts: [],
      }
      store.appendMessage(this.sessionId, message)
    }
    if (this.activeMessageId === null) {
      const controller = store.activeAbortControllers.get(this.messageId) ?? new AbortController()
      store.finishGeneration(this.messageId)
      store.startGeneration(this.sessionId, messageId, controller)
    }
    this.activeMessageId = messageId
  }

  private readNewDeltas(streamKey: string, deltas: ChatPartDelta[]): ChatPartDelta[] {
    const seenSeqs = this.seenSeqsByStream.get(streamKey) ?? new Set<number>()
    this.seenSeqsByStream.set(streamKey, seenSeqs)

    const ordered = [...deltas].sort((left, right) => left.seq - right.seq)
    const next: ChatPartDelta[] = []
    for (const delta of ordered) {
      if (seenSeqs.has(delta.seq)) {
        continue
      }
      seenSeqs.add(delta.seq)
      next.push(delta)
    }
    return next
  }
}
