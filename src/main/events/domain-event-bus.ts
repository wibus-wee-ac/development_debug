// Input: Typed domain events and event handlers from domain-events definitions
// Output: In-memory domain event bus with publish/subscribe semantics
// Position: Backend event infrastructure used by application services and composition root wiring

import type { DomainEvent, DomainEventType } from './domain-events'

export type DomainEventHandler<TEvent extends DomainEvent> = (event: TEvent) => void | Promise<void>

export interface DomainEventBus {
  publish: <TEvent extends DomainEvent>(event: TEvent) => Promise<void>
  subscribe: <TType extends DomainEventType>(
    type: TType,
    handler: DomainEventHandler<Extract<DomainEvent, { type: TType }>>,
  ) => () => void
}

export interface DomainEventBusOptions {
  onHandlerError?: (input: {
    event: DomainEvent
    error: unknown
    handler: DomainEventHandler<DomainEvent>
  }) => void | Promise<void>
}

export function createInMemoryDomainEventBus(options: DomainEventBusOptions = {}): DomainEventBus {
  const handlers = new Map<DomainEventType, Set<DomainEventHandler<DomainEvent>>>()
  const onHandlerError = options.onHandlerError

  const publish: DomainEventBus['publish'] = async (event) => {
    const subscribers = handlers.get(event.type)
    if (!subscribers || subscribers.size === 0) {
      return
    }
    for (const handler of [...subscribers]) {
      try {
        await handler(event)
      }
      catch (error) {
        if (onHandlerError) {
          await onHandlerError({ event, error, handler })
        }
      }
    }
  }

  const subscribe: DomainEventBus['subscribe'] = (type, handler) => {
    const existing = handlers.get(type)
    if (existing) {
      existing.add(handler as DomainEventHandler<DomainEvent>)
    }
    else {
      handlers.set(type, new Set([handler as DomainEventHandler<DomainEvent>]))
    }

    return () => {
      const bucket = handlers.get(type)
      if (!bucket) {
        return
      }
      bucket.delete(handler as DomainEventHandler<DomainEvent>)
      if (bucket.size === 0) {
        handlers.delete(type)
      }
    }
  }

  return {
    publish,
    subscribe,
  }
}
