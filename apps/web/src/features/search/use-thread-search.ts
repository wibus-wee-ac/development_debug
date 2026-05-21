import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { getSearchThreads } from '~/api-gen/sdk.gen'
import type { ThreadSearchHit } from '~/lib/types'

import { normalizeThreadSearchHits } from './thread-search-normalize'

const DEBOUNCE_MS = 150

const threadSearchQueryKey = (
  query: string,
  workspaceId?: string | null,
) => ['thread-search', workspaceId ?? null, query] as const

interface UseThreadSearchOptions {
  query: string
  /** Scope search to a single workspace. Omit for global. */
  workspaceId?: string | null
  /** Disable the query (e.g. dialog closed). */
  enabled?: boolean
}

export function useThreadSearch({
  query,
  workspaceId,
  enabled = true,
}: UseThreadSearchOptions) {
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const timer = setTimeout(setDebouncedQuery, DEBOUNCE_MS, query)
    return () => clearTimeout(timer)
  }, [query])

  const trimmed = debouncedQuery.trim()

  const { data = [], isFetching } = useQuery<ThreadSearchHit[]>({
    queryKey: threadSearchQueryKey(trimmed, workspaceId ?? null),
    queryFn: async () => {
      if (!trimmed) {
        return []
      }
      const { data: result } = await getSearchThreads({
        query: { query: trimmed, workspaceId: workspaceId ?? undefined },
      })
      return (result ?? []) as ThreadSearchHit[]
    },
    enabled: enabled && !!trimmed,
    staleTime: 5_000,
  })

  const isPending = enabled && trimmed.length > 0 && (isFetching || debouncedQuery !== query)

  return {
    hits: normalizeThreadSearchHits(data),
    isPending,
    hasQuery: trimmed.length > 0,
  }
}
