import type { UIMessage } from 'ai'

import { useChatStore } from '~/store/chat'

import type { ChatPartDelta, ChatStreamEvent, ChatToolEntityPatch, SubagentMessageContext } from './chat-delta-events'
import {
  applyChatPartDeltas,
  collectChatToolEntityPatches,
} from './chat-delta-events'

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
  private requestStartedAtMs: number
  private pendingToolEntityPatches: QueuedToolEntityPatch[] = []
  private toolEntityPatchFlushFrame: number | null = null

  constructor(sessionId: string, messageId: string, requestStartedAtMs = performance.now()) {
    this.sessionId = sessionId
    this.messageId = messageId
    this.requestStartedAtMs = requestStartedAtMs
  }

  /**
   * Register this handler with the store and create the initial assistant message.
   */
  start(controller: AbortController): void {
    const store = useChatStore.getState()
    store.beginRunDisplayMeta(this.messageId, this.requestStartedAtMs)
    store.startGeneration(this.sessionId, this.messageId, controller)
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
    if (this.terminated) {
      return
    }
    this.terminated = true
    this.flushToolEntityPatches()
    useChatStore.getState().finishGeneration(this.activeMessageId ?? this.messageId)
  }

  /**
   * Mark generation as failed with an error message.
   */
  fail(error: string): void {
    if (this.terminated) {
      return
    }
    this.terminated = true
    this.flushToolEntityPatches()
    useChatStore.getState().failGeneration(this.activeMessageId ?? this.messageId, error)
  }

  /**
   * Clean up any pending timers.
   */
  dispose(): void {
    this.flushToolEntityPatches()
  }

  // ── Private ─────────────────────────────────────────────

  private applyMainDeltas(messageId: string, deltas: ChatPartDelta[]): void {
    const nextDeltas = this.readNewDeltas(`message:${messageId}`, deltas)
    if (nextDeltas.length === 0) {
      return
    }
    const receivedAtMs = performance.now()
    this.activateServerMessage(messageId)
    const store = useChatStore.getState()
    store.markRunFirstEvent(messageId, receivedAtMs)
    if (hasVisibleContentDelta(nextDeltas)) {
      store.markRunFirstContent(messageId, receivedAtMs)
    }
    const currentMessage = store.messagesMap.get(this.sessionId)?.find(message => message.id === messageId)
    if (!currentMessage) {
      return
    }
    const nextMessage = hasMessagePartDelta(nextDeltas)
      ? applyChatPartDeltas(currentMessage, nextDeltas)
      : currentMessage
    const toolPatches = collectChatToolEntityPatches(nextMessage, nextDeltas)
    if (nextMessage !== currentMessage) {
      store.updateMessage(this.sessionId, messageId, () => nextMessage)
    }
    this.queueToolEntityPatches(messageId, toolPatches)
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
    const nextMessage = hasMessagePartDelta(nextDeltas)
      ? applyChatPartDeltas(current, nextDeltas)
      : current
    const toolPatches = collectChatToolEntityPatches(nextMessage, nextDeltas)
    if (nextMessage !== current) {
      store.upsertSubagentMessage(
        context.parentMessageId,
        context.parentToolCallId,
        nextMessage,
      )
    }
    this.queueToolEntityPatches(context.messageId, toolPatches)
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
      store.moveRunDisplayMeta(this.messageId, messageId)
      store.startGeneration(this.sessionId, messageId, controller)
      store.finishGeneration(this.messageId)
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

  private queueToolEntityPatches(messageId: string, patches: ChatToolEntityPatch[]): void {
    const mergedPatches = mergeToolEntityPatches(messageId, patches)
    if (mergedPatches.length === 0) {
      return
    }
    this.pendingToolEntityPatches.push(...mergedPatches)

    if (typeof globalThis.requestAnimationFrame !== 'function') {
      this.flushToolEntityPatches()
      return
    }
    if (this.toolEntityPatchFlushFrame !== null) {
      return
    }
    this.toolEntityPatchFlushFrame = globalThis.requestAnimationFrame(() => {
      this.toolEntityPatchFlushFrame = null
      this.flushToolEntityPatches()
    })
  }

  private flushToolEntityPatches(): void {
    if (this.toolEntityPatchFlushFrame !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(this.toolEntityPatchFlushFrame)
      this.toolEntityPatchFlushFrame = null
    }
    if (this.pendingToolEntityPatches.length === 0) {
      return
    }
    const patches = this.pendingToolEntityPatches
    this.pendingToolEntityPatches = []
    useChatStore.getState().patchToolEntities(patches)
  }
}

function hasMessagePartDelta(deltas: ChatPartDelta[]): boolean {
  return deltas.some(delta =>
    delta.type !== 'tool_arguments_append' && delta.type !== 'tool_output_streaming',
  )
}

interface QueuedToolEntityPatch {
  messageId: string
  toolCallId: string
  updater: ChatToolEntityPatch['updater']
}

function mergeToolEntityPatches(
  messageId: string,
  patches: ChatToolEntityPatch[],
): QueuedToolEntityPatch[] {
  const patchesByToolCallId = new Map<string, typeof patches>()
  for (const patch of patches) {
    const current = patchesByToolCallId.get(patch.toolCallId) ?? []
    current.push(patch)
    patchesByToolCallId.set(patch.toolCallId, current)
  }

  const mergedPatches: QueuedToolEntityPatch[] = []
  for (const [toolCallId, toolPatches] of patchesByToolCallId) {
    mergedPatches.push({
      messageId,
      toolCallId,
      updater: entity => toolPatches.reduce((current, patch) => patch.updater(current), entity),
    })
  }
  return mergedPatches
}

function hasVisibleContentDelta(deltas: ChatPartDelta[]): boolean {
  return deltas.some((delta) => {
    switch (delta.type) {
      case 'text_append':
      case 'tool_arguments_append':
      case 'tool_output_streaming':
        return delta.text.length > 0
      case 'tool_input_set':
      case 'tool_output_set':
        return true
      default:
        return false
    }
  })
}
