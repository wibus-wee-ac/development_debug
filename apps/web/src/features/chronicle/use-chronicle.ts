// Input: Chronicle API responses
// Output: React Query hooks for Settings > Chronicle
// Position: apps/web/src/features/chronicle/use-chronicle.ts

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getChronicleConfigOptions,
  getChronicleConfigQueryKey,
  getChronicleMemoriesOptions,
  getChronicleMemoriesQueryKey,
  getChronicleStatusOptions,
  getChronicleStatusQueryKey,
  getChronicleTimelineOptions,
  getChronicleTimelineQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { postSecrets, putChronicleConfig } from '~/api-gen/sdk.gen'
import type { PutChronicleConfigData } from '~/api-gen/types.gen'
import { getServerUrl } from '~/lib/electron'

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
  lastCaptureAt: number | null
  lastSummaryAt: number | null
  lastErrorAt: number | null
  lastError: string | null
  lastExitCode: number | null
  lastExitAt: number | null
  totalSnapshots: number
  totalSummaries: number
  totalMessages: number
  lastMessageAt: number | null
  configuredModel: string | null
}

export type ChronicleModelResourceCategory = 'ocr' | 'audio-vad' | 'audio-asr' | 'speaker' | 'embedding'
export type ChronicleModelResourceState = 'available' | 'missing' | 'optional' | 'installing' | 'error'

interface ChronicleModelResourceEntry {
  id: string
  category: ChronicleModelResourceCategory
  status: 'available' | 'missing' | 'installing' | 'installed' | 'error'
  displayName: string
  path: string | null
  version: string | null
  message: string | null
  sizeBytes: number | null
  metadata: Record<string, unknown>
  updatedAt: number
}

export interface ChronicleModelResource {
  category: ChronicleModelResourceCategory
  label: string
  state: ChronicleModelResourceState
  required: boolean
  provider: string | null
  path: string | null
  version: string | null
  sizeBytes: number | null
  message: string | null
  metadata: Record<string, unknown> | null
  updatedAt: number | null
}

export interface ChronicleModelResourceInstallDraft {
  category: ChronicleModelResourceCategory
  source?: 'manifest' | 'local-files'
  files?: Array<{
    relativePath: string
    sourcePath: string
  }>
}

export interface TimelineEntry {
  id: string
  sourceType: 'snapshot' | 'message'
  capturedAt: string
  capturedAtUnix: number
  displayId: number
  segmentDir: string
  framePath: string
  ocrText: string | null
  appBundleId: string | null
  windowTitle: string | null
  platform?: string | null
  channelId?: string | null
  channelName?: string | null
  userName?: string | null
}

export interface MemoryEntry {
  id: string
  type: '10min' | '6h'
  source: 'llm' | 'local' | 'imported'
  createdAt: string
  createdAtUnix: number
  content: string
  modelId: string | null
  title?: string | null
  sourceCount?: number | null
}

export interface ChronicleMessageSource {
  id: string
  platform: 'slack'
  label: string
  enabled: boolean
  workspaceId: string | null
  teamId: string | null
  botTokenRef: string | null
  channelIds: string[]
  status: 'idle' | 'syncing' | 'ready' | 'error' | 'disabled'
  lastSyncAt: number | null
  lastMessageAt: number | null
  lastError: string | null
}

export interface ChronicleSlackSourceDraft {
  label: string
  token: string
  channelIds: string
  enabled: boolean
}

export interface ChronicleSlackSyncResult {
  sourceId: string
  status: 'success' | 'error'
  ingested: number
  message: string
}

const CHRONICLE_MODEL_RESOURCE_DEFAULTS: ChronicleModelResource[] = [
  {
    category: 'ocr',
    label: 'OCR',
    state: 'available',
    required: true,
    provider: 'macOS Vision',
    path: null,
    version: 'macos-vision',
    sizeBytes: null,
    message: 'Screen text extraction is available through the local macOS runtime.',
    metadata: null,
    updatedAt: null,
  },
  {
    category: 'audio-vad',
    label: 'Audio VAD',
    state: 'optional',
    required: false,
    provider: null,
    path: null,
    version: null,
    sizeBytes: null,
    message: 'Optional audio activity detection resource is not installed.',
    metadata: null,
    updatedAt: null,
  },
  {
    category: 'audio-asr',
    label: 'Audio ASR',
    state: 'optional',
    required: false,
    provider: null,
    path: null,
    version: null,
    sizeBytes: null,
    message: 'Optional local speech transcription resource is not installed.',
    metadata: null,
    updatedAt: null,
  },
  {
    category: 'speaker',
    label: 'Speaker',
    state: 'optional',
    required: false,
    provider: null,
    path: null,
    version: null,
    sizeBytes: null,
    message: 'Optional speaker embedding resource is not installed.',
    metadata: null,
    updatedAt: null,
  },
  {
    category: 'embedding',
    label: 'Embedding',
    state: 'optional',
    required: false,
    provider: null,
    path: null,
    version: null,
    sizeBytes: null,
    message: 'Optional local text embedding resource is not installed.',
    metadata: null,
    updatedAt: null,
  },
]

const CHRONICLE_RESOURCE_LABELS: Record<ChronicleModelResourceCategory, string> = {
  'ocr': 'OCR',
  'audio-vad': 'Audio VAD',
  'audio-asr': 'Audio ASR',
  'speaker': 'Speaker',
  'embedding': 'Embedding',
}

const CHRONICLE_RESOURCE_CATEGORIES = new Set<ChronicleModelResourceCategory>([
  'ocr',
  'audio-vad',
  'audio-asr',
  'speaker',
  'embedding',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toResourceState(
  status: ChronicleModelResourceEntry['status'],
  required: boolean,
): ChronicleModelResourceState {
  if (status === 'installing') {
    return 'installing'
  }
  if (status === 'error') {
    return 'error'
  }
  if (status === 'missing') {
    return required ? 'missing' : 'optional'
  }
  return 'available'
}

function normalizeModelResource(entry: ChronicleModelResourceEntry): ChronicleModelResource {
  const metadata = isRecord(entry.metadata) ? entry.metadata : {}
  const manifest = isRecord(metadata.manifest) ? metadata.manifest : null
  const required = entry.category === 'ocr' || (manifest?.required === true)
  const provider = readString(metadata.provider) ?? readString(manifest?.runtime)

  return {
    category: entry.category,
    label: readString(entry.displayName) ?? CHRONICLE_RESOURCE_LABELS[entry.category],
    state: toResourceState(entry.status, required),
    required,
    provider,
    path: entry.path ?? null,
    version: entry.version ?? null,
    sizeBytes: entry.sizeBytes ?? null,
    message: entry.message ?? null,
    metadata,
    updatedAt: entry.updatedAt ?? null,
  }
}

function normalizeModelResources(data: unknown): ChronicleModelResource[] {
  if (!Array.isArray(data)) {
    return CHRONICLE_MODEL_RESOURCE_DEFAULTS
  }

  const byCategory = new Map<ChronicleModelResourceCategory, ChronicleModelResource>()
  for (const resource of CHRONICLE_MODEL_RESOURCE_DEFAULTS) {
    byCategory.set(resource.category, resource)
  }

  for (const raw of data as ChronicleModelResourceEntry[]) {
    if (!CHRONICLE_RESOURCE_CATEGORIES.has(raw.category)) {
      continue
    }
    byCategory.set(raw.category, normalizeModelResource(raw))
  }

  return Array.from(byCategory.values())
}

function normalizeMessageSources(data: unknown): ChronicleMessageSource[] {
  return Array.isArray(data) ? (data as ChronicleMessageSource[]) : []
}

async function fetchChronicleJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getServerUrl()}${path}`, init)
  if (!response.ok) {
    throw new Error(`Chronicle request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export const CHRONICLE_CONFIG_QUERY_KEY = getChronicleConfigQueryKey()
const CHRONICLE_MODEL_RESOURCES_QUERY_KEY = ['chronicle', 'model-resources'] as const
const CHRONICLE_MESSAGE_SOURCES_QUERY_KEY = ['chronicle', 'message-sources'] as const
const CHRONICLE_TIMELINE_QUERY_KEY = getChronicleTimelineQueryKey()
const CHRONICLE_MEMORIES_QUERY_KEY = getChronicleMemoriesQueryKey()
const CHANNEL_ID_SPLIT_RE = /[\s,]+/

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
      if (!current) {
        return null
      }
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
      void queryClient.invalidateQueries({ queryKey: getChronicleStatusQueryKey() })
      void queryClient.invalidateQueries({ queryKey: CHRONICLE_MODEL_RESOURCES_QUERY_KEY })
    },
  })

  return { config, loading, saving, updateConfig }
}

export function useChronicleStatus() {
  const { data: status = null, isLoading: loading, refetch } = useQuery({
    ...getChronicleStatusOptions(),
    select: data => data as ChronicleStatus,
    refetchInterval: 5_000,
  })

  return { status, loading, refetch }
}

export function useChronicleModelResources() {
  const { data: resources = CHRONICLE_MODEL_RESOURCE_DEFAULTS, isLoading: loading, refetch } = useQuery({
    queryKey: CHRONICLE_MODEL_RESOURCES_QUERY_KEY,
    queryFn: () => fetchChronicleJson<ChronicleModelResourceEntry[]>('/chronicle/model-resources'),
    select: normalizeModelResources,
    refetchInterval: 10_000,
  })

  return { resources, loading, refetch }
}

export function useChronicleModelResourceActions() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MODEL_RESOURCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: getChronicleStatusQueryKey() })
  }

  const { mutateAsync: reconcileResources, isPending: reconciling } = useMutation({
    mutationFn: async () => {
      const data = await fetchChronicleJson<ChronicleModelResourceEntry[]>('/chronicle/model-resources/reconcile', {
        method: 'POST',
      })
      return normalizeModelResources(data)
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: verifyResource, isPending: verifying } = useMutation({
    mutationFn: async (category: ChronicleModelResourceCategory) => {
      const data = await fetchChronicleJson<ChronicleModelResourceEntry>(
        `/chronicle/model-resources/${encodeURIComponent(category)}/verify`,
        { method: 'POST' },
      )
      return normalizeModelResource(data)
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: installResource, isPending: installing } = useMutation({
    mutationFn: async (draft: ChronicleModelResourceInstallDraft) => {
      const hasFiles = (draft.files?.length ?? 0) > 0
      const payload = {
        source: draft.source ?? (hasFiles ? 'local-files' : 'manifest'),
        files: draft.files ?? [],
      }
      const data = await fetchChronicleJson<ChronicleModelResourceEntry>(
        `/chronicle/model-resources/${encodeURIComponent(draft.category)}/install`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      return normalizeModelResource(data)
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: removeResource, isPending: removing } = useMutation({
    mutationFn: async (category: ChronicleModelResourceCategory) => {
      const data = await fetchChronicleJson<ChronicleModelResourceEntry>(
        `/chronicle/model-resources/${encodeURIComponent(category)}`,
        { method: 'DELETE' },
      )
      return normalizeModelResource(data)
    },
    onSuccess: invalidate,
  })

  return {
    reconcileResources,
    verifyResource,
    installResource,
    removeResource,
    reconciling,
    verifying,
    installing,
    removing,
  }
}

export function useChronicleMessageSources() {
  const { data: sources = [], isLoading: loading, refetch } = useQuery({
    queryKey: CHRONICLE_MESSAGE_SOURCES_QUERY_KEY,
    queryFn: () => fetchChronicleJson<ChronicleMessageSource[]>('/chronicle/message-sources'),
    select: normalizeMessageSources,
    refetchInterval: 10_000,
  })

  return { sources, loading, refetch }
}

export function useChronicleSlackSourceActions() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MESSAGE_SOURCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: getChronicleStatusQueryKey() })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_TIMELINE_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MEMORIES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: ['chronicle', 'memories', 'search'] })
  }

  const { mutateAsync: saveSource, isPending: saving } = useMutation({
    mutationFn: async (draft: ChronicleSlackSourceDraft) => {
      const channelIds = draft.channelIds
        .split(CHANNEL_ID_SPLIT_RE)
        .map(channelId => channelId.trim())
        .filter(Boolean)
      const { data: secret } = await postSecrets({
        body: {
          kind: 'chronicle.slack.bot-token',
          label: draft.label,
          secret: draft.token,
        },
      })
      const secretId = isRecord(secret) ? readString(secret.id) : null
      if (!secretId) {
        throw new Error('Slack token secret was not saved')
      }
      return fetchChronicleJson<ChronicleMessageSource>('/chronicle/message-sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'slack',
          label: draft.label,
          enabled: draft.enabled,
          botTokenRef: secretId,
          channelIds,
        }),
      })
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: syncSource, isPending: syncing } = useMutation({
    mutationFn: async (sourceId: string) => {
      return fetchChronicleJson<ChronicleSlackSyncResult>(
        `/chronicle/message-sources/${encodeURIComponent(sourceId)}/sync`,
        { method: 'POST' },
      )
    },
    onSuccess: invalidate,
  })

  return { saveSource, syncSource, saving, syncing }
}

export function useChronicleTimeline(limit = 50) {
  const { data: entries = [], isLoading: loading, refetch } = useQuery({
    ...getChronicleTimelineOptions({ query: { limit } }),
    select: data => data as TimelineEntry[],
    refetchInterval: 10_000,
  })

  return { entries, loading, refetch }
}

export function useChronicleMemories(limit = 20) {
  const { data: entries = [], isLoading: loading, refetch } = useQuery({
    ...getChronicleMemoriesOptions({ query: { limit } }),
    select: data => data as MemoryEntry[],
    refetchInterval: 15_000,
  })

  return { entries, loading, refetch }
}

export function useChronicleMemorySearch(query: string, limit = 20) {
  const normalizedQuery = query.trim()

  const { data: entries = [], isLoading: loading, isFetching, refetch } = useQuery({
    queryKey: ['chronicle', 'memories', 'search', normalizedQuery, limit],
    queryFn: () => fetchChronicleJson<MemoryEntry[]>(
      `/chronicle/memories/search?q=${encodeURIComponent(normalizedQuery)}&limit=${limit}`,
    ),
    enabled: normalizedQuery.length > 0,
  })

  return {
    entries,
    loading,
    searching: isFetching,
    hasQuery: normalizedQuery.length > 0,
    refetch,
  }
}

export function useRefreshChronicleQueries() {
  const queryClient = useQueryClient()

  return () => {
    void queryClient.invalidateQueries({ queryKey: getChronicleConfigQueryKey() })
    void queryClient.invalidateQueries({ queryKey: getChronicleStatusQueryKey() })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MODEL_RESOURCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MESSAGE_SOURCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_TIMELINE_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MEMORIES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: ['chronicle', 'memories', 'search'] })
  }
}
