// Input: evaluateIncidentRules and canonical observability event helpers
// Output: Rule-level regression coverage for local observability incident projection
// Position: Observability pure-function rules test suite

import { describe, expect, it } from 'vitest'

import { createObservabilityEvent, OBSERVABILITY_CODES } from '../contract'
import { evaluateIncidentRules } from '../rules'

describe('evaluateIncidentRules', () => {
  it('opens empty-output incident only after threshold within window', () => {
    const baseTs = Date.now()
    const recent = [
      createObservabilityEvent({
        source: 'chat-engine',
        code: OBSERVABILITY_CODES.chatEmptyOutputCompletion,
        severity: 'error',
        category: 'chat',
        message: 'empty output #1',
        chatSessionId: 'chat-1',
        runId: 'run-1',
        dedupeKey: 'CHAT_EMPTY_OUTPUT_COMPLETION:chat-1:run-1:-',
        occurredAt: baseTs - 1_000,
        recordedAt: baseTs - 1_000,
      }),
      createObservabilityEvent({
        source: 'chat-engine',
        code: OBSERVABILITY_CODES.chatEmptyOutputCompletion,
        severity: 'error',
        category: 'chat',
        message: 'empty output #2',
        chatSessionId: 'chat-1',
        runId: 'run-1',
        dedupeKey: 'CHAT_EMPTY_OUTPUT_COMPLETION:chat-1:run-1:-',
        occurredAt: baseTs - 500,
        recordedAt: baseTs - 500,
      }),
    ]

    const incoming = createObservabilityEvent({
      source: 'chat-engine',
      code: OBSERVABILITY_CODES.chatEmptyOutputCompletion,
      severity: 'error',
      category: 'chat',
      message: 'empty output #3',
      chatSessionId: 'chat-1',
      runId: 'run-1',
      dedupeKey: 'CHAT_EMPTY_OUTPUT_COMPLETION:chat-1:run-1:-',
      occurredAt: baseTs,
      recordedAt: baseTs,
    })

    const results = evaluateIncidentRules({
      nowMs: baseTs,
      incoming,
      recent,
    })

    expect(results).toHaveLength(1)
    expect(results[0].incident.code).toBe(OBSERVABILITY_CODES.chatEmptyOutputCompletion)
    expect(results[0].incident.dedupeKey).toBe('CHAT_EMPTY_OUTPUT_COMPLETION:chat-1:run-1:-')
  })

  it('creates stream-failed incident immediately', () => {
    const incoming = createObservabilityEvent({
      source: 'chat-engine',
      code: OBSERVABILITY_CODES.turnStreamFailed,
      severity: 'error',
      category: 'chat',
      message: 'stream failed',
      chatSessionId: 'chat-2',
      runId: 'run-2',
      dedupeKey: 'TURN_STREAM_FAILED:chat-2:run-2:-',
    })

    const results = evaluateIncidentRules({
      nowMs: Date.now(),
      incoming,
      recent: [],
    })

    expect(results).toHaveLength(1)
    expect(results[0].incident.code).toBe(OBSERVABILITY_CODES.turnStreamFailed)
  })

  it('creates domain-event-handler-failed incident for error severity', () => {
    const incoming = createObservabilityEvent({
      source: 'domain-event-bus',
      code: OBSERVABILITY_CODES.domainEventHandlerFailed,
      severity: 'error',
      category: 'event-bus',
      message: 'handler failed',
      dedupeKey: 'DOMAIN_EVENT_HANDLER_FAILED:-:-:handler-1',
      attrs: { handlerName: 'handler-1' },
    })

    const results = evaluateIncidentRules({
      nowMs: Date.now(),
      incoming,
      recent: [],
    })

    expect(results).toHaveLength(1)
    expect(results[0].incident.dedupeKey).toBe('DOMAIN_EVENT_HANDLER_FAILED:-:-:handler-1')
  })
})
