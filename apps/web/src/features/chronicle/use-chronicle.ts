// Input: Generated Chronicle API SDK, React Query
// Output: React hooks for Chronicle config, status, timeline, memories
// Position: apps/web/src/features/chronicle/use-chronicle.ts

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getChronicleConfigOptions,
  getChronicleConfigQueryKey,
  getChronicleMemoriesOptions,
  getChronicleStatusOptions,
  getChronicleStatusQueryKey,
  getChronicleTimelineOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { putChronicleConfig } from '~/api-gen/sdk.gen'
import type { PutChronicleConfigData } from '~/api-gen/types.gen'

// ── Types ──

export interface ChronicleConfig {
  profileId: string
  modelId: string
  workspaceId: string
  enabled: boolean
  storageRoot: string
}

export interface ChronicleStatus {
  available: boolean
  running: boolean
  pid: number | null
  lastSummaryAt: number | null
  lastExitCode: number | null
  lastExitAt: number | null
  totalSummaries: number
  configuredModel: string | null
}

export interface TimelineEntry {
  id: string
  capturedAt: string
  displayId: number
  segmentDir: string
  framePath: string
  ocrText: string | null
}

export interface MemoryEntry {
  id: string
  type: '10min' | '6h'
  createdAt: string
  content: string
}

// ── Config ──

export const CHRONICLE_CONFIG_QUERY_KEY = getChronicleConfigQueryKey()

export function useChronicleConfig() {
  const queryClient = useQueryClient()

  const { data: config = null, isLoading: loading } = useQuery({
    ...getChronicleConfigOptions(),
    select: data => data as ChronicleConfig,
  })

  const { mutateAsync: updateConfig, isPending: saving } = useMutation<
    ChronicleConfig | null,
    Error,
    Partial<ChronicleConfig>
  >({
    mutationFn: async (updates) => {
      const current = queryClient.getQueryData<ChronicleConfig>(CHRONICLE_CONFIG_QUERY_KEY)
      if (!current) return null
      const next = { ...current, ...updates }
      await putChronicleConfig({
        body: next as unknown as PutChronicleConfigData['body'],
      })
      return next
    },
    onSuccess: (updated) => {
      if (updated) {
        queryClient.setQueryData(CHRONICLE_CONFIG_QUERY_KEY, updated)
      }
      // Refresh status after config change (daemon may start/stop)
      void queryClient.invalidateQueries({ queryKey: getChronicleStatusQueryKey() })
    },
  })

  return { config, loading, saving, updateConfig }
}

// ── Status ──

export function useChronicleStatus() {
  const { data: status = null, isLoading: loading, refetch } = useQuery({
    ...getChronicleStatusOptions(),
    select: data => data as ChronicleStatus,
    refetchInterval: 5_000,
  })

  return { status, loading, refetch }
}

// ── Timeline ──

export function useChronicleTimeline(limit = 50) {
  const { data: entries = [], isLoading: loading, refetch } = useQuery({
    ...getChronicleTimelineOptions({ query: { limit } }),
    select: data => (data ?? []) as TimelineEntry[],
  })

  return { entries, loading, refetch }
}

// ── Memories ──

export function useChronicleMemories(limit = 20) {
  const { data: entries = [], isLoading: loading, refetch } = useQuery({
    ...getChronicleMemoriesOptions({ query: { limit } }),
    select: data => (data ?? []) as MemoryEntry[],
  })

  return { entries, loading, refetch }
}
