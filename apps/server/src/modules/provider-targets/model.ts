// Output: HTTP schemas for provider-target preference APIs.
// Input: TypeBox route definitions plus provider model metadata schema.
// Position: Provider-targets owns Cradle runtime preferences shared by manual profiles and external records.

import { t } from 'elysia'

import { ProvidersModel } from '../providers/model'

const providerTargetKind = t.Union([t.Literal('manual'), t.Literal('external')])
const providerKind = t.Union([t.Literal('openai-compatible'), t.Literal('anthropic')])

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
    sourceKey: t.Nullable(t.String()),
    externalRecordId: t.Nullable(t.String()),
    sourceFingerprint: t.Nullable(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  upsertManualBody: t.Object({
    displayName: t.String({ minLength: 1 }),
    providerKind,
    enabled: t.Optional(t.Boolean()),
    connectionConfig: t.Record(t.String(), t.Unknown()),
    credentialRef: t.Optional(t.Nullable(t.String())),
    iconSlug: t.Optional(t.Nullable(t.String())),
  }),

  idParams: t.Object({
    providerTargetId: t.String({ minLength: 1 }),
  }),

  targetParams: t.Object({
    providerTargetKind,
    providerTargetId: t.String({ minLength: 1 }),
  }),

  modelSettings: t.Object({
    providerTargetKind: t.Optional(providerTargetKind),
    providerTargetId: t.String(),
    connectionConfigJson: t.String(),
    enabledModelsJson: t.String(),
    configJson: t.String(),
    customModelsJson: t.String(),
  }),

  modelVisibilityBody: t.Object({
    enabledModels: t.Array(t.String({ minLength: 1 })),
  }),

  customModelsBody: t.Object({
    models: t.Array(
      t.Object({
        id: t.String({ minLength: 1 }),
        label: t.Optional(t.String()),
      }),
    ),
  }),

  customModelEntry: t.Object({
    id: t.String(),
    label: t.String(),
    capabilities: ProvidersModel.modelCapabilities,
  }),

  customModelEntryList: t.Array(
    t.Object({
      id: t.String(),
      label: t.String(),
      capabilities: ProvidersModel.modelCapabilities,
    }),
  ),
}
