import { useQueries, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'

import {
  getProfilesById,
  getProvidersByProfileIdModelsCache,
  getProvidersTargetsByProviderTargetIdModelsCache,
  getProviderTargetsByProviderTargetIdModelSettings,
} from '~/api-gen/sdk.gen'
import type { AgentProfile, ModelDescriptor, ProviderTarget } from '~/lib/types'

import { filterVisibleModels, ModelVisibilitySchema } from './model-visibility'
import { ProfileConfigJsonSchema } from './profile-config-schema'

export const AGENT_MODELS_QUERY_KEY = ['agent-models'] as const
const MODEL_INVENTORY_GC_TIME_MS = 1_800_000
const MODEL_INVENTORY_QUERY_OPTIONS = {
  staleTime: Infinity,
  gcTime: MODEL_INVENTORY_GC_TIME_MS,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
} as const

export function agentModelsQueryKey(profileId: string | null) {
  return [...AGENT_MODELS_QUERY_KEY, profileId ?? 'no-profile'] as const
}

export function providerTargetModelsQueryKey(target: ProviderTarget | null) {
  return [
    ...AGENT_MODELS_QUERY_KEY,
    target ? `provider-target:${target.id}` : 'no-provider-target',
  ] as const
}

const EMPTY_INITIAL_PROFILE_IDS: ReadonlyArray<string | null> = []

const AgentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  providerKind: z.enum(['openai-compatible', 'anthropic', 'universal']),
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
  providerKind: z.enum(['openai-compatible', 'anthropic', 'universal']),
  capabilities: z
    .object({
      contextWindow: z.number().optional(),
      maxOutput: z.number().optional(),
      inputModalities: z.array(z.string()).optional(),
      outputModalities: z.array(z.string()).optional(),
      reasoning: z.boolean().optional(),
      reasoningEfforts: z.array(z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])).optional(),
      toolCall: z.boolean().optional(),
      temperature: z.boolean().optional(),
      structuredOutput: z.boolean().optional(),
      cost: z
        .object({
          input: z.number().optional(),
          output: z.number().optional(),
          cacheRead: z.number().optional(),
          cacheWrite: z.number().optional(),
        })
        .optional(),
      family: z.string().optional(),
      knowledgeCutoff: z.string().optional(),
      releaseDate: z.string().optional(),
      registryMatch: z.enum(['exact', 'fuzzy', 'manual', 'alias', 'unmatched']).optional(),
      registryModelId: z.string().optional(),
      registryModelLabel: z.string().optional(),
    })
    .default({}),
})
const ModelDescriptorListSchema = z.array(ModelDescriptorSchema).default([])
const ProviderTargetModelSettingsSchema = z.object({
  configJson: z.string(),
})
const ProviderTargetModelsCacheSchema = z.object({
  models: ModelDescriptorListSchema,
  cached: z.boolean(),
  stale: z.boolean(),
  providerLabel: z.string(),
})

async function fetchCachedVisibleModelsForProfile(
  profile: AgentProfile,
): Promise<ModelDescriptor[]> {
  const config = ProfileConfigJsonSchema.parse(profile.configJson)
  const visibility = ModelVisibilitySchema.parse(config.enabledModels)

  const { data: cache } = await getProvidersByProfileIdModelsCache({
    path: { profileId: profile.id },
    throwOnError: true,
  })
  if (!cache.cached || cache.models.length === 0) {
    return []
  }

  const models = ModelDescriptorListSchema.parse(cache.models) satisfies ModelDescriptor[]
  return filterVisibleModels(models, visibility)
}

async function fetchCachedVisibleModelsForProviderTarget(
  target: ProviderTarget,
): Promise<ModelDescriptor[]> {
  const [settingsResult, cacheResult] = await Promise.all([
    getProviderTargetsByProviderTargetIdModelSettings({
      path: { providerTargetId: target.id },
      throwOnError: true,
    }),
    getProvidersTargetsByProviderTargetIdModelsCache({
      path: { providerTargetId: target.id },
      throwOnError: true,
    }),
  ])

  const settings = ProviderTargetModelSettingsSchema.parse(settingsResult.data)
  const config = ProfileConfigJsonSchema.parse(settings.configJson)
  const visibility = ModelVisibilitySchema.parse(config.enabledModels)
  const cache = ProviderTargetModelsCacheSchema.parse(cacheResult.data)
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
    ...MODEL_INVENTORY_QUERY_OPTIONS,
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
    ...MODEL_INVENTORY_QUERY_OPTIONS,
  })

  return { models, isLoading }
}

export function useAgentModelMap(
  profiles: AgentProfile[],
  initialProfileIds: ReadonlyArray<string | null> = EMPTY_INITIAL_PROFILE_IDS,
) {
  const [requestedProfileIds, setRequestedProfileIds] = useState<Set<string>>(
    () => new Set(initialProfileIds.flatMap(profileId => (profileId ? [profileId] : []))),
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
    () => profiles.filter(profile => requestedProfileIds.has(profile.id)),
    [profiles, requestedProfileIds],
  )

  const queries = useQueries({
    queries: requestedProfiles.map(profile => ({
      queryKey: agentModelsQueryKey(profile.id),
      queryFn: () => fetchCachedVisibleModelsForProfile(profile),
      enabled: profile.enabled,
      ...MODEL_INVENTORY_QUERY_OPTIONS,
    })),
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
      query?.data,
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
    requestProfileModels,
  }
}

export function useProviderTargetModelMap(
  providerTargets: Array<ProviderTarget & { enabled: boolean }>,
  initialProviderTargetIds: ReadonlyArray<string | null> = EMPTY_INITIAL_PROFILE_IDS,
) {
  const [requestedProviderTargetIds, setRequestedProviderTargetIds] = useState<Set<string>>(
    () => new Set(initialProviderTargetIds.flatMap(targetId => (targetId ? [targetId] : []))),
  )

  useEffect(() => {
    setRequestedProviderTargetIds((current) => {
      let changed = false
      const next = new Set(current)
      for (const targetId of initialProviderTargetIds) {
        if (targetId && !next.has(targetId)) {
          next.add(targetId)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [initialProviderTargetIds])

  const requestedTargets = useMemo(
    () => providerTargets.filter(target => requestedProviderTargetIds.has(target.id)),
    [providerTargets, requestedProviderTargetIds],
  )

  const queries = useQueries({
    queries: requestedTargets.map(target => ({
      queryKey: providerTargetModelsQueryKey(target),
      queryFn: () => fetchCachedVisibleModelsForProviderTarget(target),
      enabled: target.enabled,
      ...MODEL_INVENTORY_QUERY_OPTIONS,
    })),
  })

  const requestProviderTargetModels = useCallback((targetId: string) => {
    setRequestedProviderTargetIds((current) => {
      if (current.has(targetId)) {
        return current
      }
      const next = new Set(current)
      next.add(targetId)
      return next
    })
  }, [])

  const modelsByProviderTargetId: Record<string, ModelDescriptor[]> = {}
  const loadingProviderTargetIds = new Set<string>()
  const successfulProviderTargetIds = new Set<string>()

  requestedTargets.forEach((target, index) => {
    const query = queries[index]
    modelsByProviderTargetId[target.id] = ModelDescriptorListSchema.parse(
      query?.data,
    ) satisfies ModelDescriptor[]
    if (query?.isLoading || query?.isFetching) {
      loadingProviderTargetIds.add(target.id)
    }
    if (query?.isSuccess) {
      successfulProviderTargetIds.add(target.id)
    }
  })

  return {
    modelsByProviderTargetId,
    loadingProviderTargetIds,
    successfulProviderTargetIds,
    requestProviderTargetModels,
  }
}
