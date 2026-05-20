import { t } from 'elysia'

import { ProvidersModel } from '../providers/model'

const modelsDevModel = t.Object({
  id: t.String({ minLength: 1 }),
  name: t.Optional(t.String()),
  limit: t.Optional(t.Object({
    context: t.Optional(t.Number()),
    output: t.Optional(t.Number()),
  })),
  modalities: t.Optional(t.Object({
    input: t.Optional(t.Array(t.String())),
    output: t.Optional(t.Array(t.String())),
  })),
  reasoning: t.Optional(t.Boolean()),
  tool_call: t.Optional(t.Boolean()),
  temperature: t.Optional(t.Boolean()),
  structured_output: t.Optional(t.Boolean()),
  cost: t.Optional(t.Object({
    input: t.Optional(t.Number()),
    output: t.Optional(t.Number()),
    cache_read: t.Optional(t.Number()),
    cache_write: t.Optional(t.Number()),
  })),
  family: t.Optional(t.String()),
  knowledge: t.Optional(t.String()),
  release_date: t.Optional(t.String()),
})

export const ProfilesModel = {
  agentProfile: t.Object({
    id: t.String(),
    name: t.String(),
    providerKind: t.Union([t.Literal('openai-compatible'), t.Literal('anthropic')]),
    enabled: t.Boolean(),
    configJson: t.String(),
    credentialRef: t.Nullable(t.String()),
    customModels: t.String(),
    iconSlug: t.Nullable(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  upsertBody: t.Object({
    name: t.String({ minLength: 1 }),
    providerKind: t.Union([t.Literal('openai-compatible'), t.Literal('anthropic')]),
    enabled: t.Boolean(),
    config: t.Record(t.String(), t.Any()),
    credentialRef: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    iconSlug: t.Optional(t.Nullable(t.String())),
  }),

  customModelsBody: t.Object({
    models: t.Array(t.Object({
      id: t.String({ minLength: 1 }),
      label: t.Optional(t.String()),
      capabilities: t.Optional(ProvidersModel.modelCapabilities),
    })),
  }),

  customModelEntry: t.Object({
    id: t.String(),
    label: t.String(),
    capabilities: ProvidersModel.modelCapabilities,
  }),

  modelRegistryMappingBody: t.Object({
    modelId: t.String({ minLength: 1 }),
    registryModelId: t.Optional(t.String({ minLength: 1 })),
    model: t.Optional(modelsDevModel),
  }),

  modelRegistryMappingEntry: t.Object({
    modelId: t.String(),
    registryModelId: t.Optional(t.String()),
    model: t.Optional(modelsDevModel),
    updatedAt: t.Optional(t.Number()),
  }),
}
