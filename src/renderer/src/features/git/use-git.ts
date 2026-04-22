// Input: ipc proxy from @renderer/lib/ipc, TanStack Query, git types from @main/ipc-types
// Output: useGitStatus / useGitBranches / useGitGraph hooks + query key builders for invalidation
// Position: Feature hooks for git panel and git branch control; renderer-side data layer

import type { GitBranches, GitGraphCommit, GitStatus } from '@main/ipc-types'
import { ipc } from '@renderer/lib/ipc'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

// ─── Query key builders ───────────────────────────────────────────────────────

export const gitStatusQueryKey = (workspacePath: string | null | undefined) =>
  ['git-status', workspacePath ?? null] as const

export const gitBranchesQueryKey = (workspacePath: string | null | undefined) =>
  ['git-branches', workspacePath ?? null] as const

export const gitGraphQueryKey = (workspacePath: string | null | undefined, limit: number) =>
  ['git-graph', workspacePath ?? null, limit] as const

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useGitStatus(workspacePath: string | null | undefined) {
  return useQuery<GitStatus>({
    queryKey: gitStatusQueryKey(workspacePath),
    queryFn: () => ipc!.git.getStatus(workspacePath!),
    enabled: !!workspacePath && !!ipc,
    staleTime: 10_000,
    retry: false,
  })
}

export function useGitBranches(workspacePath: string | null | undefined) {
  return useQuery<GitBranches>({
    queryKey: gitBranchesQueryKey(workspacePath),
    queryFn: () => ipc!.git.getBranches(workspacePath!),
    enabled: !!workspacePath && !!ipc,
    staleTime: 30_000,
    retry: false,
  })
}

export function useGitGraph(workspacePath: string | null | undefined, limit: number = 100) {
  return useQuery<GitGraphCommit[]>({
    queryKey: gitGraphQueryKey(workspacePath, limit),
    queryFn: () => ipc!.git.getGraph(workspacePath!, limit),
    enabled: !!workspacePath && !!ipc,
    staleTime: 30_000,
    retry: false,
    // Preserve previous data while a new limit-fetch is in flight so VList
    // doesn't lose its scroll position. The list visually stays the same
    // until the expanded data arrives.
    placeholderData: keepPreviousData,
  })
}
