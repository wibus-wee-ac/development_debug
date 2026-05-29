import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { getServerUrl } from '~/lib/electron'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

export type WorkspaceFile = { type: 'file' | 'directory', name: string, path: string }
const WorkspaceFileListSchema = z.array(z.object({
  type: z.enum(['file', 'directory']),
  name: z.string(),
  path: z.string(),
})).default([])

export async function searchWorkspaceFiles(input: {
  workspaceId: string
  query?: string
  limit?: number
}): Promise<WorkspaceFile[]> {
  const url = new URL(`/workspaces/${encodeURIComponent(input.workspaceId)}/files/search`, getServerUrl())
  if (input.query) {
    url.searchParams.set('q', input.query)
  }
  if (input.limit) {
    url.searchParams.set('limit', String(input.limit))
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Workspace file search request failed with status ${response.status}.`)
  }
  return WorkspaceFileListSchema.parse(await response.json()) satisfies WorkspaceFile[]
}

export function useWorkspaceFiles(workspaceId: string | null, input: { query?: string, limit?: number, enabled?: boolean } = {}) {
  const query = input.query ?? ''
  const limit = input.limit ?? 30
  const enabled = input.enabled ?? true
  const { data: files = [] } = useQuery({
    queryKey: ['workspace-file-search', workspaceId, query, limit],
    queryFn: () => searchWorkspaceFiles({ workspaceId: workspaceId!, query, limit }),
    enabled: enabled && !!workspaceId,
    ...queryRefreshPolicies.active,
  })

  return { files }
}
