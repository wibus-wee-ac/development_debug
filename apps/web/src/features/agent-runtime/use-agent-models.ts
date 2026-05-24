import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { getProfilesById, getProvidersByProfileIdModelsCache } from '~/api-gen/sdk.gen'
import { getServerUrl } from '~/lib/electron'
import type { AgentProfile, ModelDescriptor, ProviderTarget } from '~/lib/types'

import { ModelVisibilitySchema, filterVisibleModels } from './model-visibility'
import { ProfileConfigJsonSchema } from './profile-config-schema'

export const AGENT_MODELS_QUERY_KEY = ['agent-models'] as const
const MODEL_INVENTORY_GC_TIME_MS = 1_800_000
const MODEL_INVENTORY_QUERY_OPTIONS = {
  staleTime: Infinity,
  gcTime: MODEL_INVENTORY_GC_TIME_MS,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false
} as const

export function agentModelsQueryKey(profileId: string | null) {
  return [...AGENT_MODELS_QUERY_KEY, profileId ?? 'no-profile'] as const
}

export function providerTargetModelsQueryKey(target: ProviderTarget | null) {
  return [
    ...AGENT_MODELS_QUERY_KEY,
    target ? `${target.kind}:${target.id}` : 'no-provider-target'
  ] as const
}

function providerTargetPath(target: ProviderTarget): string {
  return `${encodeURIComponent(target.kind)}/${encodeURIComponent(target.id)}`
}

const EMPTY_INITIAL_PROFILE_IDS: ReadonlyArray<string | null> = []

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
  updatedAt: z.number()
})
const ModelDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerKind: z.enum(['openai-compatible', 'anthropic']),
  capabilities: z
    .object({
      contextWindow: z.number().optional(),
      maxOutput: z.number().optional(),
      inputModalities: z.array(z.string()).optional(),
      outputModalities: z.array(z.string()).optional(),
      reasoning: z.boolean().optional(),
      toolCall: z.boolean().optional(),
      temperature: z.boolean().optional(),
      structuredOutput: z.boolean().optional(),
      cost: z
        .object({
          input: z.number().optional(),
          output: z.number().optional(),
          cacheRead: z.number().optional(),
          cacheWrite: z.number().optional()
        })
        .optional(),
      family: z.string().optional(),
      knowledgeCutoff: z.string().optional(),
      releaseDate: z.string().optional(),
      registryMatch: z.enum(['exact', 'fuzzy', 'manual', 'unmatched']).optional(),
      registryModelId: z.string().optional(),
      registryModelLabel: z.string().optional()
    })
    .default({})
})
const ModelDescriptorListSchema = z.array(ModelDescriptorSchema).default([])
const ProviderTargetModelSettingsSchema = z.object({
  configJson: z.string()
})
const ProviderTargetModelsCacheSchema = z.object({
  models: ModelDescriptorListSchema,
  cached: z.boolean(),
  stale: z.boolean(),
  providerLabel: z.string()
})

async function fetchCachedVisibleModelsForProfile(
  profile: AgentProfile
): Promise<ModelDescriptor[]> {
  const config = ProfileConfigJsonSchema.parse(profile.configJson)
  const visibility = ModelVisibilitySchema.parse(config.enabledModels)

  const { data: cache } = await getProvidersByProfileIdModelsCache({
    path: { profileId: profile.id },
    throwOnError: true
  })
  if (!cache.cached || cache.models.length === 0) {
    return []
  }

  const models = ModelDescriptorListSchema.parse(cache.models) satisfies ModelDescriptor[]
  return filterVisibleModels(models, visibility)
}

async function fetchCachedVisibleModelsForProviderTarget(
  target: ProviderTarget
): Promise<ModelDescriptor[]> {
  const [settingsResponse, cacheResponse] = await Promise.all([
    fetch(`${getServerUrl()}/provider-targets/${providerTargetPath(target)}/model-settings`),
    fetch(`${getServerUrl()}/providers/targets/${providerTargetPath(target)}/models-cache`)
  ])
  if (!settingsResponse.ok || !cacheResponse.ok) {
    return []
  }

  const settings = ProviderTargetModelSettingsSchema.parse(await settingsResponse.json())
  const config = ProfileConfigJsonSchema.parse(settings.configJson)
  const visibility = ModelVisibilitySchema.parse(config.enabledModels)
  const cache = ProviderTargetModelsCacheSchema.parse(await cacheResponse.json())
  if (!cache.cached || cache.models.length === 0) {
    return []
  }

  const models = ModelDescriptorListSchema.parse(cache.models) satisfies ModelDescriptor[]
  return filterVisibleModels(models, visibility)
}

export function useAgentModels(profileId: string | null) {
  const { data: models = [], isLoading } = useQuery({
    queryKey: agentModelsQueryKey(profileId),
    enabled: profileId !== null,
    queryFn: async (): Promise<ModelDescriptor[]> => {
      if (!profileId) {
        return []
      }
      const { data: profileData } = await getProfilesById({ path: { id: profileId } })
      const profile = AgentProfileSchema.parse(profileData) satisfies AgentProfile
      return fetchCachedVisibleModelsForProfile(profile)
    },
    ...MODEL_INVENTORY_QUERY_OPTIONS
  })

  return { models, isLoading }
}

export function useProviderTargetModels(target: ProviderTarget | null) {
  const { data: models = [], isLoading } = useQuery({
    queryKey: providerTargetModelsQueryKey(target),
    enabled: target !== null,
    queryFn: async (): Promise<ModelDescriptor[]> => {
      if (!target) {
        return []
      }
      return fetchCachedVisibleModelsForProviderTarget(target)
    },
    ...MODEL_INVENTORY_QUERY_OPTIONS
  })

  return { models, isLoading }
}

export function useAgentModelMap(
  profiles: AgentProfile[],
  initialProfileIds: ReadonlyArray<string | null> = EMPTY_INITIAL_PROFILE_IDS
) {
  const [requestedProfileIds, setRequestedProfileIds] = useState<Set<string>>(
    () => new Set(initialProfileIds.flatMap((profileId) => (profileId ? [profileId] : [])))
  )

  useEffect(() => {
    setRequestedProfileIds((current) => {
      let changed = false
      const next = new Set(current)
      for (const profileId of initialProfileIds) {
        if (profileId && !next.has(profileId)) {
          next.add(profileId)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [initialProfileIds])

  const requestedProfiles = useMemo(
    () => profiles.filter((profile) => requestedProfileIds.has(profile.id)),
    [profiles, requestedProfileIds]
  )

  const queries = useQueries({
    queries: requestedProfiles.map((profile) => ({
      queryKey: agentModelsQueryKey(profile.id),
      queryFn: () => fetchCachedVisibleModelsForProfile(profile),
      enabled: profile.enabled,
      ...MODEL_INVENTORY_QUERY_OPTIONS
    }))
  })

  const requestProfileModels = useCallback((profileId: string) => {
    setRequestedProfileIds((current) => {
      if (current.has(profileId)) {
        return current
      }
      const next = new Set(current)
      next.add(profileId)
      return next
    })
  }, [])

  const modelsByProfileId: Record<string, ModelDescriptor[]> = {}
  const loadingProfileIds = new Set<string>()
  const successfulProfileIds = new Set<string>()

  requestedProfiles.forEach((profile, index) => {
    const query = queries[index]
    modelsByProfileId[profile.id] = ModelDescriptorListSchema.parse(
      query?.data
    ) satisfies ModelDescriptor[]
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
    requestProfileModels
  }
}
