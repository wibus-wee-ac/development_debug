import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { z } from 'zod'

import { getServerUrl } from '~/lib/electron'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

export type WorkspaceFile = { type: 'file' | 'directory', name: string, path: string }
const WORKSPACE_FILE_SEARCH_DEBOUNCE_MS = 120
const WorkspaceFileListSchema = z.array(z.object({
  type: z.enum(['file', 'directory']),
  name: z.string(),
  path: z.string(),
})).default([])

export async function searchWorkspaceFiles(input: {
  workspaceId: string
  query?: string
  limit?: number
  signal?: AbortSignal
}): Promise<WorkspaceFile[]> {
  const url = new URL(`/workspaces/${encodeURIComponent(input.workspaceId)}/files/search`, getServerUrl())
  if (input.query) {
    url.searchParams.set('q', input.query)
  }
  if (input.limit) {
    url.searchParams.set('limit', String(input.limit))
  }

  const response = await fetch(url, { signal: input.signal })
  if (!response.ok) {
    throw new Error(`Workspace file search request failed with status ${response.status}.`)
  }
  return WorkspaceFileListSchema.parse(await response.json()) satisfies WorkspaceFile[]
}

export function useWorkspaceFiles(workspaceId: string | null, input: { query?: string, limit?: number, enabled?: boolean } = {}) {
  const rawQuery = input.query ?? ''
  const limit = input.limit ?? 30
  const enabled = input.enabled ?? true
  const [query, setQuery] = useState(rawQuery)

  useEffect(() => {
    const timer = window.setTimeout(setQuery, WORKSPACE_FILE_SEARCH_DEBOUNCE_MS, rawQuery)
    return () => window.clearTimeout(timer)
  }, [rawQuery])

  const { data: files = [], isFetching } = useQuery({
    queryKey: ['workspace-file-search', workspaceId, query, limit],
    queryFn: ({ signal }) => searchWorkspaceFiles({ workspaceId: workspaceId!, query, limit, signal }),
    enabled: enabled && !!workspaceId,
    ...queryRefreshPolicies.static,
  })

  return { files, isPending: enabled && (rawQuery !== query || isFetching) }
}
