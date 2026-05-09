// Input: canonical observability event stream and recent in-memory history
// Output: pure incident rule evaluation results without side effects
// Position: server observability rule module

import type { ObservabilitySeverity } from '@cradle/ipc'

import { createIncidentFromEvent, OBSERVABILITY_CODES } from './contract'
import type { ObservabilityEvent, ObservabilityIncident } from './contract'

export interface IncidentRuleInput {
  nowMs: number
  incoming: ObservabilityEvent
  recent: ObservabilityEvent[]
}

export interface IncidentRuleResult {
  incident: ObservabilityIncident
}

const EMPTY_OUTPUT_WINDOW_MS = 5 * 60 * 1000
const EMPTY_OUTPUT_THRESHOLD = 3

export function evaluateIncidentRules(input: IncidentRuleInput): IncidentRuleResult[] {
  const results: IncidentRuleResult[] = []
  const event = input.incoming

  if (event.code === OBSERVABILITY_CODES.chatEmptyOutputCompletion) {
    const occurrences = countRecentOccurrences(input, OBSERVABILITY_CODES.chatEmptyOutputCompletion, event.dedupeKey)
    if (occurrences >= EMPTY_OUTPUT_THRESHOLD) {
      results.push({
        incident: createIncidentFromEvent({
          dedupeKey: event.dedupeKey ?? defaultDedupeKey(event.code),
          code: event.code,
          severity: event.severity,
          source: event.source,
          message: `Observed ${occurrences} empty-output completions in the last 5 minutes`,
          event,
          attrs: {
            threshold: EMPTY_OUTPUT_THRESHOLD,
            windowMs: EMPTY_OUTPUT_WINDOW_MS,
            occurrences,
          },
        }),
      })
    }
  }

  if (event.code === OBSERVABILITY_CODES.turnStreamFailed && isErrorSeverity(event.severity)) {
    results.push({
      incident: createIncidentFromEvent({
        dedupeKey: event.dedupeKey ?? defaultDedupeKey(event.code),
        code: event.code,
        severity: event.severity,
        source: event.source,
        message: 'Chat turn streaming failed',
        event,
      }),
    })
  }

  if (event.code === OBSERVABILITY_CODES.domainEventHandlerFailed && isErrorSeverity(event.severity)) {
    results.push({
      incident: createIncidentFromEvent({
        dedupeKey: event.dedupeKey ?? defaultDedupeKey(event.code),
        code: event.code,
        severity: event.severity,
        source: event.source,
        message: 'Domain event handler failed',
        event,
      }),
    })
  }

  return results
}

function countRecentOccurrences(
  input: IncidentRuleInput,
  code: string,
  dedupeKey: string | undefined,
): number {
  const cutoff = input.nowMs - EMPTY_OUTPUT_WINDOW_MS
  const history = [...input.recent, input.incoming]
  return history.filter((event) => {
    if (event.code !== code) {
      return false
    }
    if ((event.dedupeKey ?? defaultDedupeKey(event.code)) !== (dedupeKey ?? defaultDedupeKey(code))) {
      return false
    }
    return event.occurredAt >= cutoff
  }).length
}

function isErrorSeverity(severity: ObservabilitySeverity): boolean {
  return severity === 'error' || severity === 'fatal'
}

function defaultDedupeKey(code: string): string {
  return `${code}:-:-:-`
}