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
  lastSummaryAt: number | string | null
  lastMessageAt: number | string | null
  lastExitCode: number | null
  lastExitAt: number | string | null
  totalSummaries: number
  totalMessages: number
  configuredModel: string | null
}

export type ChronicleModelResourceCategory = 'ocr' | 'audio-vad' | 'audio-asr' | 'speaker' | 'embedding'
export type ChronicleModelResourceState = 'available' | 'missing' | 'optional' | 'installing' | 'error'

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
  updatedAt: string | number | null
}

export interface ChronicleModelResourceInstallDraft {
  category: ChronicleModelResourceCategory
  sourcePath?: string | null
  sourceUrl?: string | null
}

export interface TimelineEntry {
  id: string
  sourceType: 'snapshot' | 'message'
  capturedAt: string
  displayId: number
  segmentDir: string
  framePath: string
  ocrText: string | null
  appName: string | null
  windowTitle: string | null
  platform: string | null
  channelId: string | null
  channelName: string | null
  userName: string | null
}

export interface MemoryEntry {
  id: string
  type: '10min' | '6h'
  createdAt: string
  content: string
  title: string | null
  sourceCount: number | null
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
  lastSyncAt: number | string | null
  lastMessageAt: number | string | null
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

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(item => typeof item === 'string' && item.length > 0)
}

function readResourceCategory(value: unknown): ChronicleModelResourceCategory | null {
  if (typeof value !== 'string') {
    return null
  }
  return CHRONICLE_RESOURCE_CATEGORIES.has(value as ChronicleModelResourceCategory)
    ? value as ChronicleModelResourceCategory
    : null
}

function readResourceState(value: unknown): ChronicleModelResourceState {
  if (value === 'available' || value === 'installed' || value === 'ready') {
    return 'available'
  }
  if (value === 'installing' || value === 'downloading') {
    return 'installing'
  }
  if (value === 'error' || value === 'failed') {
    return 'error'
  }
  if (value === 'optional') {
    return 'optional'
  }
  return 'missing'
}

function normalizeTimelineEntry(value: unknown): TimelineEntry | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value.id)
  const capturedAt = readString(value.capturedAt) ?? readString(value.captured_at)
  if (!id || !capturedAt) {
    return null
  }

  return {
    id,
    sourceType: value.sourceType === 'message' || value.source_type === 'message' ? 'message' : 'snapshot',
    capturedAt,
    displayId: readNumber(value.displayId) ?? readNumber(value.display_id) ?? 0,
    segmentDir: readString(value.segmentDir) ?? readString(value.segment_dir) ?? '',
    framePath: readString(value.framePath) ?? readString(value.frame_path) ?? readString(value.artifactPath) ?? '',
    ocrText: readString(value.ocrText) ?? readString(value.ocr_text),
    appName: readString(value.appName) ?? readString(value.app_name) ?? readString(value.platform),
    windowTitle: readString(value.windowTitle) ?? readString(value.window_title),
    platform: readString(value.platform),
    channelId: readString(value.channelId) ?? readString(value.channel_id),
    channelName: readString(value.channelName) ?? readString(value.channel_name),
    userName: readString(value.userName) ?? readString(value.user_name),
  }
}

function normalizeStatus(data: unknown): ChronicleStatus | null {
  if (!isRecord(data)) {
    return null
  }

  return {
    available: readBoolean(data.available) ?? false,
    running: readBoolean(data.running) ?? false,
    pid: readNumber(data.pid),
    lastSummaryAt: readNumber(data.lastSummaryAt) ?? readString(data.lastSummaryAt) ?? readNumber(data.last_summary_at) ?? readString(data.last_summary_at),
    lastMessageAt: readNumber(data.lastMessageAt) ?? readString(data.lastMessageAt) ?? readNumber(data.last_message_at) ?? readString(data.last_message_at),
    lastExitCode: readNumber(data.lastExitCode) ?? readNumber(data.last_exit_code),
    lastExitAt: readNumber(data.lastExitAt) ?? readString(data.lastExitAt) ?? readNumber(data.last_exit_at) ?? readString(data.last_exit_at),
    totalSummaries: readNumber(data.totalSummaries) ?? readNumber(data.total_summaries) ?? 0,
    totalMessages: readNumber(data.totalMessages) ?? readNumber(data.total_messages) ?? 0,
    configuredModel: readString(data.configuredModel) ?? readString(data.configured_model),
  }
}

function normalizeMemoryEntry(value: unknown): MemoryEntry | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value.id)
  const createdAt = readString(value.createdAt) ?? readString(value.created_at)
  const content = readString(value.content) ?? readString(value.summary) ?? readString(value.text)
  if (!id || !createdAt || !content) {
    return null
  }

  const type = value.type === '6h' || value.windowType === '6h' || value.window_type === '6h' ? '6h' : '10min'

  return {
    id,
    type,
    createdAt,
    content,
    title: readString(value.title),
    sourceCount: readNumber(value.sourceCount) ?? readNumber(value.source_count),
  }
}

function normalizeModelResource(value: unknown): ChronicleModelResource | null {
  if (!isRecord(value)) {
    return null
  }

  const category = readResourceCategory(value.category ?? value.kind ?? value.id)
  if (!category) {
    return null
  }

  const installed = readBoolean(value.installed)
  const available = readBoolean(value.available)
  const state = installed === true || available === true
    ? 'available'
    : readResourceState(value.state ?? value.status)
  const metadata = isRecord(value.metadata) ? value.metadata : null
  const manifest = metadata && isRecord(metadata.manifest) ? metadata.manifest : null

  return {
    category,
    label: readString(value.label) ?? readString(value.displayName) ?? readString(value.display_name) ?? CHRONICLE_RESOURCE_LABELS[category],
    state,
    required: readBoolean(value.required) ?? readBoolean(manifest?.required) ?? category === 'ocr',
    provider: readString(value.provider) ?? readString(value.runtime) ?? readString(metadata?.provider) ?? readString(manifest?.runtime),
    path: readString(value.path) ?? readString(value.modelPath) ?? readString(value.model_path),
    version: readString(value.version) ?? readString(manifest?.version),
    sizeBytes: readNumber(value.sizeBytes) ?? readNumber(value.size_bytes),
    message: readString(value.message) ?? readString(value.description),
    metadata,
    updatedAt: readString(value.updatedAt) ?? readString(value.updated_at) ?? readNumber(value.updatedAt) ?? readNumber(value.updated_at),
  }
}

function readArrayPayload(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) {
    return data
  }
  if (!isRecord(data)) {
    return []
  }

  for (const key of keys) {
    const value = data[key]
    if (Array.isArray(value)) {
      return value
    }
  }

  return []
}

function normalizeTimeline(data: unknown): TimelineEntry[] {
  return readArrayPayload(data, ['entries', 'timeline', 'snapshots'])
    .map(normalizeTimelineEntry)
    .filter(entry => entry !== null)
}

function normalizeMemories(data: unknown): MemoryEntry[] {
  return readArrayPayload(data, ['entries', 'memories', 'results'])
    .map(normalizeMemoryEntry)
    .filter(entry => entry !== null)
}

function normalizeModelResources(data: unknown): ChronicleModelResource[] {
  const resources = readArrayPayload(data, ['resources', 'modelResources', 'models'])
    .map(normalizeModelResource)
    .filter(resource => resource !== null)

  if (resources.length === 0) {
    return CHRONICLE_MODEL_RESOURCE_DEFAULTS
  }

  const byCategory = new Map<ChronicleModelResourceCategory, ChronicleModelResource>()
  for (const resource of CHRONICLE_MODEL_RESOURCE_DEFAULTS) {
    byCategory.set(resource.category, resource)
  }
  for (const resource of resources) {
    byCategory.set(resource.category, resource)
  }
  return Array.from(byCategory.values())
}

function normalizeMessageSource(value: unknown): ChronicleMessageSource | null {
  if (!isRecord(value)) {
    return null
  }
  const id = readString(value.id)
  const label = readString(value.label)
  if (!id || !label) {
    return null
  }
  return {
    id,
    platform: 'slack',
    label,
    enabled: readBoolean(value.enabled) ?? false,
    workspaceId: readString(value.workspaceId) ?? readString(value.workspace_id),
    teamId: readString(value.teamId) ?? readString(value.team_id),
    botTokenRef: readString(value.botTokenRef) ?? readString(value.bot_token_ref),
    channelIds: readStringArray(value.channelIds ?? value.channel_ids),
    status: readSourceStatus(value.status),
    lastSyncAt: readNumber(value.lastSyncAt) ?? readString(value.lastSyncAt) ?? readNumber(value.last_sync_at) ?? readString(value.last_sync_at),
    lastMessageAt: readNumber(value.lastMessageAt) ?? readString(value.lastMessageAt) ?? readNumber(value.last_message_at) ?? readString(value.last_message_at),
    lastError: readString(value.lastError) ?? readString(value.last_error),
  }
}

function normalizeMessageSources(data: unknown): ChronicleMessageSource[] {
  return readArrayPayload(data, ['sources', 'messageSources'])
    .map(normalizeMessageSource)
    .filter(source => source !== null)
}

function readSourceStatus(value: unknown): ChronicleMessageSource['status'] {
  if (value === 'syncing' || value === 'ready' || value === 'error' || value === 'disabled') {
    return value
  }
  return 'idle'
}

function normalizeSlackSyncResult(data: unknown): ChronicleSlackSyncResult {
  if (!isRecord(data)) {
    return { sourceId: '', status: 'error', ingested: 0, message: 'Invalid response' }
  }
  return {
    sourceId: readString(data.sourceId) ?? readString(data.source_id) ?? '',
    status: data.status === 'success' ? 'success' : 'error',
    ingested: readNumber(data.ingested) ?? 0,
    message: readString(data.message) ?? '',
  }
}

async function fetchChronicleJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${getServerUrl()}${path}`, init)
  if (!response.ok) {
    throw new Error(`Chronicle request failed: ${response.status}`)
  }
  return response.json()
}

// ── Config ──

export const CHRONICLE_CONFIG_QUERY_KEY = getChronicleConfigQueryKey()
const CHRONICLE_MODEL_RESOURCES_QUERY_KEY = ['chronicle', 'model-resources'] as const
const CHRONICLE_MESSAGE_SOURCES_QUERY_KEY = ['chronicle', 'message-sources'] as const
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

// ── Status ──

export function useChronicleStatus() {
  const { data: status = null, isLoading: loading, refetch } = useQuery({
    ...getChronicleStatusOptions(),
    select: normalizeStatus,
    refetchInterval: 5_000,
  })

  return { status, loading, refetch }
}

// ── Local model resources ──

export function useChronicleModelResources() {
  const { data: resources = CHRONICLE_MODEL_RESOURCE_DEFAULTS, isLoading: loading, refetch } = useQuery({
    queryKey: CHRONICLE_MODEL_RESOURCES_QUERY_KEY,
    queryFn: () => fetchChronicleJson('/chronicle/model-resources'),
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
      const data = await fetchChronicleJson('/chronicle/model-resources/reconcile', { method: 'POST' })
      return normalizeModelResources(data)
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: verifyResource, isPending: verifying } = useMutation({
    mutationFn: async (category: ChronicleModelResourceCategory) => {
      const data = await fetchChronicleJson(`/chronicle/model-resources/${encodeURIComponent(category)}/verify`, {
        method: 'POST',
      })
      return normalizeModelResource(data)
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: installResource, isPending: installing } = useMutation({
    mutationFn: async (draft: ChronicleModelResourceInstallDraft) => {
      const data = await fetchChronicleJson(`/chronicle/model-resources/${encodeURIComponent(draft.category)}/install`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourcePath: draft.sourcePath ?? null,
          sourceUrl: draft.sourceUrl ?? null,
        }),
      })
      return normalizeModelResource(data)
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: removeResource, isPending: removing } = useMutation({
    mutationFn: async (category: ChronicleModelResourceCategory) => {
      const data = await fetchChronicleJson(`/chronicle/model-resources/${encodeURIComponent(category)}`, {
        method: 'DELETE',
      })
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

// ── Slack message sources ──

export function useChronicleMessageSources() {
  const { data: sources = [], isLoading: loading, refetch } = useQuery({
    queryKey: CHRONICLE_MESSAGE_SOURCES_QUERY_KEY,
    queryFn: () => fetchChronicleJson('/chronicle/message-sources'),
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
    void queryClient.invalidateQueries({ queryKey: getChronicleTimelineQueryKey() })
    void queryClient.invalidateQueries({ queryKey: getChronicleMemoriesQueryKey() })
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
      return fetchChronicleJson('/chronicle/message-sources', {
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
      const data = await fetchChronicleJson(`/chronicle/message-sources/${encodeURIComponent(sourceId)}/sync`, {
        method: 'POST',
      })
      return normalizeSlackSyncResult(data)
    },
    onSuccess: invalidate,
  })

  return { saveSource, syncSource, saving, syncing }
}

// ── Timeline ──

export function useChronicleTimeline(limit = 50) {
  const { data: entries = [], isLoading: loading, refetch } = useQuery({
    ...getChronicleTimelineOptions({ query: { limit } }),
    select: normalizeTimeline,
    refetchInterval: 10_000,
  })

  return { entries, loading, refetch }
}

// ── Memories ──

export function useChronicleMemories(limit = 20) {
  const { data: entries = [], isLoading: loading, refetch } = useQuery({
    ...getChronicleMemoriesOptions({ query: { limit } }),
    select: normalizeMemories,
    refetchInterval: 15_000,
  })

  return { entries, loading, refetch }
}

export function useChronicleMemorySearch(query: string, limit = 20) {
  const normalizedQuery = query.trim()

  const { data: entries = [], isLoading: loading, isFetching, refetch } = useQuery({
    queryKey: ['chronicle', 'memories', 'search', normalizedQuery, limit],
    queryFn: () => fetchChronicleJson(`/chronicle/memories/search?q=${encodeURIComponent(normalizedQuery)}&limit=${limit}`),
    select: normalizeMemories,
    enabled: normalizedQuery.length > 0,
  })

  return {
    entries: entries as MemoryEntry[],
    loading,
    searching: isFetching,
    hasQuery: normalizedQuery.length > 0,
    refetch,
  }
}

export function useRefreshChronicleQueries() {
  const queryClient = useQueryClient()

  return () => {
    void queryClient.invalidateQueries({ queryKey: getChronicleStatusQueryKey() })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MODEL_RESOURCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MESSAGE_SOURCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: getChronicleTimelineQueryKey() })
    void queryClient.invalidateQueries({ queryKey: getChronicleMemoriesQueryKey() })
    void queryClient.invalidateQueries({ queryKey: ['chronicle', 'memories', 'search'] })
  }
}
