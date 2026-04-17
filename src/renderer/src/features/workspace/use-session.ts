// Input: ipc proxy from @renderer/lib/ipc, TanStack Query
// Output: useSessions hook
// Position: Data-fetching hooks for session feature under workspace

import { ipc } from '@renderer/lib/ipc'
import { useQuery } from '@tanstack/react-query'

export const sessionsQueryKey = (workspaceId: string | null) =>
  ['sessions', workspaceId] as const

export function useSessions(workspaceId: string | null) {
  const { data: sessions = [], isPending: loading } = useQuery({
    queryKey: sessionsQueryKey(workspaceId),
    queryFn: () => ipc && workspaceId ? ipc.session.list(workspaceId) : Promise.resolve([]),
    enabled: !!workspaceId,
  })

  return { sessions, loading }
}
