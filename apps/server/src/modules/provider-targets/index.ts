// Output: Provider-target preference routes for model visibility, custom models, and registry mappings.
// Input: Provider target path params plus model preference request bodies.
// Position: Exposes Cradle-owned runtime target preferences without writing to external source namespaces.

import { Elysia, t } from 'elysia'

import { ProviderTargetsModel } from './model'
import * as ProviderTargets from './service'

export const providerTargets = new Elysia({
  prefix: '/provider-targets',
  detail: { tags: ['provider-targets'] }
})
  .get(
    '/',
    () => ProviderTargets.listProviderTargets(),
    {
      detail: {
        summary: 'List provider targets'
      },
      response: { 200: t.Array(ProviderTargetsModel.providerTarget) }
    }
  )
  .put(
    '/:providerTargetId',
    ({ params, body }) => {
      return ProviderTargets.upsertManualProviderTarget({
        id: params.providerTargetId,
        displayName: body.displayName,
        providerKind: body.providerKind,
        enabled: body.enabled,
        connectionConfigJson: JSON.stringify(body.connectionConfig),
        credentialRef: body.credentialRef ?? null,
        iconSlug: body.iconSlug
      })
    },
    {
      detail: {
        summary: 'Create or update a manual provider target'
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.upsertManualBody,
      response: { 200: ProviderTargetsModel.providerTarget }
    }
  )
  .delete(
    '/:providerTargetId',
    ({ params }) => {
      ProviderTargets.removeProviderTarget(params.providerTargetId)
      return { ok: true as const }
    },
    {
      detail: {
        summary: 'Delete provider target'
      },
      params: ProviderTargetsModel.idParams,
      response: { 200: t.Object({ ok: t.Literal(true) }) }
    }
  )
  .get(
    '/:providerTargetId/model-settings',
    ({ params }) => ProviderTargets.getProviderTargetModelSettings(params.providerTargetId),
    {
      detail: {
        summary: 'Get model settings for a provider target'
      },
      params: ProviderTargetsModel.idParams,
      response: { 200: ProviderTargetsModel.modelSettings }
    }
  )
  .patch(
    '/:providerTargetId/model-visibility',
    ({ params, body }) =>
      ProviderTargets.updateProviderTargetModelVisibility(params.providerTargetId, body.enabledModels),
    {
      detail: {
        summary: 'Update visible models for a provider target'
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.modelVisibilityBody,
      response: { 200: ProviderTargetsModel.modelSettings }
    }
  )
  .patch(
    '/:providerTargetId/custom-models',
    ({ params, body }) =>
      ProviderTargets.updateProviderTargetCustomModels(params.providerTargetId, body.models),
    {
      detail: {
        summary: 'Update custom models for a provider target'
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.customModelsBody,
      response: { 200: ProviderTargetsModel.customModelEntryList }
    }
  )
  .patch(
    '/:providerTargetId/model-registry-mappings',
    ({ params, body }) =>
      ProviderTargets.updateProviderTargetModelRegistryMapping(params.providerTargetId, body),
    {
      detail: {
        summary: 'Update model registry mapping for a provider target'
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.modelRegistryMappingBody,
      response: { 200: ProviderTargetsModel.modelRegistryMappingEntryList }
    }
  )
  .get(
    '/:providerTargetKind/:providerTargetId/model-settings',
    ({ params }) => {
      return ProviderTargets.getProviderTargetModelSettings({
        kind: params.providerTargetKind,
        id: params.providerTargetId
      })
    },
    {
      detail: {
        summary: 'Get model settings for a provider target'
      },
      params: ProviderTargetsModel.targetParams,
      response: { 200: ProviderTargetsModel.modelSettings }
    }
  )
  .patch(
    '/:providerTargetKind/:providerTargetId/model-visibility',
    ({ params, body }) => {
      return ProviderTargets.updateProviderTargetModelVisibility(
        {
          kind: params.providerTargetKind,
          id: params.providerTargetId
        },
        body.enabledModels
      )
    },
    {
      detail: {
        summary: 'Update visible models for a provider target'
      },
      params: ProviderTargetsModel.targetParams,
      body: ProviderTargetsModel.modelVisibilityBody,
      response: { 200: ProviderTargetsModel.modelSettings }
    }
  )
  .patch(
    '/:providerTargetKind/:providerTargetId/custom-models',
    ({ params, body }) => {
      return ProviderTargets.updateProviderTargetCustomModels(
        {
          kind: params.providerTargetKind,
          id: params.providerTargetId
        },
        body.models
      )
    },
    {
      detail: {
        summary: 'Update custom models for a provider target'
      },
      params: ProviderTargetsModel.targetParams,
      body: ProviderTargetsModel.customModelsBody,
      response: { 200: ProviderTargetsModel.customModelEntryList }
    }
  )
  .patch(
    '/:providerTargetKind/:providerTargetId/model-registry-mappings',
    ({ params, body }) => {
      return ProviderTargets.updateProviderTargetModelRegistryMapping(
        {
          kind: params.providerTargetKind,
          id: params.providerTargetId
        },
        body
      )
    },
    {
      detail: {
        summary: 'Update model registry mapping for a provider target'
      },
      params: ProviderTargetsModel.targetParams,
      body: ProviderTargetsModel.modelRegistryMappingBody,
      response: { 200: ProviderTargetsModel.modelRegistryMappingEntryList }
    }
  )
