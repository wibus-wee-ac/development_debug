// Input: ipc proxy from @renderer/lib/ipc, thread-search normalizer, TanStack Query, debounced query string
// Output: useThreadSearch — React Query hook with 150ms debounce, returns ranked UI-safe ThreadSearchHit[]
// Position: Feature hook for search dialog; renderer-side view layer, no orchestration

import type { ThreadSearchHit } from '@main/ipc-types'
import { ipc } from '@renderer/lib/ipc'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { normalizeThreadSearchHits } from './thread-search-normalize'

const DEBOUNCE_MS = 150

export const threadSearchQueryKey = (
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
    queryFn: () =>
      ipc && trimmed
        ? ipc.search.searchThreads({
            query: trimmed,
            workspaceId: workspaceId ?? undefined,
          })
        : Promise.resolve([]),
    enabled: enabled && !!trimmed && !!ipc,
    staleTime: 5_000,
  })

  const isPending = enabled && trimmed.length > 0 && (isFetching || debouncedQuery !== query)

  return {
    hits: normalizeThreadSearchHits(data),
    isPending,
    hasQuery: trimmed.length > 0,
  }
}
