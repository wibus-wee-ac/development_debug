// Output: HTTP schemas for provider-target preference APIs.
// Input: TypeBox route definitions plus provider model metadata schema.
// Position: Provider-targets owns Cradle runtime preferences shared by manual profiles and external records.

import { t } from 'elysia'

import { ProvidersModel } from '../providers/model'

const providerTargetKind = t.Union([t.Literal('manual'), t.Literal('external')])
const providerKind = t.Union([t.Literal('openai-compatible'), t.Literal('anthropic')])

const modelsDevModel = t.Object({
  id: t.String({ minLength: 1 }),
  name: t.Optional(t.String()),
  limit: t.Optional(
    t.Object({
      context: t.Optional(t.Number()),
      output: t.Optional(t.Number())
    })
  ),
  modalities: t.Optional(
    t.Object({
      input: t.Optional(t.Array(t.String())),
      output: t.Optional(t.Array(t.String()))
    })
  ),
  reasoning: t.Optional(t.Boolean()),
  tool_call: t.Optional(t.Boolean()),
  temperature: t.Optional(t.Boolean()),
  structured_output: t.Optional(t.Boolean()),
  cost: t.Optional(
    t.Object({
      input: t.Optional(t.Number()),
      output: t.Optional(t.Number()),
      cache_read: t.Optional(t.Number()),
      cache_write: t.Optional(t.Number())
    })
  ),
  family: t.Optional(t.String()),
  knowledge: t.Optional(t.String()),
  release_date: t.Optional(t.String())
})

export const ProviderTargetsModel = {
  providerTarget: t.Object({
    id: t.String(),
    kind: providerTargetKind,
    providerKind,
    displayName: t.String(),
    enabled: t.Boolean(),
    iconSlug: t.Nullable(t.String()),
    connectionConfigJson: t.String(),
    credentialRef: t.Nullable(t.String()),
    enabledModelsJson: t.String(),
    customModelsJson: t.String(),
    modelRegistryMappingsJson: t.String(),
    sourceKey: t.Nullable(t.String()),
    externalRecordId: t.Nullable(t.String()),
    sourceFingerprint: t.Nullable(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number()
  }),

  upsertManualBody: t.Object({
    displayName: t.String({ minLength: 1 }),
    providerKind,
    enabled: t.Optional(t.Boolean()),
    connectionConfig: t.Record(t.String(), t.Unknown()),
    credentialRef: t.Optional(t.Nullable(t.String())),
    iconSlug: t.Optional(t.Nullable(t.String()))
  }),

  idParams: t.Object({
    providerTargetId: t.String({ minLength: 1 })
  }),

  targetParams: t.Object({
    providerTargetKind: t.Union([
      providerTargetKind,
      t.Literal('manual-profile'),
      t.Literal('external-record')
    ]),
    providerTargetId: t.String({ minLength: 1 })
  }),

  modelSettings: t.Object({
    providerTargetKind: t.Optional(providerTargetKind),
    providerTargetId: t.String(),
    connectionConfigJson: t.String(),
    enabledModelsJson: t.String(),
    configJson: t.String(),
    customModelsJson: t.String(),
    modelRegistryMappingsJson: t.String()
  }),

  modelVisibilityBody: t.Object({
    enabledModels: t.Array(t.String({ minLength: 1 }))
  }),

  customModelsBody: t.Object({
    models: t.Array(
      t.Object({
        id: t.String({ minLength: 1 }),
        label: t.Optional(t.String()),
        capabilities: t.Optional(ProvidersModel.modelCapabilities)
      })
    )
  }),

  customModelEntry: t.Object({
    id: t.String(),
    label: t.String(),
    capabilities: ProvidersModel.modelCapabilities
  }),

  customModelEntryList: t.Array(
    t.Object({
      id: t.String(),
      label: t.String(),
      capabilities: ProvidersModel.modelCapabilities
    })
  ),

  modelRegistryMappingBody: t.Object({
    modelId: t.String({ minLength: 1 }),
    registryModelId: t.Optional(t.String({ minLength: 1 })),
    model: t.Optional(modelsDevModel)
  }),

  modelRegistryMappingEntry: t.Object({
    modelId: t.String(),
    registryModelId: t.Optional(t.String()),
    model: t.Optional(modelsDevModel),
    updatedAt: t.Optional(t.Number())
  }),

  modelRegistryMappingEntryList: t.Array(
    t.Object({
      modelId: t.String(),
      registryModelId: t.Optional(t.String()),
      model: t.Optional(modelsDevModel),
      updatedAt: t.Optional(t.Number())
    })
  )
}
