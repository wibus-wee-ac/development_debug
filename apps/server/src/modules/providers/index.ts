import { agentProfiles } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'

import { db } from '../../infra'
import { ProvidersModel } from './model'
import { getCachedModels, isCacheStale, setCachedModels } from './model-cache'
import { enrichModelsFromRegistryMappings, lookupModel, searchModels } from './model-info-registry'
import { parseProfileConfig, readModelRegistryMappings } from './model-registry-mappings'
import * as Providers from './service'

export const providers = new Elysia({
  prefix: '/providers',
  detail: { tags: ['providers'] },
})
  .post('/models', async ({ body }) => {
    const models = await Providers.listModels(Providers.parseProviderBody(body))
    if (body.profileId) {
      setCachedModels(body.profileId, models)
    }
    return models
  }, {
    detail: {
      'summary': 'List models for a provider',
      'x-cradle-cli': {
        command: ['provider', 'models'],
      },
    },
    body: ProvidersModel.providerBody,
    response: { 200: t.Array(ProvidersModel.modelDescriptor) },
  })
  .get('/:profileId/models-cache', async ({ params }) => {
    const cached = getCachedModels(params.profileId)
    if (!cached) {
      return { models: [], cached: false, stale: false }
    }
    const profile = db().select({ configJson: agentProfiles.configJson }).from(agentProfiles).where(eq(agentProfiles.id, params.profileId)).get()
    const mappings = profile ? readModelRegistryMappings(parseProfileConfig(profile.configJson)) : []
    const stale = isCacheStale(cached.fetchedAt)
    return { models: await enrichModelsFromRegistryMappings(cached.models, mappings), cached: true, stale }
  }, {
    detail: {
      summary: 'Get cached models for a provider profile',
    },
    params: t.Object({
      profileId: t.String({ minLength: 1 }),
    }),
    response: {
      200: t.Object({
        models: t.Array(ProvidersModel.modelDescriptor),
        cached: t.Boolean(),
        stale: t.Boolean(),
      }),
    },
  })
  .post('/health-check', ({ body }) => Providers.healthCheck(Providers.parseProviderBody(body)), {
    detail: {
      'summary': 'Health check a provider',
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
          capabilities: ProvidersModel.modelCapabilities,
        }),
        t.Null(),
      ]),
    },
  })
  .post('/model-search', async ({ body }) => {
    return await searchModels(body.query, 20)
  }, {
    detail: {
      summary: 'Search models from models.dev registry',
    },
    body: t.Object({
      query: t.String({ minLength: 1 }),
    }),
    response: {
      200: t.Array(t.Object({
        id: t.String(),
        label: t.String(),
        capabilities: ProvidersModel.modelCapabilities,
      })),
    },
  })
