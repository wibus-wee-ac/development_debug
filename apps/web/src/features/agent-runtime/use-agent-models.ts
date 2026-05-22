import { useQueries, useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { getProfilesById, getProvidersByProfileIdModelsCache, postProvidersModels } from '~/api-gen/sdk.gen'
import type { AgentProfile, ModelDescriptor } from '~/lib/types'

import { ModelVisibilitySchema, filterVisibleModels } from './model-visibility'
import { ProfileConfigJsonSchema } from './profile-config-schema'

export const AGENT_MODELS_QUERY_KEY = ['agent-models'] as const
const AgentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  providerKind: z.enum(['openai-compatible', 'anthropic']),
  enabled: z.boolean(),
  configJson: z.string(),
  credentialRef: z.string().nullable(),
  customModels: z.string(),
  iconSlug: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
const ModelDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerKind: z.enum(['openai-compatible', 'anthropic']),
  capabilities: z.object({
    contextWindow: z.number().optional(),
    maxOutput: z.number().optional(),
    inputModalities: z.array(z.string()).optional(),
    outputModalities: z.array(z.string()).optional(),
    reasoning: z.boolean().optional(),
    toolCall: z.boolean().optional(),
    temperature: z.boolean().optional(),
    structuredOutput: z.boolean().optional(),
    cost: z.object({
      input: z.number().optional(),
      output: z.number().optional(),
      cacheRead: z.number().optional(),
      cacheWrite: z.number().optional(),
    }).optional(),
    family: z.string().optional(),
    knowledgeCutoff: z.string().optional(),
    releaseDate: z.string().optional(),
    registryMatch: z.enum(['exact', 'fuzzy', 'manual', 'unmatched']).optional(),
    registryModelId: z.string().optional(),
    registryModelLabel: z.string().optional(),
  }).default({}),
})
const ModelDescriptorListSchema = z.array(ModelDescriptorSchema).default([])

async function fetchVisibleModelsForProfile(profile: AgentProfile): Promise<ModelDescriptor[]> {
  const config = ProfileConfigJsonSchema.parse(profile.configJson)
  const visibility = ModelVisibilitySchema.parse(config.enabledModels)
  const requestBody = {
    providerKind: profile.providerKind,
    label: profile.name,
    config,
    secretRef: profile.credentialRef ?? null,
    profileId: profile.id,
  } as const

  let allModels: ModelDescriptor[]
  try {
    const { data } = await postProvidersModels({
      body: requestBody,
      throwOnError: true,
    })
    allModels = ModelDescriptorListSchema.parse(data) satisfies ModelDescriptor[]
  }
  catch (error) {
    const { data: cache } = await getProvidersByProfileIdModelsCache({
      path: { profileId: profile.id },
      throwOnError: true,
    })
    if (cache.cached && cache.models.length > 0) {
      allModels = ModelDescriptorListSchema.parse(cache.models) satisfies ModelDescriptor[]
    }
    else {
      throw error
    }
  }
  return filterVisibleModels(allModels, visibility)
}

export function useAgentModels(profileId: string | null) {
  const { data: models = [], isLoading } = useQuery({
    queryKey: [...AGENT_MODELS_QUERY_KEY, profileId] as const,
    enabled: profileId !== null,
    queryFn: async (): Promise<ModelDescriptor[]> => {
      if (!profileId) {
        return []
      }
      const { data: profileData } = await getProfilesById({ path: { id: profileId } })
      const profile = AgentProfileSchema.parse(profileData) satisfies AgentProfile
      return fetchVisibleModelsForProfile(profile)
    },
    staleTime: 60_000,
    retry: 2,
    retryDelay: 1000,
  })

  return { models, isLoading }
}

export function useAgentModelMap(profiles: AgentProfile[]) {
  const queries = useQueries({
    queries: profiles.map(profile => ({
      queryKey: [...AGENT_MODELS_QUERY_KEY, profile.id, profile.updatedAt] as const,
      queryFn: () => fetchVisibleModelsForProfile(profile),
      enabled: profile.enabled,
      staleTime: 60_000,
      retry: 2,
      retryDelay: 1000,
    })),
  })

  const modelsByProfileId: Record<string, ModelDescriptor[]> = {}
  const loadingProfileIds = new Set<string>()
  const successfulProfileIds = new Set<string>()

  profiles.forEach((profile, index) => {
    const query = queries[index]
    modelsByProfileId[profile.id] = ModelDescriptorListSchema.parse(query?.data) satisfies ModelDescriptor[]
    if (query?.isLoading || query?.isFetching) {
      loadingProfileIds.add(profile.id)
    }
    if (query?.isSuccess) {
      successfulProfileIds.add(profile.id)
    }
  })

  return {
    modelsByProfileId,
    loadingProfileIds,
    successfulProfileIds,
  }
}
