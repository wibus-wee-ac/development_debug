// Input: generated API SDK, generated queryOptions helpers, TanStack Query, git types
// Output: useGitStatus / useGitBranches / useGitGraph hooks + query key builders for invalidation
// Position: Feature hooks for git panel and git branch control; renderer-side data layer

import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  getWorkspacesByIdGitBranchesOptions,
  getWorkspacesByIdGitBranchesQueryKey,
  getWorkspacesByIdGitGraphOptions,
  getWorkspacesByIdGitGraphQueryKey,
  getWorkspacesByIdGitStatusOptions,
  getWorkspacesByIdGitStatusQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GitBranches, GitGraphCommit, GitStatus } from '~/lib/types'

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
