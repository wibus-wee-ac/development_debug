// Input: ipc proxy from @renderer/lib/ipc, TanStack Query
// Output: useAgentProfiles hook — lists unified Agent Runtime profiles
// Position: Data hook for Agent Runtime profile selection in the New Chat flow

import type { AgentProfile } from '@main/ipc-types'
import { ipc } from '@renderer/lib/ipc'
import { useQuery } from '@tanstack/react-query'

export const AGENT_PROFILES_QUERY_KEY = ['agent-profiles'] as const

export function useAgentProfiles() {
  const { data: profiles = [], refetch } = useQuery({
    queryKey: AGENT_PROFILES_QUERY_KEY,
    queryFn: async (): Promise<AgentProfile[]> => {
      if (!ipc) {
        return []
      }
      return ipc.agentRuntime.listProfiles() as Promise<AgentProfile[]>
    },
  })

  return { profiles, refetch }
}
