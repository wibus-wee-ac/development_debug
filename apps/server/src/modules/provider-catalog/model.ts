import { t } from 'elysia'

import {
  modelCapabilitiesSchema,
  modelDescriptorSchema,
  providerKindSchema,
} from '../provider-contracts/model'

const openaiCompatibleConfig = t.Object({
  baseUrl: t.Optional(t.String()),
  model: t.Optional(t.String()),
  enabledModels: t.Optional(t.Array(t.String())),
  maxMessages: t.Optional(t.Number()),
})

const nullableRef = t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()]))
const nullableTargetKind = t.Optional(
  t.Union([t.Literal('manual'), t.Literal('external'), t.Null()]),
)

export const ProvidersModel = {
  providerBody: t.Object({
    providerKind: providerKindSchema,
    label: t.String({ minLength: 1 }),
    config: openaiCompatibleConfig,
    secretRef: nullableRef,
    profileId: nullableRef,
    providerTargetKind: nullableTargetKind,
    providerTargetId: nullableRef,
  }),

  modelDescriptor: modelDescriptorSchema,

  modelCapabilities: modelCapabilitiesSchema,
}
