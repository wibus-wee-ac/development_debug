// Input: ipc proxy from @renderer/lib/ipc, TanStack Query
// Output: useCliAgents hook — lists configured CLI agents
// Position: Data hook for CLI agent selection in the Composer

import type { CliAgent } from '@main/ipc-types'
import { ipc } from '@renderer/lib/ipc'
import { useQuery } from '@tanstack/react-query'

export const CLI_AGENTS_QUERY_KEY = ['cli-agents'] as const

export function useCliAgents() {
  const { data: agents = [] } = useQuery({
    queryKey: CLI_AGENTS_QUERY_KEY,
    queryFn: async (): Promise<CliAgent[]> => {
      if (!ipc) {
        return []
      }
      return ipc.cli.listAgents() as Promise<CliAgent[]>
    },
  })

  return { agents }
}
