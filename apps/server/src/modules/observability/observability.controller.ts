// Input: observability service
// Output: HTTP endpoints for querying, flushing, and exporting observability data
// Position: apps/server/src/modules/observability

import { Controller, Get, Post, Query } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import type { ObservabilitySeverity } from './contract'
import { ObservabilityService } from './observability.service'

type EventsQuery = {
  chatSessionId?: string
  runId?: string
  code?: string
  severity?: ObservabilitySeverity
  since?: string
  until?: string
  limit?: string
}

type IncidentsQuery = {
  dedupeKey?: string
  chatSessionId?: string
  runId?: string
  code?: string
  status?: 'open' | 'resolved'
  limit?: string
}

type ExportQuery = {
  chatSessionId?: string
  runId?: string
  sinceUnix?: string
}

const observabilitySeverities = ['debug', 'info', 'warn', 'error', 'fatal'] as const satisfies readonly ObservabilitySeverity[]
const incidentStatuses = ['open', 'resolved'] as const

@injectable()
@Controller('observability')
export class ObservabilityController {
  constructor(@inject(ObservabilityService) private readonly service: ObservabilityService) {}

  @Get('/events')
  events(@Query() query?: EventsQuery) {
    return this.service.getEvents({
      chatSessionId: normalizeOptionalString(query?.chatSessionId),
      runId: normalizeOptionalString(query?.runId),
      code: normalizeOptionalString(query?.code),
      severity: parseOptionalSeverity(query?.severity),
      since: parseOptionalNonNegativeInteger(query?.since, 'since'),
      until: parseOptionalNonNegativeInteger(query?.until, 'until'),
      limit: parseOptionalPositiveInteger(query?.limit, 'limit'),
    })
  }

  @Get('/incidents')
  incidents(@Query() query?: IncidentsQuery) {
    return this.service.getIncidents({
      dedupeKey: normalizeOptionalString(query?.dedupeKey),
      chatSessionId: normalizeOptionalString(query?.chatSessionId),
      runId: normalizeOptionalString(query?.runId),
      code: normalizeOptionalString(query?.code),
      status: parseOptionalStatus(query?.status),
      limit: parseOptionalPositiveInteger(query?.limit, 'limit'),
    })
  }

  @Post('/flush')
  async flush() {
    await this.service.flushEvents()
    return { ok: true }
  }

  @Get('/export')
  export(@Query() query?: ExportQuery) {
    return this.service.exportBundle({
      chatSessionId: normalizeOptionalString(query?.chatSessionId),
      runId: normalizeOptionalString(query?.runId),
      sinceUnix: parseOptionalNonNegativeInteger(query?.sinceUnix, 'sinceUnix'),
    })
  }
}

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

function parseOptionalSeverity(value: ObservabilitySeverity | undefined): ObservabilitySeverity | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!observabilitySeverities.includes(value)) {
    throw invalidObservabilityInput(`severity must be one of: ${observabilitySeverities.join(', ')}`)
  }
  return value
}

function parseOptionalStatus(value: 'open' | 'resolved' | undefined): 'open' | 'resolved' | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!incidentStatuses.includes(value)) {
    throw invalidObservabilityInput(`status must be one of: ${incidentStatuses.join(', ')}`)
  }
  return value
}

function invalidObservabilityInput(message: string): AppError {
  return new AppError({
    code: 'invalid_observability_input',
    status: 400,
    message,
  })
}
