// Input: generated API SDK, TanStack Query
// Output: useAgentProfiles hook — lists and mutates unified Agent Runtime profiles
// Position: Data hook for Agent Runtime profile selection in the New Chat flow

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { deleteProfilesById, getProfiles, putProfilesById } from '~/api-gen/sdk.gen'
import type { PutProfilesByIdData } from '~/api-gen/types.gen'
import type { AgentProfile } from '~/lib/types'

import { AGENT_MODELS_QUERY_KEY } from './use-agent-models'

const AGENT_PROFILES_QUERY_KEY = ['agent-profiles'] as const

export function useAgentProfiles() {
  const queryClient = useQueryClient()

  const { data: profiles = [], isLoading, refetch } = useQuery({
    queryKey: AGENT_PROFILES_QUERY_KEY,
    queryFn: async (): Promise<AgentProfile[]> => {
      const { data } = await getProfiles()
      return (data ?? []) as AgentProfile[]
    },
  })

  const updateProfile = useMutation({
    mutationFn: async ({ id, body }: { id: string, body: PutProfilesByIdData['body'] }) => {
      const { data } = await putProfilesById({
        path: { id },
        body,
      })
      return data as AgentProfile
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AGENT_PROFILES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY }),
      ])
    },
  })

  const createProfile = useMutation({
    mutationFn: async ({ id, body }: { id: string, body: PutProfilesByIdData['body'] }) => {
      const { data } = await putProfilesById({
        path: { id },
        body,
      })
      return data as AgentProfile
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AGENT_PROFILES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY }),
      ])
    },
  })

  const removeProfile = useMutation({
    mutationFn: async (id: string) => {
      await deleteProfilesById({ path: { id } })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AGENT_PROFILES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY }),
      ])
    },
  })

  return {
    profiles,
    isLoading,
    refetch,
    createProfile,
    updateProfile,
    removeProfile,
  }
}
