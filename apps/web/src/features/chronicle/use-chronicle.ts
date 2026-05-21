// Input: Chronicle API responses
// Output: React Query hooks for Settings > Chronicle
// Position: apps/web/src/features/chronicle/use-chronicle.ts

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

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
  activityPipelineEnabled: boolean
  activityPipelineIntervalMs: number
  activityPipelineBatchSize: number
  audioCaptureEnabled: boolean
  audioSource?: 'microphone' | 'system' | 'mixed'
  audioSegmentMs: number
  audioSegmentIntervalMs: number
  audioRmsThreshold: number
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
  totalAccessibilitySnapshots: number
  lastAccessibilitySnapshotAt: number | null
  totalAudioTranscripts: number
  lastAudioTranscriptAt: number | null
  totalAudioRawSegments: number
  lastAudioRawSegmentAt: number | null
  totalActivitySegments: number
  lastActivitySegmentAt: number | null
  totalPipelineRuns: number
  lastPipelineRunAt: number | null
  totalKnowledgeCards: number
  lastKnowledgeCardAt: number | null
  totalDreamRuns: number
  lastDreamRunAt: number | null
  activityPipelineEnabled: boolean
  activityPipelineRunning: boolean
  activityPipelineIntervalMs: number
  activityPipelineBatchSize: number
  audioCaptureEnabled: boolean
  audioSource?: 'microphone' | 'system' | 'mixed'
  audioRuntimeStatus: 'disabled' | 'armed' | 'unavailable'
  configuredModel: string | null
}

export type ChronicleModelResourceCategory = 'ocr' | 'audio-vad' | 'audio-asr' | 'speaker' | 'embedding' | 'pii'
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
  sourceRoot?: string | null
  files?: Array<{
    relativePath: string
    sourcePath: string
  }>
}

export interface TimelineEntry {
  id: string
  sourceType?: 'snapshot' | 'message' | 'audio'
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
  matchKind?: 'keyword' | 'semantic' | 'hybrid' | null
  keywordScore?: number | null
  semanticScore?: number | null
  title?: string | null
  sourceCount?: number | null
}

export interface ChronicleAccessibilitySnapshot {
  id: string
  sourceId: string
  snapshotId: string | null
  capturedAt: string
  capturedAtUnix: number
  status: 'ready' | 'permission-denied' | 'unavailable' | 'error'
  provider: string
  appBundleId: string | null
  windowTitle: string | null
  elementCount: number
  text: string | null
  tree: unknown[]
  metadata: Record<string, unknown>
}

export interface ChronicleAudioTranscriptSegment {
  id: string
  segmentIndex: number
  startMs: number
  endMs: number | null
  speakerLabel: string | null
  text: string
  confidence: number | null
  language: string | null
}

export interface ChronicleAudioTranscript {
  id: string
  sourceId: string
  memoryId: string | null
  title: string | null
  source: 'asr' | 'manual' | 'imported'
  status: 'recording' | 'completed' | 'imported' | 'error'
  startedAt: string
  startedAtUnix: number
  endedAt: string | null
  endedAtUnix: number | null
  language: string | null
  appBundleId: string | null
  windowTitle: string | null
  segmentCount: number
  previewText: string
  segments: ChronicleAudioTranscriptSegment[]
}

export interface ChronicleAudioRawSegment {
  id: string
  sourceId: string
  recordedAt: string
  recordedAtUnix: number
  source: 'microphone' | 'system' | 'mixed'
  status: 'captured' | 'queued' | 'processed' | 'ignored' | 'error'
  audioPath: string
  metadataPath: string
  sampleRate: number
  channels: number
  sampleCount: number
  droppedSamples: number
  durationMs: number
  rms: number
  peak: number
  active: boolean
  vadStatus: 'not-implemented' | 'pending' | 'ready' | 'error'
  asrStatus: 'not-implemented' | 'pending' | 'ready' | 'error'
  speakerStatus: 'not-implemented' | 'pending' | 'ready' | 'error'
  metadata: Record<string, unknown>
}

export interface ChronicleSpeakerProfile {
  id: string
  workspaceId: string | null
  displayName: string
  normalizedLabel: string
  aliases: string[]
  embedding: number[] | null
  embeddingDimensions: number | null
  embeddingModelId: string | null
  sampleCount: number
  lastSeenAt: string | null
  lastSeenAtUnix: number | null
  sourceTranscriptId: string | null
  sourceSegmentId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  createdAtUnix: number
  updatedAt: string
  updatedAtUnix: number
}

export interface ChronicleActivitySegment {
  id: string
  sessionId: string
  startedAt: string
  startedAtUnix: number
  endedAt: string
  endedAtUnix: number
  durationSeconds: number
  segmentType: 'work' | 'meeting' | 'browsing' | 'chat' | 'audio' | 'idle' | 'unknown'
  frontApp: string | null
  title: string | null
  summary: string | null
  sourceCounts: Record<string, number>
  sourceRefs: Record<string, string[]>
  pipelineStatus: 'collecting' | 'triaged' | 'summarized' | 'crystallized' | 'error'
  isCrystallized: boolean
  metadata: Record<string, unknown>
}

export interface ChroniclePipelineRun {
  id: string
  sessionId: string | null
  segmentId: string | null
  trigger: 'snapshot' | 'message' | 'audio-raw' | 'audio-transcript' | 'memory' | 'manual' | 'summarize'
  stage: 'collection' | 'segmentation' | 'triage' | 'summarization' | 'crystallization'
  status: 'queued' | 'running' | 'success' | 'error' | 'skipped'
  startedAt: string
  startedAtUnix: number
  endedAt: string | null
  endedAtUnix: number | null
  errorMessage: string | null
  snapshotsCount: number
  messagesCount: number
  audioTranscriptsCount: number
  audioRawSegmentsCount: number
  memoriesCount: number
  segmentsCount: number
  segmentIds: string[]
  metadata: Record<string, unknown>
}

export interface ChronicleKnowledgeCard {
  id: string
  title: string
  content: string
  cardType: 'fact' | 'insight' | 'decision' | 'task' | 'pattern'
  dimension: 'technical' | 'business' | 'personal' | 'project' | 'general'
  confidence: number
  sourceMemoryIds: string[]
  sourceSegmentIds: string[]
  sourceChunkIds: string[]
  tags: string[]
  contentHash: string
  version: number
  status: 'active' | 'merged' | 'archived' | 'deleted'
  mergedIntoId: string | null
  pinned: boolean
  metadata: Record<string, unknown>
  createdAt: string
  createdAtUnix: number
  updatedAt: string
  updatedAtUnix: number
}

export interface ChronicleDreamRun {
  id: string
  workspaceId: string | null
  runType: 'archive' | 'merge' | 'prune' | 'restore' | 'dry-run'
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  startedAtUnix: number
  endedAt: string | null
  endedAtUnix: number | null
  inputCount: number
  outputCount: number
  mergedCount: number
  deletedCount: number
  sourceKnowledgeIds: string[]
  outputKnowledgeIds: string[]
  config: Record<string, unknown>
  result: Record<string, unknown>
  errorMessage: string | null
}

export interface ChronicleActivityPipelineAction {
  segment: ChronicleActivitySegment
  run: ChroniclePipelineRun
  memoryId: string | null
  knowledgeCards?: ChronicleKnowledgeCard[]
  status: 'success' | 'error' | 'skipped'
  message: string
}

export interface ChronicleActivityPipelineTick {
  checked: number
  triaged: number
  summarized: number
  crystallized: number
  skipped: number
  errors: number
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
  realtimeMode: 'polling' | 'events-api' | 'socket-mode'
  signingSecretRef: string | null
  status: 'idle' | 'syncing' | 'ready' | 'error' | 'disabled'
  lastSyncAt: number | null
  lastMessageAt: number | null
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export interface ChronicleSlackSourceDraft {
  label: string
  token: string
  signingSecret: string
  channelIds: string
  enabled: boolean
  realtimeMode: 'polling' | 'events-api' | 'socket-mode'
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
    label: 'Speaker Extractor',
    state: 'optional',
    required: false,
    provider: null,
    path: null,
    version: null,
    sizeBytes: null,
    message: 'Optional speaker embedding extractor resource is not installed.',
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
  {
    category: 'pii',
    label: 'PII Detection',
    state: 'optional',
    required: false,
    provider: null,
    path: null,
    version: null,
    sizeBytes: null,
    message: 'Optional PII detection model for local entity redaction.',
    metadata: null,
    updatedAt: null,
  },
]

const CHRONICLE_RESOURCE_LABELS: Record<ChronicleModelResourceCategory, string> = {
  'ocr': 'OCR',
  'audio-vad': 'Audio VAD',
  'audio-asr': 'Audio ASR',
  'speaker': 'Speaker Extractor',
  'embedding': 'Embedding',
  'pii': 'PII Detection',
}

const CHRONICLE_RESOURCE_CATEGORIES = new Set<ChronicleModelResourceCategory>([
  'ocr',
  'audio-vad',
  'audio-asr',
  'speaker',
  'embedding',
  'pii',
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
const CHRONICLE_STATUS_QUERY_KEY = getChronicleStatusQueryKey()
const CHRONICLE_MODEL_RESOURCES_QUERY_KEY = ['chronicle', 'model-resources'] as const
const CHRONICLE_MESSAGE_SOURCES_QUERY_KEY = ['chronicle', 'message-sources'] as const
const CHRONICLE_ACCESSIBILITY_SNAPSHOTS_QUERY_KEY = ['chronicle', 'accessibility-snapshots'] as const
const CHRONICLE_AUDIO_TRANSCRIPTS_QUERY_KEY = ['chronicle', 'audio-transcripts'] as const
const CHRONICLE_AUDIO_RAW_SEGMENTS_QUERY_KEY = ['chronicle', 'audio-raw-segments'] as const
const CHRONICLE_SPEAKER_PROFILES_QUERY_KEY = ['chronicle', 'speaker-profiles'] as const
const CHRONICLE_ACTIVITY_SEGMENTS_QUERY_KEY = ['chronicle', 'activity-segments'] as const
const CHRONICLE_PIPELINE_RUNS_QUERY_KEY = ['chronicle', 'pipeline-runs'] as const
const CHRONICLE_KNOWLEDGE_CARDS_QUERY_KEY = ['chronicle', 'knowledge-cards'] as const
const CHRONICLE_DREAM_RUNS_QUERY_KEY = ['chronicle', 'dream-runs'] as const
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

  const { mutateAsync: installAllResources, isPending: installingAll } = useMutation({
    mutationFn: async () => {
      const data = await fetchChronicleJson<ChronicleModelResourceEntry[]>('/chronicle/model-resources/install-all', {
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
      const hasSourceRoot = typeof draft.sourceRoot === 'string' && draft.sourceRoot.trim().length > 0
      const payload = {
        source: draft.source ?? (hasFiles || hasSourceRoot ? 'local-files' : 'manifest'),
        sourceRoot: hasSourceRoot ? draft.sourceRoot : null,
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
    installAllResources,
    verifyResource,
    installResource,
    removeResource,
    reconciling,
    installingAll,
    verifying,
    installing,
    removing,
  }
}

export interface DownloadProgressEntry {
  category: string
  file: string
  totalBytes: number | null
  downloadedBytes: number
  status: 'downloading' | 'done' | 'error'
  error?: string
  startedAt: number
}

export function useChronicleDownloadProgress(active: boolean): Map<string, DownloadProgressEntry> {
  const [progress, setProgress] = useState<Map<string, DownloadProgressEntry>>(() => new Map())

  useEffect(() => {
    if (!active) {
      setProgress(new Map())
      return
    }
    const url = `${getServerUrl()}/chronicle/model-resources/download-progress`
    const eventSource = new EventSource(url)
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setProgress((prev) => {
          const next = new Map(prev)
          if (Array.isArray(data)) {
            for (const entry of data) {
              next.set(`${entry.category}/${entry.file}`, entry)
            }
          }
          else {
            next.set(`${data.category}/${data.file}`, data)
          }
          return next
        })
      }
      catch {
        // Ignore parse errors
      }
    }
    eventSource.onerror = () => {
      // Reconnect is automatic with EventSource
    }
    return () => {
      eventSource.close()
    }
  }, [active])

  return progress
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
      const { data: tokenSecret } = await postSecrets({
        body: {
          kind: 'chronicle.slack.bot-token',
          label: draft.label,
          secret: draft.token,
        },
      })
      const botTokenRef = isRecord(tokenSecret) ? readString(tokenSecret.id) : null
      if (!botTokenRef) {
        throw new Error('Slack token secret was not saved')
      }

      let signingSecretRef: string | null = null
      if (draft.realtimeMode === 'events-api') {
        const signingSecretValue = draft.signingSecret.trim()
        if (!signingSecretValue) {
          throw new Error('Slack signing secret is required for Events API')
        }
        const { data: signingSecret } = await postSecrets({
          body: {
            kind: 'chronicle.slack.signing-secret',
            label: `${draft.label} signing secret`,
            secret: signingSecretValue,
          },
        })
        signingSecretRef = isRecord(signingSecret) ? readString(signingSecret.id) : null
        if (!signingSecretRef) {
          throw new Error('Slack signing secret was not saved')
        }
      }
      return fetchChronicleJson<ChronicleMessageSource>('/chronicle/message-sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'slack',
          label: draft.label,
          enabled: draft.enabled,
          botTokenRef,
          channelIds,
          realtimeMode: draft.realtimeMode,
          signingSecretRef,
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

export function useChronicleAccessibilitySnapshots(limit = 20) {
  const { data: snapshots = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_ACCESSIBILITY_SNAPSHOTS_QUERY_KEY, limit],
    queryFn: () => fetchChronicleJson<ChronicleAccessibilitySnapshot[]>(
      `/chronicle/accessibility-snapshots?limit=${limit}`,
    ),
    refetchInterval: 10_000,
  })

  return { snapshots, loading, refetch }
}

export function useChronicleAudioTranscripts(limit = 20) {
  const { data: transcripts = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_AUDIO_TRANSCRIPTS_QUERY_KEY, limit],
    queryFn: () => fetchChronicleJson<ChronicleAudioTranscript[]>(
      `/chronicle/audio-transcripts?limit=${limit}`,
    ),
    refetchInterval: 10_000,
  })

  return { transcripts, loading, refetch }
}

export function useChronicleAudioRawSegments(limit = 20) {
  const { data: segments = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_AUDIO_RAW_SEGMENTS_QUERY_KEY, limit],
    queryFn: () => fetchChronicleJson<ChronicleAudioRawSegment[]>(
      `/chronicle/audio-raw-segments?limit=${limit}`,
    ),
    refetchInterval: 10_000,
  })

  return { segments, loading, refetch }
}

export function useChronicleSpeakerProfiles() {
  const { data: profiles = [], isLoading: loading, refetch } = useQuery({
    queryKey: CHRONICLE_SPEAKER_PROFILES_QUERY_KEY,
    queryFn: () => fetchChronicleJson<ChronicleSpeakerProfile[]>('/chronicle/speaker-profiles'),
    refetchInterval: 10_000,
  })

  return { profiles, loading, refetch }
}

export function useChronicleActivitySegments(limit = 20) {
  const { data: segments = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_ACTIVITY_SEGMENTS_QUERY_KEY, limit],
    queryFn: () => fetchChronicleJson<ChronicleActivitySegment[]>(
      `/chronicle/activity-segments?limit=${limit}`,
    ),
    refetchInterval: 10_000,
  })

  return { segments, loading, refetch }
}

export function useChroniclePipelineRuns(limit = 20) {
  const { data: runs = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_PIPELINE_RUNS_QUERY_KEY, limit],
    queryFn: () => fetchChronicleJson<ChroniclePipelineRun[]>(
      `/chronicle/pipeline-runs?limit=${limit}`,
    ),
    refetchInterval: 10_000,
  })

  return { runs, loading, refetch }
}

export function useChronicleKnowledgeCards(limit = 20) {
  const { data: cards = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_KNOWLEDGE_CARDS_QUERY_KEY, limit],
    queryFn: () => fetchChronicleJson<ChronicleKnowledgeCard[]>(
      `/chronicle/knowledge-cards?limit=${limit}`,
    ),
    refetchInterval: 10_000,
  })

  return { cards, loading, refetch }
}

export function useChronicleDreamRuns(limit = 20) {
  const { data: runs = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_DREAM_RUNS_QUERY_KEY, limit],
    queryFn: () => fetchChronicleJson<ChronicleDreamRun[]>(
      `/chronicle/dream-runs?limit=${limit}`,
    ),
    refetchInterval: 10_000,
  })

  return { runs, loading, refetch }
}

export function useChronicleDreamActions() {
  const queryClient = useQueryClient()

  const { mutateAsync: startDreamDryRun, isPending: startingDryRun } = useMutation({
    mutationFn: async () => fetchChronicleJson<ChronicleDreamRun>('/chronicle/dream-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun: true, runType: 'dry-run' }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHRONICLE_DREAM_RUNS_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: CHRONICLE_KNOWLEDGE_CARDS_QUERY_KEY })
    },
  })

  return { startDreamDryRun, startingDryRun }
}

export function useChronicleActivityPipelineActions() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_ACTIVITY_SEGMENTS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_PIPELINE_RUNS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MEMORIES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_KNOWLEDGE_CARDS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_STATUS_QUERY_KEY })
  }

  const { mutateAsync: triageSegment, isPending: triaging } = useMutation({
    mutationFn: async (segmentId: string) => fetchChronicleJson<ChronicleActivityPipelineAction>(
      `/chronicle/activity-segments/${encodeURIComponent(segmentId)}/triage`,
      { method: 'POST' },
    ),
    onSuccess: invalidate,
  })

  const { mutateAsync: summarizeSegment, isPending: summarizing } = useMutation({
    mutationFn: async (segmentId: string) => fetchChronicleJson<ChronicleActivityPipelineAction>(
      `/chronicle/activity-segments/${encodeURIComponent(segmentId)}/summarize`,
      { method: 'POST' },
    ),
    onSuccess: invalidate,
  })

  const { mutateAsync: crystallizeSegment, isPending: crystallizing } = useMutation({
    mutationFn: async (segmentId: string) => fetchChronicleJson<ChronicleActivityPipelineAction>(
      `/chronicle/activity-segments/${encodeURIComponent(segmentId)}/crystallize`,
      { method: 'POST' },
    ),
    onSuccess: invalidate,
  })

  const { mutateAsync: runPipelineTick, isPending: ticking } = useMutation({
    mutationFn: async () => fetchChronicleJson<ChronicleActivityPipelineTick>(
      '/chronicle/activity-pipeline/tick',
      { method: 'POST' },
    ),
    onSuccess: invalidate,
  })

  return {
    triageSegment,
    summarizeSegment,
    crystallizeSegment,
    runPipelineTick,
    triaging,
    summarizing,
    crystallizing,
    ticking,
  }
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
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_CONFIG_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_STATUS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MODEL_RESOURCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MESSAGE_SOURCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_ACCESSIBILITY_SNAPSHOTS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_AUDIO_TRANSCRIPTS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_AUDIO_RAW_SEGMENTS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_SPEAKER_PROFILES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_ACTIVITY_SEGMENTS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_PIPELINE_RUNS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_KNOWLEDGE_CARDS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_DREAM_RUNS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_TIMELINE_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MEMORIES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: ['chronicle', 'memories', 'search'] })
  }
}
