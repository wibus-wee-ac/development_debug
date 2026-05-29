import type { UIMessage, UIMessageChunk } from 'ai'
import { readUIMessageStream } from 'ai'

import { useChatStore } from '~/store/chat'

export class ChatStreamingHandler {
  private readonly sessionId: string
  private readonly messageId: string
  private readonly requestStartedAtMs: number
  private readonly mode: 'local' | 'passive'
  private readonly useStoredMessageSnapshot: boolean
  private activeMessageId: string | null = null
  private terminated = false
  private pendingMessages = new Map<string, { message: UIMessage, receivedAtMs: number }>()
  private rafId: number | null = null

  constructor(
    sessionId: string,
    messageId: string,
    requestStartedAtMs = performance.now(),
    options: { mode?: 'local' | 'passive', useStoredMessageSnapshot?: boolean } = {},
  ) {
    this.sessionId = sessionId
    this.messageId = messageId
    this.requestStartedAtMs = requestStartedAtMs
    this.mode = options.mode ?? 'local'
    this.useStoredMessageSnapshot = options.useStoredMessageSnapshot ?? true
  }

  start(controller: AbortController): void {
    const store = useChatStore.getState()
    store.beginRunDisplayMeta(this.messageId, this.requestStartedAtMs)
    if (this.mode === 'passive') {
      store.setPassiveStreamingMessage(this.sessionId, this.messageId, true)
      store.setSessionMeta(this.sessionId, {
        passiveStatus: 'streaming',
        locallyDriving: false,
        localDriverMessageId: undefined,
      })
      return
    }
    this.appendLocalPlaceholder()
    store.startGeneration(this.sessionId, this.messageId, controller)
  }

  async consume(stream: ReadableStream<UIMessageChunk>): Promise<void> {
    const initialMessage = this.useStoredMessageSnapshot
      ? cloneMessageForStreamReader(
          useChatStore.getState().messagesMap.get(this.sessionId)?.find(message => message.id === (this.activeMessageId ?? this.messageId)),
        )
      : undefined

    for await (const message of readUIMessageStream<UIMessage>({
      message: initialMessage ?? {
        id: this.activeMessageId ?? this.messageId,
        role: 'assistant',
        parts: [],
      },
      stream,
      terminateOnError: true,
    })) {
      this.applyMessageSnapshot(message)
    }
    this.flushPendingMessages()
  }

  finish(): void {
    this.flushPendingMessages()
    if (this.terminated) {
      return
    }
    this.terminated = true
    const messageId = this.activeMessageId ?? this.messageId
    const store = useChatStore.getState()
    store.finishGeneration(messageId)
    if (this.mode === 'local' && this.activeMessageId === null) {
      store.removeMessage(this.sessionId, this.messageId)
    }
    if (this.mode === 'passive') {
      store.setPassiveStreamingMessage(this.sessionId, messageId, false)
      store.setSessionMeta(this.sessionId, { passiveStatus: 'idle' })
    }
  }

  fail(error: string): void {
    this.flushPendingMessages()
    if (this.terminated) {
      return
    }
    this.terminated = true
    const messageId = this.activeMessageId ?? this.messageId
    const store = useChatStore.getState()
    store.failGeneration(messageId, error)
    if (this.mode === 'passive') {
      store.setPassiveStreamingMessage(this.sessionId, messageId, false)
      store.setSessionMeta(this.sessionId, { passiveStatus: 'error' })
    }
  }

  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.pendingMessages.clear()
  }

  private flushPendingMessages(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.pendingMessages.size === 0) {
      return
    }
    const store = useChatStore.getState()
    for (const [messageId, { message, receivedAtMs }] of this.pendingMessages) {
      store.markRunFirstEvent(messageId, receivedAtMs)
      if (hasVisibleContent(message)) {
        store.markRunFirstContent(messageId, receivedAtMs)
      }
      store.updateMessage(this.sessionId, messageId, () => message)
    }
    this.pendingMessages.clear()
  }

  private appendLocalPlaceholder(): void {
    const store = useChatStore.getState()
    const existing = store.messagesMap.get(this.sessionId)?.some(message => message.id === this.messageId) ?? false
    if (existing) {
      return
    }
    store.appendMessage(this.sessionId, {
      id: this.messageId,
      role: 'assistant',
      parts: [],
    })
  }

  private applyMessageSnapshot(message: UIMessage): void {
    const receivedAtMs = performance.now()
    this.activateServerMessage(message.id)

    // Batch: store the latest snapshot per message, flush on next rAF
    this.pendingMessages.set(message.id, { message, receivedAtMs })

    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null
        this.flushPendingMessages()
      })
    }
  }

  private activateServerMessage(messageId: string): void {
    if (this.activeMessageId === messageId) {
      return
    }

    const store = useChatStore.getState()
    const existing = store.messagesMap.get(this.sessionId)?.some(message => message.id === messageId) ?? false
    const canReplaceLocalPlaceholder = this.mode === 'local'
      && this.activeMessageId === null
      && !existing
      && (store.messagesMap.get(this.sessionId)?.some(message => message.id === this.messageId) ?? false)

    if (canReplaceLocalPlaceholder) {
      store.updateMessage(this.sessionId, this.messageId, message => ({
        ...message,
        id: messageId,
      }))
    }
    else if (!existing) {
      store.appendMessage(this.sessionId, {
        id: messageId,
        role: 'assistant',
        parts: [],
      })
    }

    if (this.activeMessageId === null && messageId !== this.messageId) {
      if (this.mode === 'passive') {
        store.moveRunDisplayMeta(this.messageId, messageId)
        store.setPassiveStreamingMessage(this.sessionId, this.messageId, false)
        store.setPassiveStreamingMessage(this.sessionId, messageId, true)
      }
      else {
        const controller = store.activeAbortControllers.get(this.messageId) ?? new AbortController()
        store.moveRunDisplayMeta(this.messageId, messageId)
        store.startGeneration(this.sessionId, messageId, controller)
        store.finishGeneration(this.messageId)
      }
    }

    this.activeMessageId = messageId
  }
}

function cloneMessageForStreamReader(message: UIMessage | undefined): UIMessage | undefined {
  if (!message) {
    return undefined
  }
  return structuredClone(message) as UIMessage
}

function hasVisibleContent(message: UIMessage): boolean {
  return message.parts.some((part) => {
    if (part.type === 'text') {
      return part.text.length > 0
    }
    if (part.type === 'reasoning') {
      const value = 'text' in part ? part.text : undefined
      return typeof value === 'string' && value.length > 0
    }
    if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
      return true
    }
    return false
  })
}
