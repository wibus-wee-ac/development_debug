import { t } from 'elysia'

const nullableRef = t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()]))

const openaiCompatibleConfig = t.Object({
  baseUrl: t.Optional(t.String()),
  model: t.Optional(t.String()),
  enabledModels: t.Optional(t.Array(t.String())),
  maxMessages: t.Optional(t.Number()),
})

export const ProvidersModel = {
  providerBody: t.Object({
    providerKind: t.Literal('openai-compatible'),
    label: t.String({ minLength: 1 }),
    config: openaiCompatibleConfig,
    secretRef: nullableRef,
    profileId: nullableRef,
  }),

  modelDescriptor: t.Object({
    id: t.String(),
    label: t.String(),
    providerKind: t.String(),
    contextWindow: t.Union([t.Number(), t.Null()]),
  }),

  healthCheckResult: t.Object({
    ok: t.Boolean(),
    label: t.String(),
    version: t.Union([t.String(), t.Null()]),
    details: t.Record(t.String(), t.Unknown()),
    errorText: t.Union([t.String(), t.Null()]),
  }),
}
