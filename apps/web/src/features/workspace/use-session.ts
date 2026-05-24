import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { getSessions } from '~/api-gen/sdk.gen'
import type { RuntimeKind } from '~/lib/types'

export interface WorkspaceSession {
  id: string
  workspaceId: string | null
  title: string | null
  providerTargetId: string | null
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

export const RuntimeKindSchema = z.enum(['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui'])
export const WorkspaceSessionListSchema = z.array(z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  title: z.string().nullable(),
  providerTargetId: z.string().nullable(),
  agentId: z.string().nullable(),
  modelId: z.string().nullable(),
  linkedIssueId: z.string().nullable(),
  runtimeKind: RuntimeKindSchema,
  pinned: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
})).default([])

export function useSessions(workspaceId: string | null) {
  const { data: sessions = [], isPending: loading } = useQuery({
    queryKey: sessionsQueryKey(workspaceId),
    queryFn: async () => {
      const { data } = await getSessions({ query: { workspaceId: workspaceId! } })
      return WorkspaceSessionListSchema.parse(data) satisfies WorkspaceSession[]
    },
    enabled: !!workspaceId,
  })

  return { sessions, loading }
}
