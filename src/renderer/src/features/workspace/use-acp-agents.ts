// Input: ipc proxy from @renderer/lib/ipc, TanStack Query
// Output: useInstalledAcpAgents hook — lists ACP agents with status='installed'
// Position: Data hook for ACP agent selection in the Composer

import { ipc } from '@renderer/lib/ipc'
import { useQuery } from '@tanstack/react-query'

export const ACP_AGENTS_QUERY_KEY = ['acp-agents'] as const

export function useInstalledAcpAgents() {
  const { data: agents = [] } = useQuery({
    queryKey: ACP_AGENTS_QUERY_KEY,
    queryFn: async () => {
      if (!ipc) return []
      const all = await ipc.acp.listInstalled()
      return all.filter(a => a.status === 'installed')
    },
  })

  return { agents }
}

