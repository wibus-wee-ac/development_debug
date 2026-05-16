import { t } from 'elysia'

import { ProvidersModel } from '../providers/model'

export const ProfilesModel = {
  agentProfile: t.Object({
    id: t.String(),
    name: t.String(),
    providerKind: t.Union([t.Literal('openai-compatible'), t.Literal('anthropic')]),
    enabled: t.Boolean(),
    configJson: t.String(),
    credentialRef: t.Nullable(t.String()),
    customModels: t.String(),
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
}
