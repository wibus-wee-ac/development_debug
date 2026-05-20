// Input: profile API and providers API, profileId/profile list
// Output: hooks that fetch visible models for provider-backed agent profiles
// Position: Data hook for model selection in the New Chat flow

import { useQueries, useQuery } from '@tanstack/react-query'

import { getProfilesById, getProvidersByProfileIdModelsCache, postProvidersModels } from '~/api-gen/sdk.gen'
import type { AgentProfile, ModelDescriptor } from '~/lib/types'

import { filterVisibleModels, readConfigModelVisibility } from './model-visibility'

export const AGENT_MODELS_QUERY_KEY = ['agent-models'] as const

function parseProfileConfig(configJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(configJson)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

async function fetchVisibleModelsForProfile(profile: AgentProfile): Promise<ModelDescriptor[]> {
  const config = parseProfileConfig(profile.configJson)
  const visibility = readConfigModelVisibility(config)
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
    allModels = (data ?? []) as ModelDescriptor[]
  }
  catch (error) {
    const { data: cache } = await getProvidersByProfileIdModelsCache({
      path: { profileId: profile.id },
      throwOnError: true,
    })
    if (cache.cached && cache.models.length > 0) {
      allModels = cache.models as ModelDescriptor[]
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
      const profile = profileData as AgentProfile | undefined
      if (!profile) {
        return []
      }
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

  profiles.forEach((profile, index) => {
    const query = queries[index]
    modelsByProfileId[profile.id] = (query?.data ?? []) as ModelDescriptor[]
    if (query?.isLoading || query?.isFetching) {
      loadingProfileIds.add(profile.id)
    }
  })

  return {
    modelsByProfileId,
    loadingProfileIds,
  }
}
