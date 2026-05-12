// Input: generated API SDK, TanStack Query
// Output: useAgents hook — lists, creates, updates, and deletes Agent identity entities
// Position: Data hook for Agent identity management in Settings and Chat flows

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { deleteAgentsById, getAgents, patchAgentsById, postAgents } from '~/api-gen/sdk.gen'
import type { Agent, CreateAgentInput, UpdateAgentInput } from '~/lib/types'

export const AGENTS_QUERY_KEY = ['agents'] as const

export function useAgents() {
  const queryClient = useQueryClient()

  const { data: agents = [], isLoading } = useQuery({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: async (): Promise<Agent[]> => {
      const { data } = await getAgents()
      return (data ?? []) as Agent[]
    },
  })

  const createAgent = useMutation({
    mutationFn: async (input: CreateAgentInput) => {
      const { data } = await postAgents({ body: input })
      return data as Agent
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  const updateAgent = useMutation({
    mutationFn: async ({ id, patch }: { id: string, patch: UpdateAgentInput }) => {
      const { data } = await patchAgentsById({ path: { id }, body: patch })
      return data as Agent
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  const removeAgent = useMutation({
    mutationFn: async (id: string) => {
      await deleteAgentsById({ path: { id } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  return {
    agents,
    isLoading,
    createAgent,
    updateAgent,
    removeAgent,
  }
}
