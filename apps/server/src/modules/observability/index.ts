import { Elysia, t } from 'elysia'
import { z } from 'zod'

import type { CreateEventInput } from './contract'
import { ObservabilityModel } from './model'
import * as Observability from './service'

const OptionalTrimmedStringSchema = z.string()
  .trim()
  .transform(value => value.length > 0 ? value : undefined)
  .optional()
const OptionalPositiveIntegerSchema = z.string()
  .regex(/^\d+$/, 'must be a positive integer')
  .transform(value => Number.parseInt(value, 10))
  .pipe(z.number().int().positive())
  .optional()
const OptionalNonNegativeIntegerSchema = z.string()
  .regex(/^\d+$/, 'must be a non-negative integer')
  .transform(value => Number.parseInt(value, 10))
  .pipe(z.number().int().nonnegative())
  .optional()

const ObservabilityEventsQuerySchema = z.object({
  chatSessionId: OptionalTrimmedStringSchema,
  runId: OptionalTrimmedStringSchema,
  code: OptionalTrimmedStringSchema,
  severity: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).optional(),
  since: OptionalNonNegativeIntegerSchema,
  until: OptionalNonNegativeIntegerSchema,
  limit: OptionalPositiveIntegerSchema,
}).passthrough()

const ObservabilityIncidentsQuerySchema = z.object({
  dedupeKey: OptionalTrimmedStringSchema,
  chatSessionId: OptionalTrimmedStringSchema,
  runId: OptionalTrimmedStringSchema,
  code: OptionalTrimmedStringSchema,
  status: z.enum(['open', 'resolved']).optional(),
  limit: OptionalPositiveIntegerSchema,
}).passthrough()

const ObservabilityExportQuerySchema = z.object({
  chatSessionId: OptionalTrimmedStringSchema,
  runId: OptionalTrimmedStringSchema,
  sinceUnix: OptionalNonNegativeIntegerSchema,
}).passthrough()

const ObservabilityErrorPatternsQuerySchema = z.object({
  chatSessionId: OptionalTrimmedStringSchema,
  runId: OptionalTrimmedStringSchema,
  code: OptionalTrimmedStringSchema,
  runtimeKind: OptionalTrimmedStringSchema,
  providerTargetId: OptionalTrimmedStringSchema,
  sinceUnix: OptionalNonNegativeIntegerSchema,
  limit: OptionalPositiveIntegerSchema,
}).passthrough()

const CreateObservabilityEventBodySchema = z.object({
  source: z.custom<CreateEventInput['source']>(),
  code: z.string().min(1),
  severity: z.custom<CreateEventInput['severity']>(),
  category: z.custom<CreateEventInput['category']>(),
  message: z.string().min(1),
  attrs: z.record(z.string(), z.unknown()).optional(),
  chatSessionId: z.string().optional(),
  runId: z.string().optional(),
  messageId: z.string().optional(),
  traceId: z.string().optional(),
  dedupeKey: z.string().optional(),
  parentEventId: z.string().optional(),
  occurredAt: z.number().optional(),
  recordedAt: z.number().optional(),
}).passthrough()

export const observability = new Elysia({
  prefix: '/observability',
  detail: { tags: ['observability'] },
})
  .post('/events', ({ body }) => {
    Observability.record(CreateObservabilityEventBodySchema.parse(body))
    return { ok: true as const }
  }, {
    detail: {
      summary: 'Record observability event',
    },
    body: ObservabilityModel.createEventBody,
    response: { 200: ObservabilityModel.createEventResponse },
  })
  .get('/events', ({ query }) => Observability.getEvents(ObservabilityEventsQuerySchema.parse(query)), {
    detail: {
      'summary': 'List observability events',
      'x-cradle-cli': {
        command: ['observability', 'events'],
      },
    },
    query: ObservabilityModel.eventsQuery,
    response: { 200: t.Array(ObservabilityModel.event) },
  })
  .get('/incidents', ({ query }) => Observability.getIncidents(ObservabilityIncidentsQuerySchema.parse(query)), {
    detail: {
      'summary': 'List observability incidents',
      'x-cradle-cli': {
        command: ['observability', 'incidents'],
      },
    },
    query: ObservabilityModel.incidentsQuery,
    response: { 200: t.Array(ObservabilityModel.incident) },
  })
  .get('/error-patterns', ({ query }) => Observability.getErrorPatterns(ObservabilityErrorPatternsQuerySchema.parse(query)), {
    detail: {
      'summary': 'List observability error patterns',
      'x-cradle-cli': {
        command: ['observability', 'error-patterns'],
      },
    },
    query: ObservabilityModel.errorPatternsQuery,
    response: { 200: t.Array(ObservabilityModel.errorPattern) },
  })
  .post('/flush', async () => {
    await Observability.flushEvents()
    return { ok: true as const }
  }, {
    detail: { summary: 'Flush pending observability events' },
    response: { 200: ObservabilityModel.flushResponse },
  })
  .get('/export', ({ query }) => Observability.getExportBundle(ObservabilityExportQuerySchema.parse(query)), {
    detail: {
      'summary': 'Export observability bundle',
      'x-cradle-cli': {
        command: ['observability', 'export'],
      },
    },
    query: ObservabilityModel.exportQuery,
    response: { 200: ObservabilityModel.bundle },
  })
