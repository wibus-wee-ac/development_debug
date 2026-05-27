import type { UIMessage, UIMessageChunk } from 'ai'
import { readUIMessageStream } from 'ai'

import { useChatStore } from '~/store/chat'

export class ChatStreamingHandler {
  private readonly sessionId: string
  private readonly messageId: string
  private readonly requestStartedAtMs: number
  private readonly mode: 'local' | 'passive'
  private activeMessageId: string | null = null
  private terminated = false

  constructor(
    sessionId: string,
    messageId: string,
    requestStartedAtMs = performance.now(),
    options: { mode?: 'local' | 'passive' } = {},
  ) {
    this.sessionId = sessionId
    this.messageId = messageId
    this.requestStartedAtMs = requestStartedAtMs
    this.mode = options.mode ?? 'local'
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
    store.startGeneration(this.sessionId, this.messageId, controller)
  }

  async consume(stream: ReadableStream<UIMessageChunk>): Promise<void> {
    const initialMessage = useChatStore.getState().messagesMap.get(this.sessionId)?.find(message => message.id === (this.activeMessageId ?? this.messageId))

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
  }

  finish(): void {
    if (this.terminated) {
      return
    }
    this.terminated = true
    useChatStore.getState().finishGeneration(this.activeMessageId ?? this.messageId)
  }

  fail(error: string): void {
    if (this.terminated) {
      return
    }
    this.terminated = true
    useChatStore.getState().failGeneration(this.activeMessageId ?? this.messageId, error)
  }

  dispose(): void {}

  private applyMessageSnapshot(message: UIMessage): void {
    const receivedAtMs = performance.now()
    this.activateServerMessage(message.id)
    const store = useChatStore.getState()
    store.markRunFirstEvent(message.id, receivedAtMs)
    if (hasVisibleContent(message)) {
      store.markRunFirstContent(message.id, receivedAtMs)
    }
    store.updateMessage(this.sessionId, message.id, () => message)
  }

  private activateServerMessage(messageId: string): void {
    if (this.activeMessageId === messageId) {
      return
    }

    const store = useChatStore.getState()
    const existing = store.messagesMap.get(this.sessionId)?.some(message => message.id === messageId) ?? false
    if (!existing) {
      store.appendMessage(this.sessionId, {
        id: messageId,
        role: 'assistant',
        parts: [],
      })
    }

    if (this.activeMessageId === null) {
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
