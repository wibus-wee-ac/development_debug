import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { deleteProfilesById, getProfiles, putProfilesById } from '~/api-gen/sdk.gen'
import type { PutProfilesByIdData } from '~/api-gen/types.gen'
import type { AgentProfile } from '~/lib/types'

import { AGENT_MODELS_QUERY_KEY } from './use-agent-models'

const AGENT_PROFILES_QUERY_KEY = ['agent-profiles'] as const
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
const AgentProfileListSchema = z.array(AgentProfileSchema).default([])

export function useAgentProfiles() {
  const queryClient = useQueryClient()

  const { data: profiles = [], isLoading, isSuccess, refetch } = useQuery({
    queryKey: AGENT_PROFILES_QUERY_KEY,
    queryFn: async (): Promise<AgentProfile[]> => {
      const { data } = await getProfiles()
      return AgentProfileListSchema.parse(data) satisfies AgentProfile[]
    },
  })

  const updateProfile = useMutation({
    mutationFn: async ({ id, body }: { id: string, body: PutProfilesByIdData['body'] }) => {
      const { data } = await putProfilesById({
        path: { id },
        body,
      })
      return AgentProfileSchema.parse(data) satisfies AgentProfile
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
      return AgentProfileSchema.parse(data) satisfies AgentProfile
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
    isSuccess,
    refetch,
    createProfile,
    updateProfile,
    removeProfile,
  }
}
