import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  getWorkspacesByIdFilesSearchOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { getWorkspacesByIdFilesSearch } from '~/api-gen/sdk.gen'
import type { GetWorkspacesByIdFilesSearchResponse } from '~/api-gen/types.gen'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

export type WorkspaceFile = GetWorkspacesByIdFilesSearchResponse[number]
const WORKSPACE_FILE_SEARCH_DEBOUNCE_MS = 120

export async function searchWorkspaceFiles(input: {
  workspaceId: string
  query?: string
  limit?: number
  signal?: AbortSignal
}): Promise<WorkspaceFile[]> {
  const { data } = await getWorkspacesByIdFilesSearch({
    path: { id: input.workspaceId },
    query: {
      ...(input.query ? { q: input.query } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
    },
    signal: input.signal,
    throwOnError: true,
  })
  return data
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
    ...getWorkspacesByIdFilesSearchOptions({
      path: { id: workspaceId! },
      query: {
        ...(query ? { q: query } : {}),
        limit,
      },
    }),
    enabled: enabled && !!workspaceId,
    ...queryRefreshPolicies.static,
  })

  return { files, isPending: enabled && (rawQuery !== query || isFetching) }
}
