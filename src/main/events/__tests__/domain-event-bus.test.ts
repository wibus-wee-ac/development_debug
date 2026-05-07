// Input: createInMemoryDomainEventBus from main events module
// Output: Behavioral tests for domain event publish/subscribe lifecycle
// Position: Unit test for src/main/events/domain-event-bus.ts

import { describe, expect, it, vi } from 'vitest'

import { createInMemoryDomainEventBus } from '../domain-event-bus'
import type { ChatTurnFinishedDomainEvent } from '../domain-events'

function buildTurnFinishedEvent(overrides: Partial<ChatTurnFinishedDomainEvent> = {}): ChatTurnFinishedDomainEvent {
  return {
    id: 'evt-1',
    type: 'chat.turn-finished',
    occurredAt: 123,
    payload: {
      chatSessionId: 'chat-1',
      messageId: 'msg-1',
      status: 'complete',
      errorText: null,
      agentProfileId: 'agent-1',
      finishedAt: 123,
    },
    ...overrides,
  }
}

describe('inMemoryDomainEventBus', () => {
  it('delivers events to subscribers of the same type', async () => {
    const bus = createInMemoryDomainEventBus()
    const received: ChatTurnFinishedDomainEvent[] = []
    bus.subscribe('chat.turn-finished', (event) => {
      received.push(event)
    })

    const event = buildTurnFinishedEvent()
    await bus.publish(event)

    expect(received).toEqual([event])
  })

  it('stops delivering events after unsubscribe', async () => {
    const bus = createInMemoryDomainEventBus()
    const handler = vi.fn()
    const unsubscribe = bus.subscribe('chat.turn-finished', handler)

    unsubscribe()
    await bus.publish(buildTurnFinishedEvent())

    expect(handler).not.toHaveBeenCalled()
  })

  it('awaits async subscribers before resolving publish', async () => {
    const bus = createInMemoryDomainEventBus()
    const trace: string[] = []
    bus.subscribe('chat.turn-finished', async () => {
      trace.push('handler:start')
      await Promise.resolve()
      trace.push('handler:end')
    })

    trace.push('before:publish')
    await bus.publish(buildTurnFinishedEvent())
    trace.push('after:publish')

    expect(trace).toEqual([
      'before:publish',
      'handler:start',
      'handler:end',
      'after:publish',
    ])
  })

  it('captures handler failures and continues delivering to later handlers', async () => {
    const onHandlerError = vi.fn()
    const bus = createInMemoryDomainEventBus({ onHandlerError })
    const trace: string[] = []

    bus.subscribe('chat.turn-finished', async () => {
      trace.push('first')
      throw new Error('boom')
    })
    bus.subscribe('chat.turn-finished', async () => {
      trace.push('second')
    })

    await bus.publish(buildTurnFinishedEvent())

    expect(trace).toEqual(['first', 'second'])
    expect(onHandlerError).toHaveBeenCalledTimes(1)
  })
})
