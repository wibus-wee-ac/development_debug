// Input: Chat turn lifecycle callback source and a domain event bus
// Output: Composition helper that forwards chat turn completion into domain events
// Position: Main-process event bridge between ChatEngine and application event pipeline

import { randomUUID } from 'node:crypto'

import type { DomainEventBus } from './domain-event-bus'
import type { ChatTurnFinishedDomainEvent } from './domain-events'

interface ChatTurnFinishedSourceEvent {
  chatSessionId: string
  messageId: string
  status: 'complete' | 'aborted' | 'failed'
  errorText: string | null
  agentProfileId: string
  finishedAt: number
}

interface ChatTurnFinishedSource {
  onTurnFinished(listener: (event: ChatTurnFinishedSourceEvent) => void): () => void
}

interface BridgeDeps {
  source: ChatTurnFinishedSource
  eventBus: DomainEventBus
  makeEventId?: () => string
  nowMs?: () => number
}

export function bridgeChatTurnFinishedEvents(deps: BridgeDeps): () => void {
  const makeEventId = deps.makeEventId ?? randomUUID
  const nowMs = deps.nowMs ?? Date.now

  return deps.source.onTurnFinished((event) => {
    const domainEvent: ChatTurnFinishedDomainEvent = {
      id: makeEventId(),
      type: 'chat.turn-finished',
      occurredAt: nowMs(),
      payload: {
        chatSessionId: event.chatSessionId,
        messageId: event.messageId,
        status: event.status,
        errorText: event.errorText,
        agentProfileId: event.agentProfileId,
        finishedAt: event.finishedAt,
      },
    }

    void deps.eventBus.publish(domainEvent)
  })
}

