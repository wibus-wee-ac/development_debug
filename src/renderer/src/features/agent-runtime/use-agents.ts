// Input: ipc proxy from @renderer/lib/ipc, TanStack Query
// Output: useAgents hook — lists, creates, updates, and deletes Agent identity entities
// Position: Data hook for Agent identity management in Settings and Chat flows

import type { Agent, CreateAgentInput, UpdateAgentInput } from '@main/ipc-types'
import { ipc } from '@renderer/lib/ipc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export const AGENTS_QUERY_KEY = ['agents'] as const

export function useAgents() {
  const queryClient = useQueryClient()

  const { data: agents = [], isLoading } = useQuery({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: async (): Promise<Agent[]> => {
      if (!ipc) {
        return []
      }
      return ipc.agent.list() as Promise<Agent[]>
    },
  })

  const createAgent = useMutation({
    mutationFn: async (input: CreateAgentInput) => {
      if (!ipc) {
        throw new Error('IPC not available')
      }
      return ipc.agent.create(input) as Promise<Agent>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  const updateAgent = useMutation({
    mutationFn: async ({ id, patch }: { id: string, patch: UpdateAgentInput }) => {
      if (!ipc) {
        throw new Error('IPC not available')
      }
      return ipc.agent.update(id, patch) as Promise<Agent>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  const removeAgent = useMutation({
    mutationFn: async (id: string) => {
      if (!ipc) {
        throw new Error('IPC not available')
      }
      return ipc.agent.remove(id) as Promise<void>
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
