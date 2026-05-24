import { t } from 'elysia'

const nullableRef = t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()]))
const nullableTargetKind = t.Optional(t.Union([
  t.Literal('manual'),
  t.Literal('external'),
  t.Null(),
]))

const openaiCompatibleConfig = t.Object({
  baseUrl: t.Optional(t.String()),
  model: t.Optional(t.String()),
  enabledModels: t.Optional(t.Array(t.String())),
  maxMessages: t.Optional(t.Number()),
})

const modelCapabilities = t.Object({
  contextWindow: t.Optional(t.Number()),
  maxOutput: t.Optional(t.Number()),
  inputModalities: t.Optional(t.Array(t.String())),
  outputModalities: t.Optional(t.Array(t.String())),
  reasoning: t.Optional(t.Boolean()),
  toolCall: t.Optional(t.Boolean()),
  temperature: t.Optional(t.Boolean()),
  structuredOutput: t.Optional(t.Boolean()),
  cost: t.Optional(t.Object({
    input: t.Optional(t.Number()),
    output: t.Optional(t.Number()),
    cacheRead: t.Optional(t.Number()),
    cacheWrite: t.Optional(t.Number()),
  })),
  family: t.Optional(t.String()),
  knowledgeCutoff: t.Optional(t.String()),
  releaseDate: t.Optional(t.String()),
  registryMatch: t.Optional(t.Union([
    t.Literal('exact'),
    t.Literal('fuzzy'),
    t.Literal('manual'),
    t.Literal('unmatched'),
  ])),
  registryModelId: t.Optional(t.String()),
  registryModelLabel: t.Optional(t.String()),
})

export const ProvidersModel = {
  providerBody: t.Object({
    providerKind: t.Union([t.Literal('openai-compatible'), t.Literal('anthropic')]),
    label: t.String({ minLength: 1 }),
    config: openaiCompatibleConfig,
    secretRef: nullableRef,
    profileId: nullableRef,
    providerTargetKind: nullableTargetKind,
    providerTargetId: nullableRef,
  }),

  modelDescriptor: t.Object({
    id: t.String(),
    label: t.String(),
    providerKind: t.String(),
    capabilities: modelCapabilities,
  }),

  modelCapabilities,

  healthCheckResult: t.Object({
    ok: t.Boolean(),
    label: t.String(),
    version: t.Union([t.String(), t.Null()]),
    details: t.Record(t.String(), t.Unknown()),
    errorText: t.Union([t.String(), t.Null()]),
  }),
}
