// Input: generated API SDK, TanStack Query
// Output: useAgentProfiles hook — lists unified Agent Runtime profiles
// Position: Data hook for Agent Runtime profile selection in the New Chat flow

import { useQuery } from '@tanstack/react-query'

import { getProfiles } from '~/api-gen/sdk.gen'
import type { AgentProfile } from '~/lib/types'

const AGENT_PROFILES_QUERY_KEY = ['agent-profiles'] as const

export function useAgentProfiles() {
  const { data: profiles = [], refetch } = useQuery({
    queryKey: AGENT_PROFILES_QUERY_KEY,
    queryFn: async (): Promise<AgentProfile[]> => {
      const { data } = await getProfiles()
      return (data ?? []) as AgentProfile[]
    },
  })

  return { profiles, refetch }
}
