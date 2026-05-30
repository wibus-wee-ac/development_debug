import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  getWorkspacesByIdGitBranchesOptions,
  getWorkspacesByIdGitBranchesQueryKey,
  getWorkspacesByIdGitDiffOptions,
  getWorkspacesByIdGitDiffQueryKey,
  getWorkspacesByIdGitGraphOptions,
  getWorkspacesByIdGitGraphQueryKey,
  getWorkspacesByIdGitRemotesOptions,
  getWorkspacesByIdGitStatusOptions,
  getWorkspacesByIdGitStatusQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

// ─── Re-export generated query key builders so callers don't import from api-gen ──

export { getWorkspacesByIdGitStatusQueryKey as gitStatusQueryKey }
export { getWorkspacesByIdGitBranchesQueryKey as gitBranchesQueryKey }
export { getWorkspacesByIdGitGraphQueryKey as gitGraphQueryKey }
export { getWorkspacesByIdGitDiffQueryKey as gitDiffQueryKey }

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useGitStatus(workspaceId: string | null | undefined) {
  return useQuery({
    ...getWorkspacesByIdGitStatusOptions({ path: { id: workspaceId! } }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
  })
}

export function useGitFileStatuses(workspaceId: string | null | undefined) {
  return useQuery({
    ...getWorkspacesByIdGitStatusOptions({ path: { id: workspaceId! } }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
    select: data => data.files,
  })
}

export function useGitBranches(workspaceId: string | null | undefined) {
  return useQuery({
    ...getWorkspacesByIdGitBranchesOptions({ path: { id: workspaceId! } }),
    ...queryRefreshPolicies.background,
    enabled: !!workspaceId,
    retry: false,
  })
}

export function useGitRemotes(workspaceId: string | null | undefined) {
  return useQuery({
    ...getWorkspacesByIdGitRemotesOptions({ path: { id: workspaceId! } }),
    enabled: !!workspaceId,
    ...queryRefreshPolicies.background,
    retry: false,
  })
}

export function useGitGraph(workspaceId: string | null | undefined, limit: number = 100) {
  return useQuery({
    ...getWorkspacesByIdGitGraphOptions({ path: { id: workspaceId! }, query: { limit: String(limit) } }),
    ...queryRefreshPolicies.background,
    enabled: !!workspaceId,
    retry: false,
    placeholderData: keepPreviousData,
  })
}

export function useGitDiff(workspaceId: string | null | undefined, paths?: string[]) {
  const pathsStr = paths?.length ? paths.join(',') : undefined
  return useQuery({
    ...getWorkspacesByIdGitDiffOptions({
      path: { id: workspaceId! },
      ...(pathsStr ? { query: { paths: pathsStr } } : {}),
    }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
    select: data => (typeof data === 'string' ? data : ''),
  })
}
