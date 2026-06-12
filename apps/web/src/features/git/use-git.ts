import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  getWorkspacesByIdGitBranchesOptions,
  getWorkspacesByIdGitBranchesQueryKey,
  getWorkspacesByIdGitDiffOptions,
  getWorkspacesByIdGitDiffQueryKey,
  getWorkspacesByIdGitGraphOptions,
  getWorkspacesByIdGitGraphQueryKey,
  getWorkspacesByIdGitRemotesOptions,
  getWorkspacesByIdGitRepositoriesOptions,
  getWorkspacesByIdGitRepositoriesQueryKey,
  getWorkspacesByIdGitStatusOptions,
  getWorkspacesByIdGitStatusQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

// ─── Re-export generated query key builders so callers don't import from api-gen ──

export { getWorkspacesByIdGitStatusQueryKey as gitStatusQueryKey }
export { getWorkspacesByIdGitRepositoriesQueryKey as gitRepositoriesQueryKey }
export { getWorkspacesByIdGitBranchesQueryKey as gitBranchesQueryKey }
export { getWorkspacesByIdGitGraphQueryKey as gitGraphQueryKey }
export { getWorkspacesByIdGitDiffQueryKey as gitDiffQueryKey }

// ─── Hooks ───────────────────────────────────────────────────────────────────

function gitRepositoryQuery(repositoryPath: string | null | undefined) {
  return repositoryPath ? { query: { repo: repositoryPath } } : {}
}

export function useGitRepositories(workspaceId: string | null | undefined) {
  return useQuery({
    ...getWorkspacesByIdGitRepositoriesOptions({ path: { id: workspaceId! } }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
  })
}

export function useGitStatus(
  workspaceId: string | null | undefined,
  repositoryPath?: string | null,
) {
  return useQuery({
    ...getWorkspacesByIdGitStatusOptions({
      path: { id: workspaceId! },
      ...gitRepositoryQuery(repositoryPath),
    }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
  })
}

export function useGitFileStatuses(
  workspaceId: string | null | undefined,
  repositoryPath?: string | null,
) {
  return useQuery({
    ...getWorkspacesByIdGitStatusOptions({
      path: { id: workspaceId! },
      ...gitRepositoryQuery(repositoryPath),
    }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
    select: data => data.files,
  })
}

export function useGitBranches(
  workspaceId: string | null | undefined,
  repositoryPath?: string | null,
) {
  return useQuery({
    ...getWorkspacesByIdGitBranchesOptions({
      path: { id: workspaceId! },
      ...gitRepositoryQuery(repositoryPath),
    }),
    ...queryRefreshPolicies.background,
    enabled: !!workspaceId,
    retry: false,
  })
}

export function useGitRemotes(
  workspaceId: string | null | undefined,
  repositoryPath?: string | null,
) {
  return useQuery({
    ...getWorkspacesByIdGitRemotesOptions({
      path: { id: workspaceId! },
      ...gitRepositoryQuery(repositoryPath),
    }),
    enabled: !!workspaceId,
    ...queryRefreshPolicies.background,
    retry: false,
  })
}

export function useGitGraph(
  workspaceId: string | null | undefined,
  limit: number = 100,
  repositoryPath?: string | null,
) {
  return useQuery({
    ...getWorkspacesByIdGitGraphOptions({
      path: { id: workspaceId! },
      query: {
        limit: String(limit),
        ...(repositoryPath ? { repo: repositoryPath } : {}),
      },
    }),
    ...queryRefreshPolicies.background,
    enabled: !!workspaceId,
    retry: false,
    placeholderData: keepPreviousData,
  })
}

export function useGitDiff(
  workspaceId: string | null | undefined,
  repositoryPath?: string | null,
  paths?: string[],
) {
  const pathsStr = paths?.length ? paths.join(',') : undefined
  return useQuery({
    ...getWorkspacesByIdGitDiffOptions({
      path: { id: workspaceId! },
      ...(repositoryPath || pathsStr
        ? {
            query: {
              ...(repositoryPath ? { repo: repositoryPath } : {}),
              ...(pathsStr ? { paths: pathsStr } : {}),
            },
          }
        : {}),
    }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
    select: data => (typeof data === 'string' ? data : ''),
  })
}
