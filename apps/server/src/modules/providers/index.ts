import { Elysia, t } from 'elysia'

import { lookupModel } from './model-info-registry'
import { ProvidersModel } from './model'
import * as Providers from './service'

export const providers = new Elysia({
  prefix: '/providers',
  detail: { tags: ['providers'] },
})
  .post('/models', ({ body }) => Providers.listModels(Providers.parseProviderBody(body)), {
    detail: {
      summary: 'List models for a provider',
      'x-cradle-cli': {
        command: ['provider', 'models'],
      },
    },
    body: ProvidersModel.providerBody,
    response: { 200: t.Array(ProvidersModel.modelDescriptor) },
  })
  .post('/health-check', ({ body }) => Providers.healthCheck(Providers.parseProviderBody(body)), {
    detail: {
      summary: 'Health check a provider',
      'x-cradle-cli': {
        command: ['provider', 'health-check'],
      },
    },
    body: ProvidersModel.providerBody,
    response: { 200: ProvidersModel.healthCheckResult },
  })
  .post('/model-lookup', async ({ body }) => {
    return await lookupModel(body.modelId) ?? null
  }, {
    detail: {
      summary: 'Look up model metadata from registry',
    },
    body: t.Object({
      modelId: t.String({ minLength: 1 }),
    }),
    response: {
      200: t.Union([
        t.Object({
          id: t.String(),
          label: t.String(),
          contextWindow: t.Union([t.Number(), t.Null()]),
        }),
        t.Null(),
      ]),
    },
  })
