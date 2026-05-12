// Input: profile API and providers API, profileId
// Output: useAgentModels hook — fetches available models for a given agent profile
// Position: Data hook for model selection in the New Chat flow

import { useQuery } from '@tanstack/react-query'

import { getProfilesById, postProvidersModels } from '~/api-gen/sdk.gen'
import type { AgentProfile, ModelDescriptor } from '~/lib/types'

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
      return (data ?? []) as ModelDescriptor[]
    },
    staleTime: 60_000,
    retry: 2,
    retryDelay: 1000,
  })

  return { models, isLoading }
}
