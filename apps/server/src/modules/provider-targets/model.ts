import { t } from 'elysia'

import { modelCapabilitiesSchema, providerKindSchema } from '../provider-contracts/model'

const providerTargetKind = t.Union([t.Literal('manual'), t.Literal('external')])
const providerKind = providerKindSchema
const nullableString = t.Union([t.String(), t.Null()])

export const ProviderTargetsModel = {
  providerTarget: t.Object({
    id: t.String(),
    kind: providerTargetKind,
    providerKind,
    displayName: t.String(),
    enabled: t.Boolean(),
    iconSlug: nullableString,
    connectionConfigJson: t.String(),
    credentialRef: nullableString,
    enabledModelsJson: t.String(),
    customModelsJson: t.String(),
    sourceKey: nullableString,
    externalRecordId: nullableString,
    sourceFingerprint: nullableString,
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  upsertManualBody: t.Object({
    displayName: t.String({ minLength: 1 }),
    providerKind,
    enabled: t.Optional(t.Boolean()),
    connectionConfig: t.Record(t.String(), t.Unknown()),
    credentialRef: t.Optional(nullableString),
    iconSlug: t.Optional(nullableString),
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
    capabilities: modelCapabilitiesSchema,
  }),

  customModelEntryList: t.Array(
    t.Object({
      id: t.String(),
      label: t.String(),
      capabilities: modelCapabilitiesSchema,
    }),
  ),
}
