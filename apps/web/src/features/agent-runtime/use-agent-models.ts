// Input: profile API and providers API, profileId
// Output: useAgentModels hook — fetches available models for a given agent profile
// Position: Data hook for model selection in the New Chat flow

import { useQuery } from '@tanstack/react-query'

import { getProfilesById, postProvidersModels } from '~/api-gen/sdk.gen'
import { ALL_DISABLED_SENTINEL } from '~/features/agent-management/agent-runtime-settings'
import type { AgentProfile, ModelDescriptor } from '~/lib/types'

const ALL_DISABLED = ALL_DISABLED_SENTINEL

export function useAgentModels(profileId: string | null) {
  const { data: models = [], isLoading } = useQuery({
    queryKey: ['agent-models', profileId] as const,
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
      const config = (() => {
        try {
          return JSON.parse(profile.configJson)
        }
        catch {
          return {}
        }
      })()
      const { data } = await postProvidersModels({
        body: {
          providerKind: profile.providerKind,
          label: profile.name,
          config,
          secretRef: profile.credentialRef ?? null,
          profileId: profile.id,
        },
      })
      const allModels = (data ?? []) as ModelDescriptor[]

      // Apply enabledModels filter from profile config
      const enabledModels: string[] = Array.isArray(config.enabledModels) ? config.enabledModels : []
      if (enabledModels.length === 0) {
        return allModels
      }
      if (enabledModels.length === 1 && enabledModels[0] === ALL_DISABLED) {
        return []
      }
      const enabledSet = new Set(enabledModels)
      return allModels.filter(m => enabledSet.has(m.id))
    },
    staleTime: 60_000,
    retry: 2,
    retryDelay: 1000,
  })

  return { models, isLoading }
}
