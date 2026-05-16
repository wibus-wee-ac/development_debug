// Input: generated API SDK, TanStack Query
// Output: useSessions hook
// Position: Data-fetching hooks for session feature under workspace

import { useQuery } from '@tanstack/react-query'

import { getSessions } from '~/api-gen/sdk.gen'
import type { RuntimeKind } from '~/lib/types'

export interface WorkspaceSession {
  id: string
  workspaceId: string | null
  title: string | null
  agentProfileId: string | null
  agentId: string | null
  modelId: string | null
  linkedIssueId: string | null
  runtimeKind: RuntimeKind
  pinned: number
  createdAt: number
  updatedAt: number
}

export const sessionsQueryKey = (workspaceId: string | null) =>
  ['sessions', workspaceId] as const

export function useSessions(workspaceId: string | null) {
  const { data: sessions = [], isPending: loading } = useQuery({
    queryKey: sessionsQueryKey(workspaceId),
    queryFn: async () => {
      const { data } = await getSessions({ query: { workspaceId: workspaceId! } })
      return (data ?? []) as WorkspaceSession[]
    },
    enabled: !!workspaceId,
  })

  return { sessions, loading }
}
