import type { UIMessageChunk } from 'ai'

import type { ProviderThreadEvent } from '../runtime-provider-types'

const DEFAULT_PROVIDER_THREAD_REPLAY_CHUNKS = 1_000

export type ProviderThreadSubscriber = (chunk: UIMessageChunk, terminal: boolean) => void

interface ProviderThreadStreamState {
  sessionId: string
  threadId: string
  startedTurnIds: Set<string>
  chunks: UIMessageChunk[]
  terminal: boolean
}

export interface ProviderThreadStreamStore {
  streams: Map<string, ProviderThreadStreamState>
  subscribers: Map<string, Set<ProviderThreadSubscriber>>
}

export function createProviderThreadStreamStore(): ProviderThreadStreamStore {
  return {
    streams: new Map(),
    subscribers: new Map()
  }
}

export function publishProviderThreadEvent(input: {
  store: ProviderThreadStreamStore
  sessionId: string
  event: ProviderThreadEvent
  isTerminalChunk: (chunk: UIMessageChunk) => boolean
}): void {
  if (input.event.providerTurnId) {
    publishProviderThreadChunk({
      store: input.store,
      sessionId: input.sessionId,
      threadId: input.event.providerThreadId,
      chunk: {
        type: 'start',
        messageId: providerThreadAssistantMessageId(
          input.event.providerThreadId,
          input.event.providerTurnId,
          0
        )
      },
      terminal: false,
      providerTurnId: input.event.providerTurnId
    })
  }
  for (const chunk of input.event.chunks) {
    publishProviderThreadChunk({
      store: input.store,
      sessionId: input.sessionId,
      threadId: input.event.providerThreadId,
      chunk,
      terminal: input.isTerminalChunk(chunk),
      providerTurnId: input.event.providerTurnId
    })
  }
}

export function publishProviderThreadChunk(input: {
  store: ProviderThreadStreamStore
  sessionId: string
  threadId: string
  chunk: UIMessageChunk
  terminal: boolean
  providerTurnId: string | null
}): void {
  const key = providerThreadStreamKey(input.sessionId, input.threadId)
  const state = input.store.streams.get(key) ?? {
    sessionId: input.sessionId,
    threadId: input.threadId,
    startedTurnIds: new Set<string>(),
    chunks: [],
    terminal: false
  }
  input.store.streams.set(key, state)

  if (input.chunk.type === 'start' && input.providerTurnId) {
    if (state.startedTurnIds.has(input.providerTurnId)) {
      return
    }
    state.startedTurnIds.add(input.providerTurnId)
  }

  if (!state.terminal) {
    state.chunks.push(input.chunk)
    while (state.chunks.length > providerThreadReplayChunkLimit()) {
      state.chunks.shift()
    }
  }
  if (input.terminal) {
    state.terminal = true
  }

  const subscribers = input.store.subscribers.get(key)
  if (!subscribers) {
    return
  }
  const dead: ProviderThreadSubscriber[] = []
  for (const subscriber of subscribers) {
    try {
      subscriber(input.chunk, input.terminal)
    } catch {
      dead.push(subscriber)
    }
  }
  for (const subscriber of dead) {
    subscribers.delete(subscriber)
  }
  if (input.terminal || subscribers.size === 0) {
    input.store.subscribers.delete(key)
  }
}

export function providerThreadStreamKey(sessionId: string, threadId: string): string {
  return `${sessionId}:${threadId}`
}

function providerThreadAssistantMessageId(
  threadId: string,
  turnId: string,
  assistantMessageIndex: number
): string {
  return `provider-thread:${threadId}:turn:${turnId}:assistant:${assistantMessageIndex}`
}

function providerThreadReplayChunkLimit(): number {
  return readPositiveIntegerEnv(
    'CRADLE_CHAT_PROVIDER_THREAD_REPLAY_CHUNKS',
    DEFAULT_PROVIDER_THREAD_REPLAY_CHUNKS
  )
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}
