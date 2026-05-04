// Input: bridgeChatTurnFinishedEvents helper with in-memory event bus
// Output: Unit test proving chat turn lifecycle is published as domain events
// Position: Event bridge regression test for composition-root wiring behavior

import { describe, expect, it, vi } from 'vitest'

import { bridgeChatTurnFinishedEvents } from '../chat-turn-finished-bridge'
import { createInMemoryDomainEventBus } from '../domain-event-bus'

describe('chatTurnFinishedBridge', () => {
  it('publishes chat.turn-finished event when source emits turn completion', async () => {
    type SourceEvent = {
      chatSessionId: string
      messageId: string
      status: 'complete' | 'aborted' | 'failed'
      errorText: string | null
      agentProfileId: string
      finishedAt: number
    }
    let listener: ((event: SourceEvent) => void) | undefined

    const source = {
      onTurnFinished(callback: (event: SourceEvent) => void) {
        listener = callback
        return () => {
          listener = undefined
        }
      },
    }

    const bus = createInMemoryDomainEventBus()
    const sink = vi.fn()
    bus.subscribe('chat.turn-finished', sink)

    bridgeChatTurnFinishedEvents({
      source,
      eventBus: bus,
      makeEventId: () => 'evt-bridge-1',
      nowMs: () => 999,
    })

    if (!listener) {
      throw new Error('Expected bridge to register turn-finished listener')
    }
    listener({
      chatSessionId: 'chat-1',
      messageId: 'message-1',
      status: 'complete',
      errorText: null,
      agentProfileId: 'profile-1',
      finishedAt: 1000,
    })

    await Promise.resolve()

    expect(sink).toHaveBeenCalledWith({
      id: 'evt-bridge-1',
      type: 'chat.turn-finished',
      occurredAt: 999,
      payload: {
        chatSessionId: 'chat-1',
        messageId: 'message-1',
        status: 'complete',
        errorText: null,
        agentProfileId: 'profile-1',
        finishedAt: 1000,
      },
    })
  })
})
