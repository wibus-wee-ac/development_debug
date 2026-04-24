// Input: ipc.agentRuntime.listModels, profileId
// Output: useAgentModels hook — fetches available models for a given agent profile
// Position: Data hook for model selection in the New Chat flow

import type { ModelDescriptor } from '@main/ipc-types'
import { ipc } from '@renderer/lib/ipc'
import { useQuery } from '@tanstack/react-query'

export function useAgentModels(profileId: string | null) {
  const { data: models = [], isLoading } = useQuery({
    queryKey: ['agent-models', profileId] as const,
    enabled: profileId !== null,
    queryFn: async (): Promise<ModelDescriptor[]> => {
      if (!ipc || !profileId) {
        return []
      }
      return ipc.agentRuntime.listModels(profileId) as Promise<ModelDescriptor[]>
    },
    staleTime: 60_000,
    retry: 2,
    retryDelay: 1000,
  })

  return { models, isLoading }
}
