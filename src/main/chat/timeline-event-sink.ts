// Input: TurnRepository, chat turn identifiers, and raw timeline events
// Output: Explicit write-side sink that persists timeline facts and publishes persisted domain events
// Position: Chat write pipeline helper used by ChatTurnExecutor to keep event persistence readable

import { randomUUID } from 'node:crypto'

import type { BackendTimelineEvent, TimelineInputEvent } from '../backend-control-plane/timeline-events'
import type { DomainEventBus } from '../events/domain-event-bus'
import type { ChatTurnStatus, MessageStatus } from './chat-turn-executor'
import type { TurnRepository } from './turn-repository'

export interface PersistTimelineEventDeps {
  repository: TurnRepository
  eventBus: DomainEventBus | null
}

export interface PersistTimelineEventInput {
  chatSessionId: string
  messageId: string
  runId: string
  event: TimelineInputEvent
  messageStatus?: MessageStatus
  errorText?: string | null
  runCompletion?: {
    status: ChatTurnStatus
    stopReason: string | null
    errorText: string | null
  }
}

export interface PersistTimelineEventResult {
  storedEvent: BackendTimelineEvent
  terminal: boolean
}

export function persistTimelineEvent(
  deps: PersistTimelineEventDeps,
  input: PersistTimelineEventInput,
): PersistTimelineEventResult {
  const storedEvent = deps.repository.persistEvent({
    chatSessionId: input.chatSessionId,
    messageId: input.messageId,
    runId: input.runId,
    event: input.event,
    messageStatus: input.messageStatus ?? 'streaming',
    errorText: input.errorText ?? null,
    runCompletion: input.runCompletion,
  })

  const terminal = storedEvent.type === 'run.completed'
    || storedEvent.type === 'run.aborted'
    || storedEvent.type === 'run.failed'

  if (deps.eventBus) {
    void deps.eventBus.publish({
      id: randomUUID(),
      type: 'chat.timeline-event-persisted',
      occurredAt: Date.now(),
      payload: {
        chatSessionId: input.chatSessionId,
        messageId: input.messageId,
        runId: input.runId,
        event: storedEvent,
        terminal,
      },
    })
  }

  return {
    storedEvent,
    terminal,
  }
}
