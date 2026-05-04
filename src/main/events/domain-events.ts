// Input: Chat turn completion payload from ChatEngine lifecycle hooks
// Output: Typed domain event contracts for in-process backend event routing
// Position: Shared event type definitions for src/main/events consumers and publishers

export interface DomainEventBase<TType extends string, TPayload> {
  id: string
  type: TType
  occurredAt: number
  payload: TPayload
}

export interface ChatTurnFinishedPayload {
  chatSessionId: string
  messageId: string
  status: 'complete' | 'aborted' | 'failed'
  errorText: string | null
  agentProfileId: string
  finishedAt: number
}

export type ChatTurnFinishedDomainEvent = DomainEventBase<'chat.turn-finished', ChatTurnFinishedPayload>

export type DomainEvent = ChatTurnFinishedDomainEvent

export type DomainEventType = DomainEvent['type']

