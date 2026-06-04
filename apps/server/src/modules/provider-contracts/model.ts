import { t } from 'elysia'

export const providerKindSchema = t.Union([t.Literal('openai-compatible'), t.Literal('anthropic'), t.Literal('universal')])

export const providerTargetKindSchema = t.Union([t.Literal('manual'), t.Literal('external')])

export const modelCapabilitiesSchema = t.Object({
  contextWindow: t.Optional(t.Number()),
  maxOutput: t.Optional(t.Number()),
  inputModalities: t.Optional(t.Array(t.String())),
  outputModalities: t.Optional(t.Array(t.String())),
  reasoning: t.Optional(t.Boolean()),
  toolCall: t.Optional(t.Boolean()),
  temperature: t.Optional(t.Boolean()),
  structuredOutput: t.Optional(t.Boolean()),
  cost: t.Optional(
    t.Object({
      input: t.Optional(t.Number()),
      output: t.Optional(t.Number()),
      cacheRead: t.Optional(t.Number()),
      cacheWrite: t.Optional(t.Number()),
    }),
  ),
  family: t.Optional(t.String()),
  knowledgeCutoff: t.Optional(t.String()),
  releaseDate: t.Optional(t.String()),
  registryMatch: t.Optional(
    t.Union([
      t.Literal('exact'),
      t.Literal('fuzzy'),
      t.Literal('manual'),
      t.Literal('alias'),
      t.Literal('unmatched'),
    ]),
  ),
  registryModelId: t.Optional(t.String()),
  registryModelLabel: t.Optional(t.String()),
})

export const modelDescriptorSchema = t.Object({
  id: t.String(),
  label: t.String(),
  providerKind: providerKindSchema,
  capabilities: modelCapabilitiesSchema,
})
