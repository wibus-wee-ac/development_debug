import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  getWorkspacesByIdGitBranchesOptions,
  getWorkspacesByIdGitBranchesQueryKey,
  getWorkspacesByIdGitGraphOptions,
  getWorkspacesByIdGitGraphQueryKey,
  getWorkspacesByIdGitStatusOptions,
  getWorkspacesByIdGitStatusQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { client } from '~/lib/client.config'
import type { GitBranches, GitGraphCommit, GitStatus } from '~/lib/types'

interface GitRemote {
  name: string
  fetchUrl: string | null
  pushUrl: string | null
}

// ─── Re-export generated query key builders so callers don't import from api-gen ──

export { getWorkspacesByIdGitStatusQueryKey as gitStatusQueryKey }
export { getWorkspacesByIdGitBranchesQueryKey as gitBranchesQueryKey }
export { getWorkspacesByIdGitGraphQueryKey as gitGraphQueryKey }

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useGitStatus(workspaceId: string | null | undefined) {
  return useQuery({
    ...getWorkspacesByIdGitStatusOptions({ path: { id: workspaceId! } }),
    enabled: !!workspaceId,
    staleTime: 10_000,
    retry: false,
    select: data => data as GitStatus,
  })
}

export function useGitBranches(workspaceId: string | null | undefined) {
  return useQuery({
    ...getWorkspacesByIdGitBranchesOptions({ path: { id: workspaceId! } }),
    enabled: !!workspaceId,
    staleTime: 30_000,
    retry: false,
    select: data => data as GitBranches,
  })
}

export function useGitRemotes(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: ['git-remotes', workspaceId] as const,
    queryFn: async () => {
      const { data } = await client.get<{ 200: GitRemote[] }, unknown, true>({
        url: '/workspaces/{id}/git/remotes',
        path: { id: workspaceId! },
        throwOnError: true,
      })
      return data
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
    retry: false,
  })
}

export function useGitGraph(workspaceId: string | null | undefined, limit: number = 100) {
  return useQuery({
    ...getWorkspacesByIdGitGraphOptions({ path: { id: workspaceId! }, query: { limit: String(limit) } }),
    enabled: !!workspaceId,
    staleTime: 30_000,
    retry: false,
    placeholderData: keepPreviousData,
    select: data => (data ?? []) as GitGraphCommit[],
  })
}
