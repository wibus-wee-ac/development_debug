// Input: shared observability type contracts from @cradle/ipc and node crypto UUID
// Output: Canonical observability event helpers, code constants, and dedupe-key builder
// Position: Cradle-owned local observability contract used across main-process producers and consumers

import { randomUUID } from 'node:crypto'

import type {
  ObservabilityCategory,
  ObservabilityEvent,
  ObservabilityIncident,
  ObservabilitySeverity,
  ObservabilitySource,
} from '@cradle/ipc'

export type {
  ObservabilityCategory,
  ObservabilityEvent,
  ObservabilityIncident,
  ObservabilitySeverity,
  ObservabilitySource,
} from '@cradle/ipc'

export const OBSERVABILITY_SCHEMA_VERSION = 1

export const OBSERVABILITY_CODES = {
  chatEmptyOutputCompletion: 'CHAT_EMPTY_OUTPUT_COMPLETION',
  turnStreamFailed: 'TURN_STREAM_FAILED',
  domainEventHandlerFailed: 'DOMAIN_EVENT_HANDLER_FAILED',
  providerEmptyEventStream: 'PROVIDER_EMPTY_EVENT_STREAM',
} as const

export type ObservabilityCode = typeof OBSERVABILITY_CODES[keyof typeof OBSERVABILITY_CODES]

export interface CreateEventInput {
  source: ObservabilitySource
  code: string
  severity: ObservabilitySeverity
  category: ObservabilityCategory
  message: string
  attrs?: Record<string, unknown>
  chatSessionId?: string
  runId?: string
  messageId?: string
  traceId?: string
  dedupeKey?: string
  parentEventId?: string
  occurredAt?: number
  recordedAt?: number
}

export function createObservabilityEvent(input: CreateEventInput): ObservabilityEvent {
  const now = Date.now()
  return {
    id: randomUUID(),
    schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
    source: input.source,
    code: input.code,
    severity: input.severity,
    category: input.category,
    message: input.message,
    attrs: input.attrs,
    chatSessionId: input.chatSessionId,
    runId: input.runId,
    messageId: input.messageId,
    traceId: input.traceId,
    dedupeKey: input.dedupeKey,
    parentEventId: input.parentEventId,
    occurredAt: input.occurredAt ?? now,
    recordedAt: input.recordedAt ?? now,
  }
}

export interface DedupeKeyInput {
  code: string
  chatSessionId?: string | null
  runId?: string | null
  handlerName?: string | null
}

export function createDedupeKey(input: DedupeKeyInput): string {
  return `${input.code}:${input.chatSessionId ?? '-'}:${input.runId ?? '-'}:${input.handlerName ?? '-'}`
}

export interface IncidentRowInput {
  dedupeKey: string
  code: string
  severity: ObservabilitySeverity
  source: ObservabilitySource
  message: string
  event: ObservabilityEvent
  attrs?: Record<string, unknown>
}

export function createIncidentFromEvent(input: IncidentRowInput): ObservabilityIncident {
  return {
    id: randomUUID(),
    dedupeKey: input.dedupeKey,
    code: input.code,
    severity: input.severity,
    status: 'open',
    source: input.source,
    message: input.message,
    chatSessionId: input.event.chatSessionId,
    runId: input.event.runId,
    messageId: input.event.messageId,
    firstOccurredAt: input.event.occurredAt,
    lastOccurredAt: input.event.occurredAt,
    lastRecordedAt: input.event.recordedAt,
    count: 1,
    lastEventId: input.event.id,
    attrs: input.attrs,
  }
}
