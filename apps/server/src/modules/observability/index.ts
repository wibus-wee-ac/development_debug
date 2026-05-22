import { Elysia, t } from 'elysia'
import { z } from 'zod'

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

export const observability = new Elysia({
  prefix: '/observability',
  detail: { tags: ['observability'] },
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
