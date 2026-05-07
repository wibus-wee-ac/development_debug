// Input: Chat timeline/message completion payloads from chat write-side runtime
// Output: Typed domain event contracts for in-process backend event routing
// Position: Shared event type definitions for src/main/events consumers and publishers

import type { BackendTimelineEvent } from '../backend-control-plane/timeline-events'

export interface DomainEventBase<TType extends string, TPayload> {
  id: string
  type: TType
  occurredAt: number
  payload: TPayload
}

// ── Chat Timeline Event Persisted ─────────────────────────────────────────────

export interface ChatTimelineEventPersistedPayload {
  chatSessionId: string
  messageId: string
  runId: string
  event: BackendTimelineEvent
  /** Whether this is a terminal event (run.completed, run.aborted, run.failed). */
  terminal: boolean
}

export type ChatTimelineEventPersistedDomainEvent = DomainEventBase<'chat.timeline-event-persisted', ChatTimelineEventPersistedPayload>

// ── Chat Turn Finished ────────────────────────────────────────────────────────

export interface ChatTurnFinishedPayload {
  chatSessionId: string
  messageId: string
  status: 'complete' | 'aborted' | 'failed'
  errorText: string | null
  agentProfileId: string
  finishedAt: number
}

export type ChatTurnFinishedDomainEvent = DomainEventBase<'chat.turn-finished', ChatTurnFinishedPayload>

// ── Chat Message Completed ────────────────────────────────────────────────────

export interface ChatMessageCompletedPayload {
  chatSessionId: string
  messageId: string
  status: 'complete' | 'aborted' | 'failed'
  errorText: string | null
  assistantText: string
  agentProfileId: string
  modelId: string | null
  usage: { promptTokens: number, completionTokens: number, totalTokens: number } | null
}

export type ChatMessageCompletedDomainEvent = DomainEventBase<'chat.message-completed', ChatMessageCompletedPayload>

// ── Union ─────────────────────────────────────────────────────────────────────

export type DomainEvent =
  | ChatTimelineEventPersistedDomainEvent
  | ChatTurnFinishedDomainEvent
  | ChatMessageCompletedDomainEvent

export type DomainEventType = DomainEvent['type']

