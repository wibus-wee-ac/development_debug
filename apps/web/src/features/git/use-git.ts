import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import {
  getWorkspacesByIdGitBranchesOptions,
  getWorkspacesByIdGitBranchesQueryKey,
  getWorkspacesByIdGitDiffOptions,
  getWorkspacesByIdGitDiffQueryKey,
  getWorkspacesByIdGitGraphOptions,
  getWorkspacesByIdGitGraphQueryKey,
  getWorkspacesByIdGitStatusOptions,
  getWorkspacesByIdGitStatusQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { client } from '~/lib/client.config'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'
import type { GitBranches, GitFileStatus, GitGraphCommit, GitStatus } from '~/lib/types'

interface GitRemote {
  name: string
  fetchUrl: string | null
  pushUrl: string | null
}

const GitStatusSchema = z.object({
  branch: z.string(),
  tracking: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  isDetached: z.boolean(),
  files: z.array(z.object({
    path: z.string(),
    status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked']),
  })).default([]),
})

const GitBranchesSchema = z.object({
  local: z.array(z.object({
    name: z.string(),
    isCurrent: z.boolean(),
    tracking: z.string().optional(),
  })),
  remote: z.array(z.object({
    name: z.string(),
  })),
})

const GitGraphCommitListSchema = z.array(z.object({
  sha: z.string(),
  shortSha: z.string(),
  parents: z.array(z.string()),
  refs: z.array(z.string()),
  subject: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  gravatarHash: z.string(),
  date: z.string(),
  timestamp: z.number(),
})).default([])

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
    select: data => GitStatusSchema.parse(data) satisfies GitStatus,
  })
}

export function useGitFileStatuses(workspaceId: string | null | undefined) {
  return useQuery({
    ...getWorkspacesByIdGitStatusOptions({ path: { id: workspaceId! } }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
    select: data => GitStatusSchema.parse(data).files satisfies GitFileStatus[],
  })
}

export function useGitBranches(workspaceId: string | null | undefined) {
  return useQuery({
    ...getWorkspacesByIdGitBranchesOptions({ path: { id: workspaceId! } }),
    ...queryRefreshPolicies.background,
    enabled: !!workspaceId,
    retry: false,
    select: data => GitBranchesSchema.parse(data) satisfies GitBranches,
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
    select: data => GitGraphCommitListSchema.parse(data) satisfies GitGraphCommit[],
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
