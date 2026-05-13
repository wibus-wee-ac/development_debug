import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import type { ObservabilitySeverity } from './contract'
import { ObservabilityModel } from './model'
import * as Observability from './service'

const observabilitySeverities = ['debug', 'info', 'warn', 'error', 'fatal'] as const satisfies readonly ObservabilitySeverity[]
const incidentStatuses = ['open', 'resolved'] as const

export const observability = new Elysia({
  prefix: '/observability',
  detail: { tags: ['observability'] },
})
  .get('/events', ({ query }) => {
    return Observability.getEvents({
      chatSessionId: normalizeOptionalString(query.chatSessionId),
      runId: normalizeOptionalString(query.runId),
      code: normalizeOptionalString(query.code),
      severity: parseOptionalSeverity(query.severity),
      since: parseOptionalNonNegativeInteger(query.since, 'since'),
      until: parseOptionalNonNegativeInteger(query.until, 'until'),
      limit: parseOptionalPositiveInteger(query.limit, 'limit'),
    })
  }, {
    detail: {
      summary: 'List observability events',
      'x-cradle-cli': {
        command: ['observability', 'events'],
      },
    },
    query: ObservabilityModel.eventsQuery,
    response: { 200: t.Array(ObservabilityModel.event) },
  })
  .get('/incidents', ({ query }) => {
    return Observability.getIncidents({
      dedupeKey: normalizeOptionalString(query.dedupeKey),
      chatSessionId: normalizeOptionalString(query.chatSessionId),
      runId: normalizeOptionalString(query.runId),
      code: normalizeOptionalString(query.code),
      status: parseOptionalStatus(query.status),
      limit: parseOptionalPositiveInteger(query.limit, 'limit'),
    })
  }, {
    detail: {
      summary: 'List observability incidents',
      'x-cradle-cli': {
        command: ['observability', 'incidents'],
      },
    },
    query: ObservabilityModel.incidentsQuery,
    response: { 200: t.Array(ObservabilityModel.incident) },
  })
  .post('/flush', async () => {
    await Observability.flushEvents()
    return { ok: true as const }
  }, {
    detail: { summary: 'Flush pending observability events' },
    response: { 200: ObservabilityModel.flushResponse },
  })
  .get('/export', ({ query }) => {
    return Observability.getExportBundle({
      chatSessionId: normalizeOptionalString(query.chatSessionId),
      runId: normalizeOptionalString(query.runId),
      sinceUnix: parseOptionalNonNegativeInteger(query.sinceUnix, 'sinceUnix'),
    })
  }, {
    detail: {
      summary: 'Export observability bundle',
      'x-cradle-cli': {
        command: ['observability', 'export'],
      },
    },
    query: ObservabilityModel.exportQuery,
    response: { 200: ObservabilityModel.bundle },
  })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function parseOptionalPositiveInteger(value: string | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw invalidObservabilityInput(`${field} must be a positive integer`)
  }
  return parsed
}

function parseOptionalNonNegativeInteger(value: string | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw invalidObservabilityInput(`${field} must be a non-negative integer`)
  }
  return parsed
}

function parseOptionalSeverity(value: string | undefined): ObservabilitySeverity | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!observabilitySeverities.includes(value as ObservabilitySeverity)) {
    throw invalidObservabilityInput(`severity must be one of: ${observabilitySeverities.join(', ')}`)
  }
  return value as ObservabilitySeverity
}

function parseOptionalStatus(value: string | undefined): 'open' | 'resolved' | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!incidentStatuses.includes(value as 'open' | 'resolved')) {
    throw invalidObservabilityInput(`status must be one of: ${incidentStatuses.join(', ')}`)
  }
  return value as 'open' | 'resolved'
}

function invalidObservabilityInput(message: string): AppError {
  return new AppError({
    code: 'invalid_observability_input',
    status: 400,
    message,
  })
}
