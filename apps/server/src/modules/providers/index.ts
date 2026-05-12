import { Elysia, t } from 'elysia'

import { ProvidersModel } from './model'
import * as Providers from './service'

export const providers = new Elysia({
  prefix: '/providers',
  detail: { tags: ['providers'] },
})
  .post('/models', ({ body }) => Providers.listModels(Providers.parseProviderBody(body)), {
    detail: { summary: 'List models for a provider' },
    body: ProvidersModel.providerBody,
    response: { 200: t.Array(ProvidersModel.modelDescriptor) },
  })
  .post('/health-check', ({ body }) => Providers.healthCheck(Providers.parseProviderBody(body)), {
    detail: { summary: 'Health check a provider' },
    body: ProvidersModel.providerBody,
    response: { 200: ProvidersModel.healthCheckResult },
  })
