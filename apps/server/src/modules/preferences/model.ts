import { t } from 'elysia'
import { z } from 'zod'

const nullableString = t.Union([t.String(), t.Null()])
const nullableProfileRef = t.Union([t.String({ description: 'ID of the agent profile to use for Jarvis' }), t.Null()])
const runtimeKindRef = t.String({ minLength: 1, description: 'Chat runtime ID used by Jarvis sessions' })

export const PreferencesModel = {
  chatPreferences: t.Object({
    modelId: nullableString,
    configSelections: t.Record(t.String(), t.Union([t.String(), t.Boolean()])),
    continuationBehavior: t.Union([
      t.Literal('queue'),
      t.Literal('steer'),
    ], { default: 'queue' }),
  }, { additionalProperties: false }),
  chatPreferencesUpdate: t.Object({
    modelId: nullableString,
    configSelections: t.Record(t.String(), t.Union([t.String(), t.Boolean()])),
    continuationBehavior: t.Optional(t.Union([
      t.Literal('queue'),
      t.Literal('steer'),
    ], { default: 'queue' })),
  }, { additionalProperties: false }),
  codexPreferences: t.Object({
    useCradleUserAgent: t.Boolean({ default: true }),
  }, { additionalProperties: false }),
  jarvisPreferences: t.Object({
    runtimeKind: t.Optional(runtimeKindRef),
    profileId: nullableProfileRef,
    model: t.Optional(t.String({ description: 'Explicit model ID for Jarvis (e.g. gpt-4o, claude-3-7-sonnet)' })),
    thinkingLevel: t.Union([
      t.Literal('minimal'),
      t.Literal('low'),
      t.Literal('medium'),
      t.Literal('high'),
      t.Literal('xhigh'),
    ], { default: 'medium' }),
  }, { additionalProperties: false }),
  savedResponse: t.Object({
    ok: t.Literal(true),
  }),
} as const

export const ChatPreferencesJsonSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)),
  z.undefined(),
]).pipe(z.object({
  modelId: z.string().nullable().default(null),
  configSelections: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
  continuationBehavior: z.enum(['queue', 'steer']).default('queue'),
}).default({
  modelId: null,
  configSelections: {},
  continuationBehavior: 'queue',
}))

export const CodexPreferencesJsonSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)),
  z.undefined(),
]).pipe(z.object({
  useCradleUserAgent: z.boolean().default(true),
}).default({
  useCradleUserAgent: true,
}))

export const JarvisPreferencesJsonSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)),
  z.undefined(),
]).pipe(z.object({
  runtimeKind: z.string().min(1).default('jar-core'),
  profileId: z.string().nullable().default(null),
  model: z.string().optional(),
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).default('medium'),
}).default({
  runtimeKind: 'jar-core',
  profileId: null,
  thinkingLevel: 'medium',
}))
