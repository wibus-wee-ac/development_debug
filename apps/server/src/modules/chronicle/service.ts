import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

import { generateText, type LanguageModel } from 'ai'
import {
  chronicleAccessibilitySnapshots,
  chronicleActivitySegments,
  chronicleActivitySessions,
  chronicleAudioRawSegments,
  chronicleAudioSegments,
  chronicleAudioTranscripts,
  chronicleDreamCandidates,
  chronicleDreamRuns,
  chronicleEvents,
  chronicleKnowledgeCards,
  chronicleKnowledgeSources,
  chronicleKnowledgeVersions,
  chronicleMemories,
  chronicleMemoryChunks,
  chronicleMemoryEmbeddings,
  chronicleMemoryKeywords,
  chronicleMessages,
  chronicleMessageSources,
  chronicleModelResources,
  chroniclePipelineRuns,
  chronicleSpeakerProfiles,
  chronicleSnapshots,
} from '@cradle/db'
import { count, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db, getServerConfig } from '../../infra'
import { createLanguageModel, detectApiFormat } from '../chat-runtime/engine/providers'
import * as Profiles from '../profiles/service'
import { readSecret } from '../secrets/service'
import * as DaemonManager from './daemon-manager'

interface ChronicleConfig {
  profileId: string
  modelId: string
  workspaceId: string
  enabled: boolean
  activityPipelineEnabled: boolean
  activityPipelineIntervalMs: number
  activityPipelineBatchSize: number
  audioCaptureEnabled: boolean
  audioSource: 'microphone' | 'system' | 'mixed'
  audioSegmentMs: number
  audioSegmentIntervalMs: number
  audioRmsThreshold: number
  storageRoot: string
}

const defaultConfig: ChronicleConfig = {
  profileId: '',
  modelId: '',
  workspaceId: '',
  enabled: false,
  activityPipelineEnabled: true,
  activityPipelineIntervalMs: 120_000,
  activityPipelineBatchSize: 3,
  audioCaptureEnabled: false,
  audioSource: 'microphone',
  audioSegmentMs: 5_000,
  audioSegmentIntervalMs: 60_000,
  audioRmsThreshold: 0.02,
  storageRoot: resolve(homedir(), '.cradle', 'chronicle'),
}

const ChronicleConfigSchema = z.object({
  profileId: z.string().catch(defaultConfig.profileId).default(defaultConfig.profileId),
  modelId: z.string().catch(defaultConfig.modelId).default(defaultConfig.modelId),
  workspaceId: z.string().catch(defaultConfig.workspaceId).default(defaultConfig.workspaceId),
  enabled: z.boolean().catch(defaultConfig.enabled).default(defaultConfig.enabled),
  activityPipelineEnabled: z.boolean().catch(defaultConfig.activityPipelineEnabled).default(defaultConfig.activityPipelineEnabled),
  activityPipelineIntervalMs: z.number().finite().positive().catch(defaultConfig.activityPipelineIntervalMs).default(defaultConfig.activityPipelineIntervalMs),
  activityPipelineBatchSize: z.number().finite().positive().catch(defaultConfig.activityPipelineBatchSize).default(defaultConfig.activityPipelineBatchSize),
  audioCaptureEnabled: z.boolean().catch(defaultConfig.audioCaptureEnabled).default(defaultConfig.audioCaptureEnabled),
  audioSource: z.enum(['microphone', 'system', 'mixed']).catch(defaultConfig.audioSource).default(defaultConfig.audioSource),
  audioSegmentMs: z.number().finite().positive().catch(defaultConfig.audioSegmentMs).default(defaultConfig.audioSegmentMs),
  audioSegmentIntervalMs: z.number().finite().positive().catch(defaultConfig.audioSegmentIntervalMs).default(defaultConfig.audioSegmentIntervalMs),
  audioRmsThreshold: z.number().finite().nonnegative().catch(defaultConfig.audioRmsThreshold).default(defaultConfig.audioRmsThreshold),
  storageRoot: z.string().catch(defaultConfig.storageRoot).default(defaultConfig.storageRoot),
})

const ChronicleConfigJsonSchema = z.preprocess(
  value => JSON.parse(value as string),
  ChronicleConfigSchema,
)

const ProfileConfigSchema = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  modelId: z.string().optional(),
  apiKey: z.string().optional(),
  apiMode: z.enum(['responses', 'chat-completions']).optional(),
})

const ProfileConfigJsonSchema = z.preprocess(
  raw => JSON.parse(raw as string),
  ProfileConfigSchema,
)

const SlackSourceConfigSchema = z.object({
  realtimeMode: z.enum(['polling', 'events-api', 'socket-mode']).optional(),
  signingSecretRef: z.string().nullable().optional(),
})

const SLACK_SYNC_INTERVAL_MS = 60_000
const ACTIVITY_PIPELINE_MIN_INTERVAL_MS = 30_000
const ACTIVITY_PIPELINE_MAX_INTERVAL_MS = 3_600_000
const ACTIVITY_PIPELINE_MIN_BATCH_SIZE = 1
const ACTIVITY_PIPELINE_MAX_BATCH_SIZE = 20
const SLACK_SIGNATURE_VERSION = 'v0'
const SLACK_SIGNATURE_TOLERANCE_SECONDS = 300
const MEMORY_CHUNK_MAX_CHARS = 1_800
const MEMORY_SEARCH_MAX_TERMS = 12
const MEMORY_TOKEN_MIN_LENGTH = 2
const MEMORY_EMBEDDING_DIMENSIONS = 64
const MEMORY_EMBEDDING_MODEL_ID = 'chronicle-lexical'
const MEMORY_EMBEDDING_MODEL_VERSION = 'v1'
const ONNX_TEXT_EMBEDDING_MODEL_ID = 'all-MiniLM-L6-v2'
const ONNX_TEXT_EMBEDDING_MODEL_VERSION = 'onnx-minilm-l6-v2'
const MEMORY_SEMANTIC_SCORE_WEIGHT = 12
const MEMORY_SEMANTIC_MIN_SCORE = 0.28
const ACTIVITY_IDLE_BOUNDARY_SECONDS = 10 * 60
const ACTIVITY_MAX_SEGMENT_SECONDS = 30 * 60
const ACTIVITY_SESSION_GAP_SECONDS = 6 * 60 * 60

type ChronicleDb = ReturnType<typeof db>
type ChronicleTx = Parameters<Parameters<ChronicleDb['transaction']>[0]>[0]

type ModelResourceCategory = 'ocr' | 'audio-vad' | 'audio-asr' | 'speaker' | 'embedding' | 'pii'
type ModelResourceStatus = 'available' | 'missing' | 'installing' | 'installed' | 'error'
type AudioProcessingStatus = 'not-implemented' | 'pending' | 'ready' | 'error'
type SlackSyncTrigger = 'manual' | 'background'
type SlackRealtimeMode = 'polling' | 'events-api' | 'socket-mode'
type ActivitySegmentType = 'work' | 'meeting' | 'browsing' | 'chat' | 'audio' | 'idle' | 'unknown'
type ActivityPipelineTrigger = 'snapshot' | 'message' | 'audio-raw' | 'audio-transcript' | 'memory' | 'manual' | 'summarize'
type ActivityPipelineStage = 'collection' | 'segmentation' | 'triage' | 'summarization' | 'crystallization'
type ActivityPipelineRunStatus = 'queued' | 'running' | 'success' | 'error' | 'skipped'
type KnowledgeCardType = 'fact' | 'insight' | 'decision' | 'task' | 'pattern'
type KnowledgeDimension = 'technical' | 'business' | 'personal' | 'project' | 'general'
type KnowledgeCardStatus = 'active' | 'merged' | 'archived' | 'deleted'
type DreamRunType = 'archive' | 'merge' | 'prune' | 'restore' | 'dry-run'
type DreamRunStatus = 'running' | 'completed' | 'failed'

interface SlackSourceConfig {
  realtimeMode: SlackRealtimeMode
  signingSecretRef: string | null
  socketAppTokenRef: string | null
}

interface ModelResourceFileManifest {
  path: string
  sha256?: string
  sizeBytes?: number
  sourceUrl?: string
  fallbackUrls?: string[]
  required?: boolean
}

interface ModelResourceManifest {
  category: ModelResourceCategory
  displayName: string
  version: string
  runtime: string
  required: boolean
  message: string
  files: ModelResourceFileManifest[]
  metadata?: Record<string, unknown>
}

interface ModelResourceFileCheck {
  relativePath: string
  absolutePath: string
  required: boolean
  exists: boolean
  expectedSizeBytes?: number
  actualSizeBytes?: number
  sha256?: string
  actualSha256?: string
}

interface MemorySearchScore {
  keywordScore: number
  semanticScore: number
}

interface TextEmbeddingVector {
  vector: number[]
  modelId: string
  modelVersion: string
  provider: 'onnx' | 'lexical'
}

interface ChronicleLanguageModelContext {
  model: LanguageModel
  modelId: string
  profileId: string
}

interface ActivitySegmentContext {
  segment: typeof chronicleActivitySegments.$inferSelect
  sourceRefs: Record<string, string[]>
  evidenceText: string
  evidenceCounts: Record<string, number>
}

interface ActivityTriageResult {
  keep: boolean
  reason: string
  segmentType: ActivitySegmentType
  title: string | null
  priority: 'low' | 'normal' | 'high'
}

interface ActivitySummaryResult {
  title: string
  summary: string
  keyPoints: string[]
  entities: string[]
  followUps: string[]
}

interface CrystallizedKnowledgeCardDraft {
  title: string
  content: string
  cardType: KnowledgeCardType
  dimension: KnowledgeDimension
  confidenceBps: number
  tags: string[]
  stableKey: string
}

interface ActivityCrystallizationResult {
  summary: string
  knowledgeCards: CrystallizedKnowledgeCardDraft[]
  rejectedCount: number
}

const ModelTextJsonObjectSchema = z.preprocess(
  (raw) => {
    const text = z.string().parse(raw).trim()
    try {
      return JSON.parse(text)
    }
    catch (error) {
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start >= 0 && end > start) {
        return JSON.parse(text.slice(start, end + 1))
      }
      throw error
    }
  },
  z.record(z.string(), z.unknown()),
)

const ActivitySegmentTypeSchema = z.enum(['work', 'meeting', 'browsing', 'chat', 'audio', 'idle', 'unknown'])
const ActivityPrioritySchema = z.enum(['low', 'normal', 'high'])
const KnowledgeCardTypeSchema = z.enum(['fact', 'insight', 'decision', 'task', 'pattern'])
const KnowledgeDimensionSchema = z.enum(['technical', 'business', 'personal', 'project', 'general'])
const ModelStringListSchema = z.array(z.string().min(1).catch(''))
  .catch([])
  .transform(values => values.filter(Boolean))

const ActivitySourceRefsSchema = z.object({
  snapshotIds: ModelStringListSchema.default([]),
  messageIds: ModelStringListSchema.default([]),
  audioTranscriptIds: ModelStringListSchema.default([]),
  audioRawSegmentIds: ModelStringListSchema.default([]),
  memoryIds: ModelStringListSchema.default([]),
  accessibilitySnapshotIds: ModelStringListSchema.default([]),
})

const ActivitySourceRefsJsonSchema = z.preprocess(
  raw => JSON.parse((raw ?? '{}') as string),
  ActivitySourceRefsSchema,
)

const ActivityPipelineMemoryIdsJsonSchema = z.preprocess(
  raw => JSON.parse((raw ?? '[]') as string),
  ModelStringListSchema.default([]),
)

const ActivityCrystallizationRunResultJsonSchema = z.preprocess(
  raw => JSON.parse((raw ?? '{}') as string),
  z.object({
    knowledgeCardIds: ModelStringListSchema.default([]),
  }),
)

const ActivitySegmentMetadataJsonSchema = z.preprocess(
  raw => JSON.parse((raw ?? '{}') as string),
  z.object({
    summarization: z.object({
      memoryId: z.string().nullable().default(null),
    }).default({ memoryId: null }),
  }).passthrough(),
)

const ActivityTriageModelTextSchema = z.preprocess(
  raw => ModelTextJsonObjectSchema.parse(raw),
  z.object({
    keep: z.boolean().default(false),
    reason: z.string().default('No useful activity evidence'),
    segmentType: ActivitySegmentTypeSchema.catch('unknown').default('unknown'),
    title: z.string().nullable().default(null),
    priority: ActivityPrioritySchema.catch('normal').default('normal'),
  }),
)

const ActivitySummaryModelTextSchema = z.preprocess(
  raw => ModelTextJsonObjectSchema.parse(raw),
  z.object({
    title: z.string().default('Activity summary'),
    summary: z.string().default(''),
    keyPoints: ModelStringListSchema.default([]),
    entities: ModelStringListSchema.default([]),
    followUps: ModelStringListSchema.default([]),
  }),
)

const CrystallizedKnowledgeCardDraftSchema = z.object({
  title: z.string().trim().min(1).transform(value => boundedString(value, 240)),
  content: z.string().trim().min(1).transform(value => boundedString(value, 4_000)),
  type: KnowledgeCardTypeSchema.catch('fact').default('fact'),
  dimension: KnowledgeDimensionSchema.catch('general').default('general'),
  confidence: z.number().finite().min(0).max(1).catch(1).default(1),
  tags: ModelStringListSchema.default([]).transform(values => uniqueStrings(values.map(tag => boundedString(tag.trim(), 64)).filter(Boolean)).slice(0, 12)),
  stableKey: z.string().trim().optional(),
}).transform((card): CrystallizedKnowledgeCardDraft => {
  const fallbackStableKey = hashText(`${card.dimension}:${card.type}:${canonicalizeMemoryContent(card.title)}:${canonicalizeMemoryContent(card.content).slice(0, 256)}`).slice(0, 32)
  return {
    title: card.title,
    content: card.content,
    cardType: card.type,
    dimension: card.dimension,
    confidenceBps: ratioToBps(card.confidence),
    tags: card.tags,
    stableKey: boundedString(card.stableKey ?? fallbackStableKey, 160) || fallbackStableKey,
  }
})

const ActivityCrystallizationModelTextSchema = z.preprocess(
  raw => ModelTextJsonObjectSchema.parse(raw),
  z.object({
    summary: z.string().default('').transform(value => boundedString(value, 4_000)),
    knowledgeCards: z.array(CrystallizedKnowledgeCardDraftSchema).default([]),
    rejectedCount: z.number().finite().nonnegative().transform(value => Math.floor(value)).catch(0).default(0),
  }),
)

interface DreamMergeCandidateDraft {
  workspaceId: string | null
  sourceKnowledgeIds: string[]
  proposedTitle: string
  proposedContent: string
  proposedCardType: KnowledgeCardType
  proposedDimension: KnowledgeDimension
  score: number
  reason: string
  vectorMode: string
}

export interface ModelResourceEntry {
  id: string
  category: ModelResourceCategory
  status: ModelResourceStatus
  displayName: string
  path: string | null
  version: string | null
  message: string | null
  sizeBytes: number | null
  metadata: Record<string, unknown>
  updatedAt: number
}

export interface ModelResourceLocalFileInput {
  relativePath: string
  sourcePath: string
}

export interface ModelResourceInstallInput {
  source?: 'manifest' | 'local-files'
  sourceRoot?: string | null
  files?: ModelResourceLocalFileInput[]
}

let slackSyncTimer: ReturnType<typeof setInterval> | null = null
let slackSyncRunning = false
let activityPipelineTimer: ReturnType<typeof setInterval> | null = null
let activityPipelineRunning = false
let memorySearchIndexReconciledDbPath: string | null = null
const activeSlackSyncs = new Set<string>()

// --- Download progress tracking ---
export interface DownloadProgressEntry {
  category: string
  file: string
  totalBytes: number | null
  downloadedBytes: number
  status: 'downloading' | 'done' | 'error'
  error?: string
  startedAt: number
}

const downloadProgress = new Map<string, DownloadProgressEntry>()
const downloadProgressListeners = new Set<(entry: DownloadProgressEntry) => void>()

export function getDownloadProgress(): DownloadProgressEntry[] {
  return [...downloadProgress.values()]
}

export function subscribeDownloadProgress(listener: (entry: DownloadProgressEntry) => void): () => void {
  downloadProgressListeners.add(listener)
  return () => { downloadProgressListeners.delete(listener) }
}

function emitDownloadProgress(entry: DownloadProgressEntry): void {
  downloadProgress.set(`${entry.category}/${entry.file}`, entry)
  for (const listener of downloadProgressListeners) {
    try { listener(entry) } catch {}
  }
}
// --- End download progress tracking ---

const builtInModelManifests: Record<ModelResourceCategory, ModelResourceManifest> = {
  'ocr': {
    category: 'ocr',
    displayName: 'Screen OCR',
    version: 'macos-vision',
    runtime: 'macos-vision',
    required: true,
    message: 'macOS Vision OCR is available without a downloaded model.',
    files: [],
    metadata: { provider: 'macos-vision', requiredFor: ['screen-capture'] },
  },
  'audio-vad': {
    category: 'audio-vad',
    displayName: 'Voice Activity Detection',
    version: 'silero-vad',
    runtime: 'sherpa-onnx',
    required: false,
    message: 'Place or install silero_vad.onnx to enable local audio activity detection.',
    files: [{
      path: 'audio-vad/silero_vad.onnx',
      sourceUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
      sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
      sizeBytes: 643_854,
      required: true,
    }],
    metadata: { requiredFor: ['audio-transcription'] },
  },
  'audio-asr': {
    category: 'audio-asr',
    displayName: 'Speech Recognition',
    version: 'sensevoice-2024-07-17',
    runtime: 'sherpa-onnx',
    required: false,
    message: 'Place or install SenseVoice model.int8.onnx and tokens.txt to enable local speech transcription.',
    files: [
      {
        path: 'audio-asr/sensevoice/model.int8.onnx',
        sourceUrl: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx',
        required: true,
      },
      {
        path: 'audio-asr/sensevoice/tokens.txt',
        sourceUrl: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt',
        required: true,
      },
    ],
    metadata: { requiredFor: ['audio-transcription'], languages: ['zh', 'en', 'ja', 'ko', 'yue'] },
  },
  'speaker': {
    category: 'speaker',
    displayName: 'Speaker Embedding Extractor',
    version: '3dspeaker-campplus-zh-en-16k',
    runtime: 'sherpa-onnx',
    required: false,
    message: 'Sherpa speaker embedding extractor model for local speaker profiles and meeting speaker labeling.',
    files: [{
      path: 'speaker/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
      sourceUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
      sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
      sizeBytes: 28_281_164,
      required: true,
    }],
    metadata: {
      requiredFor: ['speaker-labeling', 'meeting-transcription'],
      function: 'speaker-embedding-extractor',
      sampleRate: 16_000,
      languages: ['zh', 'en'],
    },
  },
  'embedding': {
    category: 'embedding',
    displayName: 'Text Embedding',
    version: 'all-MiniLM-L6-v2',
    runtime: 'onnx',
    required: false,
    message: 'all-MiniLM-L6-v2 ONNX model for local text embedding and future neural memory ranking.',
    files: [
      { path: 'embedding/model.onnx', sourceUrl: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx', required: true },
      { path: 'embedding/tokenizer.json', sourceUrl: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json', required: true },
    ],
    metadata: { requiredFor: ['neural-memory-ranking'], currentRuntime: 'chronicle-lexical', distance: 'cosine' },
  },
  'pii': {
    category: 'pii',
    displayName: 'PII Detection',
    version: 'gliner-pii-base-v1.0',
    runtime: 'onnx',
    required: false,
    message: 'Place GLiNER PII model and tokenizer for local PII entity detection and redaction.',
    files: [
      { path: 'pii/gliner-pii-basemodel_fp16.onnx', sourceUrl: 'https://huggingface.co/knowledgator/gliner-pii-base-v1.0/resolve/main/onnx/model_fp16.onnx', required: true },
      { path: 'pii/tokenizer.json', sourceUrl: 'https://huggingface.co/knowledgator/gliner-pii-base-v1.0/resolve/main/tokenizer.json', required: true },
    ],
    metadata: { requiredFor: ['pii-redaction'], entities: ['person', 'email', 'phone_number', 'credit_card', 'address', 'api_key', 'ssn', 'ip_address'] },
  },
}

export interface TimelineEntry {
  id: string
  sourceType: 'snapshot' | 'message' | 'audio'
  capturedAt: string
  capturedAtUnix: number
  displayId: number
  segmentDir: string
  framePath: string
  ocrText: string | null
  appBundleId: string | null
  windowTitle: string | null
  platform?: 'slack' | 'audio' | null
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
  matchKind: 'keyword' | 'semantic' | 'hybrid' | null
  keywordScore: number | null
  semanticScore: number | null
}

export interface EmbeddingRequestInput {
  texts: string[]
}

export interface EmbeddingResponse {
  modelId: string
  modelVersion: string
  dimensions: number
  embeddings: number[][]
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
  audioSource: 'microphone' | 'system' | 'mixed'
  audioRuntimeStatus: 'disabled' | 'armed' | 'unavailable'
  configuredModel: string | null
}

export interface ActivitySegmentEntry {
  id: string
  sessionId: string
  startedAt: string
  startedAtUnix: number
  endedAt: string
  endedAtUnix: number
  durationSeconds: number
  segmentType: ActivitySegmentType
  frontApp: string | null
  title: string | null
  summary: string | null
  sourceCounts: Record<string, number>
  sourceRefs: Record<string, string[]>
  pipelineStatus: 'collecting' | 'triaged' | 'summarized' | 'crystallized' | 'error'
  isCrystallized: boolean
  metadata: Record<string, unknown>
}

export interface PipelineRunEntry {
  id: string
  sessionId: string | null
  segmentId: string | null
  trigger: ActivityPipelineTrigger
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

export interface ActivityPipelineActionResult {
  segment: ActivitySegmentEntry
  run: PipelineRunEntry
  memoryId: string | null
  knowledgeCards?: KnowledgeCardEntry[]
  status: 'success' | 'error' | 'skipped'
  message: string
}

export interface KnowledgeCardEntry {
  id: string
  title: string
  content: string
  cardType: KnowledgeCardType
  dimension: KnowledgeDimension
  confidence: number
  sourceMemoryIds: string[]
  sourceSegmentIds: string[]
  sourceChunkIds: string[]
  tags: string[]
  contentHash: string
  version: number
  status: KnowledgeCardStatus
  mergedIntoId: string | null
  pinned: boolean
  metadata: Record<string, unknown>
  createdAt: string
  createdAtUnix: number
  updatedAt: string
  updatedAtUnix: number
}

export interface KnowledgeVersionEntry {
  id: string
  knowledgeId: string
  version: number
  title: string
  content: string
  cardType: KnowledgeCardType
  dimension: KnowledgeDimension
  confidence: number
  sourceMemoryIds: string[]
  sourceSegmentIds: string[]
  sourceChunkIds: string[]
  tags: string[]
  metadata: Record<string, unknown>
  createdAt: string
  createdAtUnix: number
}

export interface DreamRunEntry {
  id: string
  workspaceId: string | null
  runType: DreamRunType
  status: DreamRunStatus
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

export interface DreamRunInput {
  runType?: DreamRunType
  dryRun?: boolean
  limit?: number
  similarityThreshold?: number
  applyMerge?: boolean
}

export interface MessageSourceEntry {
  id: string
  platform: 'slack'
  label: string
  enabled: boolean
  workspaceId: string | null
  teamId: string | null
  botTokenRef: string | null
  channelIds: string[]
  realtimeMode: SlackRealtimeMode
  signingSecretRef: string | null
  socketAppTokenRef: string | null
  status: 'idle' | 'syncing' | 'ready' | 'error' | 'disabled'
  lastSyncAt: number | null
  lastMessageAt: number | null
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export interface MessageSourceInput {
  platform: 'slack'
  label: string
  enabled: boolean
  workspaceId?: string | null
  teamId?: string | null
  botTokenRef?: string | null
  channelIds: string[]
  realtimeMode?: SlackRealtimeMode
  signingSecretRef?: string | null
  socketAppTokenRef?: string | null
}

export interface MessageSourcePatchInput {
  label?: string
  enabled?: boolean
  workspaceId?: string | null
  teamId?: string | null
  botTokenRef?: string | null
  channelIds?: string[]
  realtimeMode?: SlackRealtimeMode
  signingSecretRef?: string | null
  socketAppTokenRef?: string | null
}

export interface MessageEntry {
  id: string
  sourceId: string
  platform: 'slack'
  channelId: string
  channelName: string | null
  userName: string | null
  text: string
  messageTs: string
  messageAt: string
  messageAtUnix: number
  permalink: string | null
}

export interface SlackEventsInput {
  rawBody: string
  signature: string | null
  timestamp: string | null
}

export interface SlackEventsResult {
  sourceId: string
  status: 'ok' | 'ignored'
  ingested: number
  message: string
  challenge?: string
}

export interface AudioTranscriptSegmentInput {
  startMs: number
  endMs?: number | null
  speakerLabel?: string | null
  text: string
  confidence?: number | null
  language?: string | null
  metadata?: Record<string, unknown>
}

export interface AudioTranscriptReportInput {
  sourceId: string
  title?: string | null
  source?: 'asr' | 'manual' | 'imported'
  status?: 'recording' | 'completed' | 'imported' | 'error'
  startedAt: string
  endedAt?: string | null
  language?: string | null
  appBundleId?: string | null
  windowTitle?: string | null
  audioPath?: string | null
  transcriptPath?: string | null
  segments: AudioTranscriptSegmentInput[]
  metadata?: Record<string, unknown>
}

export interface AudioTranscriptSegmentEntry {
  id: string
  segmentIndex: number
  startMs: number
  endMs: number | null
  speakerLabel: string | null
  text: string
  confidence: number | null
  language: string | null
}

export interface AudioTranscriptEntry {
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
  segments: AudioTranscriptSegmentEntry[]
}

export interface SpeakerProfileEntry {
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

export interface SpeakerProfileInput {
  displayName: string
  aliases?: string[]
  embedding?: number[] | null
  embeddingModelId?: string | null
  sampleCount?: number
  lastSeenAt?: string | null
  metadata?: Record<string, unknown>
}

export interface AudioRawSegmentReportInput {
  sourceId: string
  recordedAt: string
  source?: 'microphone' | 'system' | 'mixed'
  status?: 'captured' | 'queued' | 'processed' | 'ignored' | 'error'
  audioPath: string
  metadataPath: string
  sampleRate: number
  channels: number
  sampleCount: number
  droppedSamples?: number
  durationMs?: number
  rms: number
  peak: number
  active: boolean
  vadImplemented?: boolean
  asrImplemented?: boolean
  speakerLabelingImplemented?: boolean
  metadata?: Record<string, unknown>
}

export interface AudioRawSegmentProcessingResultInput {
  status?: 'captured' | 'queued' | 'processed' | 'ignored' | 'error'
  vadStatus?: AudioProcessingStatus
  asrStatus?: AudioProcessingStatus
  speakerStatus?: AudioProcessingStatus
  transcriptSourceId?: string | null
  speakerProfileIds?: string[]
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

export interface AudioRawSegmentEntry {
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
  vadStatus: AudioProcessingStatus
  asrStatus: AudioProcessingStatus
  speakerStatus: AudioProcessingStatus
  metadata: Record<string, unknown>
}

export interface AccessibilitySnapshotReportInput {
  sourceId: string
  status?: 'ready' | 'permission-denied' | 'unavailable' | 'error'
  provider?: string
  accessibilityPath?: string | null
  text?: string | null
  elementCount?: number
  appBundleId?: string | null
  windowTitle?: string | null
  tree?: unknown[]
  metadata?: Record<string, unknown>
}

export interface AccessibilitySnapshotEntry {
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

export interface ChronicleSnapshotReportInput {
  sourceId: string
  displayId: number
  frameIndex?: number
  capturedAt: string
  segmentDir: string
  framePath: string
  capturePath?: string
  ocrPath?: string
  snapshotPath?: string
  ocrText?: string
  appBundleId?: string
  windowTitle?: string
  accessibility?: AccessibilitySnapshotReportInput
  metadata?: Record<string, unknown>
}

export interface ChronicleMemoryReportInput {
  sourceId: string
  windowType: '10min' | '6h'
  createdAt: string
  memoryPath?: string
  content: string
  summaryKind: 'llm' | 'local' | 'imported'
  sourceSnapshotPaths?: string[]
  sourceFramePaths?: string[]
  metadata?: Record<string, unknown>
}

function getConfigPath(): string {
  const config = getServerConfig()
  const baseDir = config.dataDir ?? dirname(config.dbPath)
  return resolve(baseDir, 'preferences', 'chronicle.json')
}

export async function getConfig(): Promise<ChronicleConfig> {
  const filePath = getConfigPath()
  try {
    const content = await readFile(filePath, 'utf8')
    return ChronicleConfigJsonSchema.parse(content)
  }
  catch {
    return { ...defaultConfig }
  }
}

async function saveConfig(config: ChronicleConfig): Promise<void> {
  const filePath = getConfigPath()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(config, null, 2), 'utf8')
}

function toDaemonOptions(config: ChronicleConfig): DaemonManager.ChronicleDaemonOptions {
  return {
    storageRoot: config.storageRoot,
    audioCaptureEnabled: config.audioCaptureEnabled,
    audioSource: config.audioSource,
    audioSegmentMs: config.audioSegmentMs,
    audioSegmentIntervalMs: config.audioSegmentIntervalMs,
    audioRmsThreshold: config.audioRmsThreshold,
  }
}

function daemonLaunchConfigChanged(previous: ChronicleConfig, next: ChronicleConfig): boolean {
  return previous.storageRoot !== next.storageRoot
    || previous.audioCaptureEnabled !== next.audioCaptureEnabled
    || previous.audioSource !== next.audioSource
    || previous.audioSegmentMs !== next.audioSegmentMs
    || previous.audioSegmentIntervalMs !== next.audioSegmentIntervalMs
    || previous.audioRmsThreshold !== next.audioRmsThreshold
}

function getAudioRuntimeStatus(
  config: ChronicleConfig,
  daemonInfo: ReturnType<typeof DaemonManager.getDaemonInfo>,
): ChronicleStatus['audioRuntimeStatus'] {
  if (!config.enabled || !config.audioCaptureEnabled) {
    return 'disabled'
  }
  return daemonInfo.running && daemonInfo.audioCaptureEnabled ? 'armed' : 'unavailable'
}

export async function updateConfig(config: ChronicleConfig): Promise<ChronicleConfig> {
  const previous = await getConfig()
  const next = {
    ...config,
    activityPipelineIntervalMs: clampNumber(config.activityPipelineIntervalMs, ACTIVITY_PIPELINE_MIN_INTERVAL_MS, ACTIVITY_PIPELINE_MAX_INTERVAL_MS, defaultConfig.activityPipelineIntervalMs),
    activityPipelineBatchSize: Math.floor(clampNumber(config.activityPipelineBatchSize, ACTIVITY_PIPELINE_MIN_BATCH_SIZE, ACTIVITY_PIPELINE_MAX_BATCH_SIZE, defaultConfig.activityPipelineBatchSize)),
    audioSegmentMs: clampNumber(config.audioSegmentMs, 100, 30_000, defaultConfig.audioSegmentMs),
    audioSegmentIntervalMs: clampNumber(config.audioSegmentIntervalMs, 100, 3_600_000, defaultConfig.audioSegmentIntervalMs),
    audioRmsThreshold: clampNumber(config.audioRmsThreshold, 0, 1, defaultConfig.audioRmsThreshold),
    storageRoot: resolve(config.storageRoot || defaultConfig.storageRoot),
    audioSource: config.audioSource ?? defaultConfig.audioSource,
  }
  await saveConfig(next)
  recordEvent({
    type: 'config',
    status: 'success',
    message: next.enabled ? 'Chronicle enabled' : 'Chronicle disabled',
    attrs: {
      storageRoot: next.storageRoot,
      profileId: next.profileId,
      modelId: next.modelId,
      activityPipelineEnabled: next.activityPipelineEnabled,
      activityPipelineIntervalMs: next.activityPipelineIntervalMs,
      activityPipelineBatchSize: next.activityPipelineBatchSize,
      audioCaptureEnabled: next.audioCaptureEnabled,
      audioSource: next.audioSource,
      audioSegmentMs: next.audioSegmentMs,
      audioSegmentIntervalMs: next.audioSegmentIntervalMs,
      audioRmsThreshold: next.audioRmsThreshold,
    },
  })

  if (next.enabled && !previous.enabled) {
    const started = DaemonManager.startDaemon(toDaemonOptions(next))
    recordEvent({
      type: 'daemon',
      status: started ? 'success' : 'error',
      message: started ? 'Chronicle daemon start requested' : 'Chronicle daemon failed to start',
    })
  }
  else if (next.enabled && daemonLaunchConfigChanged(previous, next)) {
    const started = DaemonManager.restartDaemon(toDaemonOptions(next))
    recordEvent({
      type: 'daemon',
      status: started ? 'success' : 'error',
      message: started ? 'Chronicle daemon restart requested' : 'Chronicle daemon failed to restart',
    })
  }
  else if (!next.enabled && previous.enabled) {
    DaemonManager.stopDaemon()
    recordEvent({ type: 'daemon', status: 'success', message: 'Chronicle daemon stop requested' })
  }

  restartActivityPipelineScheduler(next)

  return next
}

export async function summarize(body: {
  prompt: string
  windowType: '10min' | '6h'
  sourceSnapshotIds?: string[]
  sourceArtifactPaths?: string[]
}): Promise<{ summary: string, memoryId: string | null, status: 'success' | 'error' }> {
  const config = await getConfig()
  const modelContext = resolveChronicleLanguageModelContext(config)
  if (typeof modelContext === 'string') {
    recordEvent({ type: 'summarize', status: 'error', message: modelContext })
    return { summary: `[Chronicle error - ${modelContext}]`, memoryId: null, status: 'error' }
  }

  try {
    const result = await generateText({
      model: modelContext.model,
      prompt: body.prompt,
      maxRetries: 1,
      timeout: 120_000,
    })
    const usage = normalizeLanguageModelUsage(result.usage)
    const memory = recordMemory({
      sourceId: `summary:${Date.now()}:${randomUUID()}`,
      windowType: body.windowType,
      createdAt: new Date().toISOString(),
      content: result.text,
      summaryKind: 'llm',
      sourceSnapshotPaths: body.sourceArtifactPaths ?? [],
      metadata: { prompt: body.prompt },
    }, {
      prompt: body.prompt,
      modelId: modelContext.modelId,
      profileId: modelContext.profileId,
      usage,
      sourceSnapshotIds: body.sourceSnapshotIds ?? [],
    })
    recordEvent({
      type: 'summarize',
      status: 'success',
      message: 'Chronicle summary generated',
      memoryId: memory.id,
      attrs: { modelId: modelContext.modelId, profileId: modelContext.profileId, usage },
    })
    return { summary: result.text, memoryId: memory.id, status: 'success' }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    recordEvent({
      type: 'summarize',
      status: 'error',
      message,
      attrs: { modelId: modelContext.modelId, profileId: modelContext.profileId },
    })
    return { summary: `[Chronicle error - ${message}]`, memoryId: null, status: 'error' }
  }
}

function resolveChronicleLanguageModelContext(config: ChronicleConfig): ChronicleLanguageModelContext | string {
  const failure = validateSummaryConfig(config)
  if (failure) {
    return failure
  }

  const profile = Profiles.getProfile(config.profileId)!
  const parsedConfig = ProfileConfigJsonSchema.parse(profile.configJson)
  const apiKey = resolveProfileApiKey(profile.credentialRef, parsedConfig.apiKey)
  if (!apiKey) {
    return 'no API key available for profile'
  }

  const modelId = config.modelId || parsedConfig.modelId || parsedConfig.model || 'gpt-4o-mini'
  const apiFormat = detectApiFormat(parsedConfig.baseUrl)
  const model = createLanguageModel({
    apiFormat,
    apiKey,
    baseUrl: parsedConfig.baseUrl,
    modelId,
    apiMode: parsedConfig.apiMode,
  })
  return { model, modelId, profileId: config.profileId }
}

function normalizeLanguageModelUsage(usage: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
} | undefined): { promptTokens: number, completionTokens: number, totalTokens: number } {
  const promptTokens = usage?.inputTokens ?? 0
  const completionTokens = usage?.outputTokens ?? 0
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage?.totalTokens ?? promptTokens + completionTokens,
  }
}

export async function getStatus(): Promise<ChronicleStatus> {
  const config = await getConfig()
  const daemonInfo = DaemonManager.getDaemonInfo()
  const latestSnapshot = db().select().from(chronicleSnapshots).orderBy(desc(chronicleSnapshots.capturedAt)).limit(1).get()
  const latestMemory = db().select().from(chronicleMemories).orderBy(desc(chronicleMemories.createdAt)).limit(1).get()
  const latestError = db().select().from(chronicleEvents)
    .where(eq(chronicleEvents.status, 'error'))
    .orderBy(desc(chronicleEvents.createdAt))
    .limit(1)
    .get()
  const snapshotCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_snapshots`)?.count ?? 0
  const memoryCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_memories`)?.count ?? 0
  const accessibilitySnapshotCount = db()
    .select({ value: count() })
    .from(chronicleAccessibilitySnapshots)
    .get()?.value ?? 0
  const audioTranscriptCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_audio_transcripts`)?.count ?? 0
  const audioRawSegmentCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_audio_raw_segments`)?.count ?? 0
  const activitySegmentCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_activity_segments`)?.count ?? 0
  const pipelineRunCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_pipeline_runs`)?.count ?? 0
  const knowledgeCardCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_knowledge_cards WHERE status != 'deleted'`)?.count ?? 0
  const dreamRunCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_dream_runs`)?.count ?? 0

  return {
    available: config.enabled && !!config.profileId,
    running: daemonInfo.running,
    pid: daemonInfo.pid,
    lastCaptureAt: latestSnapshot?.capturedAt ?? null,
    lastSummaryAt: latestMemory?.createdAt ?? null,
    lastErrorAt: latestError?.createdAt ?? null,
    lastError: latestError?.message ?? null,
    lastExitCode: daemonInfo.lastExitCode,
    lastExitAt: daemonInfo.lastExitAt,
    totalSnapshots: snapshotCount,
    totalSummaries: memoryCount,
    totalMessages: db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_messages`)?.count ?? 0,
    lastMessageAt: db().select({ messageAt: chronicleMessages.messageAt }).from(chronicleMessages).orderBy(desc(chronicleMessages.messageAt)).limit(1).get()?.messageAt ?? null,
    totalAccessibilitySnapshots: accessibilitySnapshotCount,
    lastAccessibilitySnapshotAt: db().select({ capturedAt: chronicleAccessibilitySnapshots.capturedAt }).from(chronicleAccessibilitySnapshots).orderBy(desc(chronicleAccessibilitySnapshots.capturedAt)).limit(1).get()?.capturedAt ?? null,
    totalAudioTranscripts: audioTranscriptCount,
    lastAudioTranscriptAt: db().select({ startedAt: chronicleAudioTranscripts.startedAt }).from(chronicleAudioTranscripts).orderBy(desc(chronicleAudioTranscripts.startedAt)).limit(1).get()?.startedAt ?? null,
    totalAudioRawSegments: audioRawSegmentCount,
    lastAudioRawSegmentAt: db().select({ recordedAt: chronicleAudioRawSegments.recordedAt }).from(chronicleAudioRawSegments).orderBy(desc(chronicleAudioRawSegments.recordedAt)).limit(1).get()?.recordedAt ?? null,
    totalActivitySegments: activitySegmentCount,
    lastActivitySegmentAt: db().select({ startedAt: chronicleActivitySegments.startedAt }).from(chronicleActivitySegments).orderBy(desc(chronicleActivitySegments.startedAt)).limit(1).get()?.startedAt ?? null,
    totalPipelineRuns: pipelineRunCount,
    lastPipelineRunAt: db().select({ startedAt: chroniclePipelineRuns.startedAt }).from(chroniclePipelineRuns).orderBy(desc(chroniclePipelineRuns.startedAt)).limit(1).get()?.startedAt ?? null,
    totalKnowledgeCards: knowledgeCardCount,
    lastKnowledgeCardAt: db().select({ updatedAt: chronicleKnowledgeCards.updatedAt }).from(chronicleKnowledgeCards).orderBy(desc(chronicleKnowledgeCards.updatedAt)).limit(1).get()?.updatedAt ?? null,
    totalDreamRuns: dreamRunCount,
    lastDreamRunAt: db().select({ startedAt: chronicleDreamRuns.startedAt }).from(chronicleDreamRuns).orderBy(desc(chronicleDreamRuns.startedAt)).limit(1).get()?.startedAt ?? null,
    activityPipelineEnabled: config.activityPipelineEnabled,
    activityPipelineRunning,
    activityPipelineIntervalMs: config.activityPipelineIntervalMs,
    activityPipelineBatchSize: config.activityPipelineBatchSize,
    audioCaptureEnabled: config.audioCaptureEnabled,
    audioSource: config.audioSource,
    audioRuntimeStatus: getAudioRuntimeStatus(config, daemonInfo),
    configuredModel: await getConfiguredModel(config),
  }
}

export function getDaemonResources() {
  return DaemonManager.getDaemonResources()
}

export async function initDaemon(): Promise<void> {
  const config = await getConfig()
  if (config.enabled) {
    DaemonManager.startDaemon(toDaemonOptions(config))
  }
  restartActivityPipelineScheduler(config)
}

export function startSlackBackgroundSync(): void {
  if (slackSyncTimer) {
    return
  }

  void runSlackSyncTick().catch((error) => {
    console.error('[chronicle] Slack background sync failed:', error)
  })
  slackSyncTimer = setInterval(() => {
    void runSlackSyncTick().catch((error) => {
      console.error('[chronicle] Slack background sync failed:', error)
    })
  }, SLACK_SYNC_INTERVAL_MS)
}

export function stopSlackBackgroundSync(): void {
  if (!slackSyncTimer) {
    return
  }

  clearInterval(slackSyncTimer)
  slackSyncTimer = null
  slackSyncRunning = false
  activeSlackSyncs.clear()
}

export function stopActivityPipelineScheduler(): void {
  if (!activityPipelineTimer) {
    return
  }
  clearInterval(activityPipelineTimer)
  activityPipelineTimer = null
  activityPipelineRunning = false
}

export function restartActivityPipelineScheduler(config?: ChronicleConfig): void {
  stopActivityPipelineScheduler()
  const current = config ?? syncConfig()
  if (!current.enabled || !current.activityPipelineEnabled) {
    return
  }
  void runActivityPipelineTick().catch((error) => {
    console.error('[chronicle] Activity pipeline tick failed:', error)
  })
  activityPipelineTimer = setInterval(() => {
    void runActivityPipelineTick().catch((error) => {
      console.error('[chronicle] Activity pipeline tick failed:', error)
    })
  }, current.activityPipelineIntervalMs)
}

export async function runActivityPipelineTick(): Promise<{
  checked: number
  triaged: number
  summarized: number
  crystallized: number
  skipped: number
  errors: number
}> {
  if (activityPipelineRunning) {
    return { checked: 0, triaged: 0, summarized: 0, crystallized: 0, skipped: 0, errors: 0 }
  }

  activityPipelineRunning = true
  try {
    const config = await getConfig()
    if (!config.enabled || !config.activityPipelineEnabled) {
      return { checked: 0, triaged: 0, summarized: 0, crystallized: 0, skipped: 0, errors: 0 }
    }
    const segments = db()
      .select()
      .from(chronicleActivitySegments)
      .where(sql`${chronicleActivitySegments.pipelineStatus} IN ('collecting', 'triaged', 'summarized', 'error') AND ${chronicleActivitySegments.isCrystallized} = 0`)
      .orderBy(chronicleActivitySegments.startedAt)
      .limit(config.activityPipelineBatchSize)
      .all()
    let triaged = 0
    let summarized = 0
    let crystallized = 0
    let skipped = 0
    let errors = 0
    for (const segment of segments) {
      try {
        const result = await advanceActivitySegmentPipeline(segment.id)
        if (result.status === 'error') {
          errors += 1
        }
        else if (result.status === 'skipped') {
          skipped += 1
        }
        if (result.run.stage === 'triage') {
          triaged += 1
        }
        else if (result.run.stage === 'summarization') {
          summarized += 1
        }
        else if (result.run.stage === 'crystallization') {
          crystallized += 1
        }
      }
      catch (error) {
        errors += 1
        recordEvent({
          type: 'activity',
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          attrs: { segmentId: segment.id, stage: 'activity-pipeline-scheduler' },
        })
      }
    }
    return { checked: segments.length, triaged, summarized, crystallized, skipped, errors }
  }
  finally {
    activityPipelineRunning = false
  }
}

async function advanceActivitySegmentPipeline(segmentId: string): Promise<ActivityPipelineActionResult> {
  const segment = db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, segmentId)).get()
  if (!segment) {
    throw new AppError({ code: 'chronicle_activity_segment_not_found', status: 404, message: 'Chronicle activity segment not found' })
  }
  if (segment.pipelineStatus === 'collecting' || segment.pipelineStatus === 'error') {
    return triageActivitySegment(segmentId)
  }
  if (segment.pipelineStatus === 'triaged') {
    return summarizeActivitySegment(segmentId)
  }
  return crystallizeActivitySegment(segmentId)
}

export async function runSlackSyncTick(): Promise<{ checked: number, synced: number, errors: number }> {
  if (slackSyncRunning) {
    return { checked: 0, synced: 0, errors: 0 }
  }

  slackSyncRunning = true
  try {
    const sources = db()
      .select({ id: chronicleMessageSources.id })
      .from(chronicleMessageSources)
      .where(sql`${chronicleMessageSources.platform} = 'slack' AND ${chronicleMessageSources.enabled} = 1`)
      .all()

    let synced = 0
    let errors = 0
    for (const source of sources) {
      const result = await syncSlackSource(source.id, 'background')
      if (result.status === 'success') {
        synced += 1
      }
      else {
        errors += 1
      }
    }

    return { checked: sources.length, synced, errors }
  }
  finally {
    slackSyncRunning = false
  }
}

export function getTimeline(limit = 50): TimelineEntry[] {
  const snapshots = db()
    .select()
    .from(chronicleSnapshots)
    .orderBy(desc(chronicleSnapshots.capturedAt))
    .limit(limit)
    .all()
    .map(row => ({
      id: row.id,
      sourceType: 'snapshot' as const,
      capturedAt: new Date(row.capturedAt * 1000).toISOString(),
      capturedAtUnix: row.capturedAt,
      displayId: row.displayId,
      segmentDir: row.segmentDir,
      framePath: row.framePath,
      ocrText: row.ocrText,
      appBundleId: row.appBundleId,
      windowTitle: row.windowTitle,
    }))
  const messages = db()
    .select()
    .from(chronicleMessages)
    .orderBy(desc(chronicleMessages.messageAt))
    .limit(limit)
    .all()
    .map(row => ({
      id: row.id,
      sourceType: 'message' as const,
      capturedAt: new Date(row.messageAt * 1000).toISOString(),
      capturedAtUnix: row.messageAt,
      displayId: 0,
      segmentDir: '',
      framePath: '',
      ocrText: row.text,
      appBundleId: 'slack',
      windowTitle: row.channelName ?? row.channelId,
      platform: row.platform,
      channelId: row.channelId,
      channelName: row.channelName,
      userName: row.userName,
    }))
  const audioTranscripts = db()
    .select()
    .from(chronicleAudioTranscripts)
    .orderBy(desc(chronicleAudioTranscripts.startedAt))
    .limit(limit)
    .all()
    .map(row => ({
      id: row.id,
      sourceType: 'audio' as const,
      capturedAt: new Date(row.startedAt * 1000).toISOString(),
      capturedAtUnix: row.startedAt,
      displayId: 0,
      segmentDir: '',
      framePath: '',
      ocrText: buildAudioTranscriptPreview(row.id),
      appBundleId: row.appBundleId ?? 'audio',
      windowTitle: row.title ?? row.windowTitle ?? 'Audio transcript',
      platform: 'audio' as const,
      channelId: null,
      channelName: row.title,
      userName: null,
    }))

  return [...snapshots, ...messages, ...audioTranscripts]
    .sort((left, right) => right.capturedAtUnix - left.capturedAtUnix)
    .slice(0, limit)
}

export function getMemories(limit = 20): MemoryEntry[] {
  return db()
    .select()
    .from(chronicleMemories)
    .orderBy(desc(chronicleMemories.createdAt))
    .limit(limit)
    .all()
    .map(row => toMemoryEntry(row))
}

export function searchMemories(query: string, limit = 20): MemoryEntry[] {
  reconcileMemorySearchIndex()
  const needle = query.trim()
  if (!needle) {
    return getMemories(limit)
  }
  const terms = tokenizeMemoryText(needle).slice(0, MEMORY_SEARCH_MAX_TERMS)
  if (terms.length === 0) {
    return []
  }

  const keywordRows = db()
    .select()
    .from(chronicleMemoryKeywords)
    .where(inArray(chronicleMemoryKeywords.term, terms))
    .all()

  const scoreByMemoryId = new Map<string, MemorySearchScore>()
  for (const row of keywordRows) {
    const phraseBoost = terms.includes(row.term) ? 1 : 0
    const current = scoreByMemoryId.get(row.memoryId) ?? { keywordScore: 0, semanticScore: 0 }
    current.keywordScore += row.occurrences * row.weight + phraseBoost
    scoreByMemoryId.set(row.memoryId, current)
  }

  const queryEmbedding = buildTextEmbeddingVector(needle)
  const embeddingRows = db()
    .select()
    .from(chronicleMemoryEmbeddings)
    .where(sql`${chronicleMemoryEmbeddings.status} = 'ready' AND ${chronicleMemoryEmbeddings.modelId} = ${queryEmbedding.modelId} AND ${chronicleMemoryEmbeddings.modelVersion} = ${queryEmbedding.modelVersion}`)
    .all()

  for (const row of embeddingRows) {
    const vector = parseEmbeddingVector(row.vectorJson, row.dimensions)
    if (!vector) {
      continue
    }
    const semanticScore = cosineSimilarity(queryEmbedding.vector, vector)
    if (semanticScore < MEMORY_SEMANTIC_MIN_SCORE) {
      continue
    }
    const current = scoreByMemoryId.get(row.memoryId) ?? { keywordScore: 0, semanticScore: 0 }
    current.semanticScore = Math.max(current.semanticScore, semanticScore)
    scoreByMemoryId.set(row.memoryId, current)
  }

  if (scoreByMemoryId.size === 0) {
    return []
  }

  const rows = db()
    .select()
    .from(chronicleMemories)
    .where(inArray(chronicleMemories.id, [...scoreByMemoryId.keys()]))
    .all()

  const normalizedNeedle = canonicalizeMemoryContent(needle)
  return rows
    .map(row => ({
      row,
      match: scoreByMemoryId.get(row.id) ?? { keywordScore: 0, semanticScore: 0 },
      score: buildCombinedMemorySearchScore(
        scoreByMemoryId.get(row.id) ?? { keywordScore: 0, semanticScore: 0 },
        canonicalizeMemoryContent(row.content).includes(normalizedNeedle),
      ),
    }))
    .sort((left, right) => right.score - left.score || right.row.createdAt - left.row.createdAt)
    .slice(0, limit)
    .map(({ row, match }) => toMemoryEntry(row, match))
}

export function embedTexts(input: EmbeddingRequestInput): EmbeddingResponse {
  const texts = input.texts.map(text => text.trim()).filter(Boolean)
  if (texts.length === 0 || texts.length > 64) {
    throw new AppError({
      code: 'chronicle_embedding_request_invalid',
      status: 400,
      message: 'Embedding request must include 1-64 non-empty texts',
    })
  }
  if (!onnxEmbeddingResourceAvailable()) {
    throw new AppError({
      code: 'chronicle_embedding_model_unavailable',
      status: 503,
      message: 'Chronicle ONNX embedding model is not installed',
    })
  }
  try {
    const response = DaemonManager.runEmbeddingBatch(texts, getModelResourcesRoot())
    validateEmbeddingBatch(response.embeddings, texts.length, response.dimensions)
    return {
      modelId: response.modelId,
      modelVersion: response.modelVersion,
      dimensions: response.dimensions,
      embeddings: response.embeddings,
    }
  }
  catch (error) {
    throw new AppError({
      code: 'chronicle_embedding_failed',
      status: 500,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function getModelResources(): Promise<ModelResourceEntry[]> {
  seedModelResources()
  return listModelResourceRows()
}

export async function reconcileModelResources(): Promise<ModelResourceEntry[]> {
  seedModelResources()
  for (const category of Object.keys(builtInModelManifests) as ModelResourceCategory[]) {
    await verifyModelResource(category, { recordEventOnSuccess: false })
  }
  return listModelResourceRows()
}

export async function installAllModelResources(): Promise<ModelResourceEntry[]> {
  seedModelResources()
  const categories = Object.keys(builtInModelManifests) as ModelResourceCategory[]
  for (const category of categories) {
    try {
      const manifest = getModelResourceManifest(category)
      // Skip categories with no files or missing source URLs
      const hasDownloadableFiles = manifest.files.length > 0 && manifest.files.every(f => !!f.sourceUrl)
      if (hasDownloadableFiles) {
        await installModelResource(category, { source: 'manifest' })
      }
    } catch {
      // Continue installing other models even if one fails
    }
  }
  return listModelResourceRows()
}

export async function verifyModelResource(
  category: ModelResourceCategory,
  options: { recordEventOnSuccess?: boolean } = {},
): Promise<ModelResourceEntry> {
  const manifest = getModelResourceManifest(category)
  const current = getModelResourceRow(category)
  const now = currentUnixSeconds()

  if (manifest.files.length === 0) {
    const metadata = buildModelResourceMetadata(manifest, {
      verifiedAt: now,
      files: [],
    })
    db().update(chronicleModelResources).set({
      status: 'available',
      displayName: manifest.displayName,
      path: null,
      version: manifest.version,
      message: manifest.message,
      sizeBytes: 0,
      metadataJson: JSON.stringify(metadata),
      updatedAt: now,
    }).where(eq(chronicleModelResources.id, current.id)).run()
    return getModelResourceEntry(category)
  }

  const checks = await checkModelResourceFiles(manifest)
  const missingRequired = checks.filter(check => check.required && !check.exists)
  const failedChecksum = checks.filter(check => check.exists && check.sha256 && check.actualSha256 !== check.sha256)
  const failedSize = checks.filter(check => check.exists && check.expectedSizeBytes !== undefined && check.actualSizeBytes !== check.expectedSizeBytes)
  const presentSizeBytes = checks.reduce((total, check) => total + (check.actualSizeBytes ?? 0), 0)
  const firstModelPath = checks.find(check => check.exists)?.absolutePath ?? getModelResourceAbsolutePath(manifest.files[0].path)
  const metadata = buildModelResourceMetadata(manifest, {
    verifiedAt: now,
    files: checks,
  })

  if (missingRequired.length > 0) {
    db().update(chronicleModelResources).set({
      status: 'missing',
      displayName: manifest.displayName,
      path: null,
      version: manifest.version,
      message: `Missing ${missingRequired.length} required model file${missingRequired.length === 1 ? '' : 's'}.`,
      sizeBytes: presentSizeBytes,
      metadataJson: JSON.stringify(metadata),
      updatedAt: now,
    }).where(eq(chronicleModelResources.id, current.id)).run()
    return getModelResourceEntry(category)
  }

  if (failedChecksum.length > 0 || failedSize.length > 0) {
    const message = failedChecksum.length > 0
      ? `Checksum failed for ${failedChecksum.map(check => check.relativePath).join(', ')}.`
      : `Size check failed for ${failedSize.map(check => check.relativePath).join(', ')}.`
    db().update(chronicleModelResources).set({
      status: 'error',
      displayName: manifest.displayName,
      path: rootRelativeModelPath(firstModelPath),
      version: manifest.version,
      message,
      sizeBytes: presentSizeBytes,
      metadataJson: JSON.stringify(metadata),
      updatedAt: now,
    }).where(eq(chronicleModelResources.id, current.id)).run()
    recordEvent({
      type: 'model-resource',
      status: 'error',
      message,
      attrs: { category },
    })
    return getModelResourceEntry(category)
  }

  db().update(chronicleModelResources).set({
    status: 'available',
    displayName: manifest.displayName,
    path: rootRelativeModelPath(firstModelPath),
    version: manifest.version,
    message: `Verified ${manifest.displayName}.`,
    sizeBytes: presentSizeBytes,
    metadataJson: JSON.stringify(metadata),
    updatedAt: now,
  }).where(eq(chronicleModelResources.id, current.id)).run()

  if (options.recordEventOnSuccess !== false) {
    recordEvent({
      type: 'model-resource',
      status: 'success',
      message: `Verified ${manifest.displayName}`,
      attrs: { category, sizeBytes: presentSizeBytes },
    })
  }
  return getModelResourceEntry(category)
}

export async function installModelResource(
  category: ModelResourceCategory,
  input: ModelResourceInstallInput,
): Promise<ModelResourceEntry> {
  const manifest = getModelResourceManifest(category)
  if (manifest.files.length === 0) {
    return verifyModelResource(category)
  }

  const source = input.source ?? 'manifest'
  const localFiles = input.files ?? []
  const sourceRoot = normalizeNullableString(input.sourceRoot)
  if (source === 'local-files' && localFiles.length === 0 && !sourceRoot) {
    throw new AppError({
      code: 'chronicle_model_resource_source_missing',
      status: 400,
      message: 'Local model resource install requires files or sourceRoot',
    })
  }
  if (source === 'manifest') {
    assertManifestInstallAllowed(manifest)
  }

  const now = currentUnixSeconds()
  const current = getModelResourceRow(category)
  const firstTargetPath = getModelResourceAbsolutePath(manifest.files[0].path)
  db().update(chronicleModelResources).set({
    status: 'installing',
    displayName: manifest.displayName,
    path: rootRelativeModelPath(firstTargetPath),
    version: manifest.version,
    message: 'Installing model resource.',
    metadataJson: JSON.stringify(buildModelResourceMetadata(manifest, { installingAt: now })),
    updatedAt: now,
  }).where(eq(chronicleModelResources.id, current.id)).run()

  const tempPaths: string[] = []
  const promotedPaths: string[] = []
  try {
    const stagedFiles: Array<{ tempPath: string, targetPath: string }> = []
    for (const file of manifest.files) {
      const targetPath = getModelResourceAbsolutePath(file.path)
      const tempPath = `${targetPath}.tmp-${randomUUID()}`
      tempPaths.push(tempPath)
      await mkdir(dirname(targetPath), { recursive: true })

      if (source === 'local-files') {
        const resolvedSource = await resolveModelResourceLocalSource(localFiles, sourceRoot, file, manifest.files.length)
        await copyFile(resolvedSource, tempPath)
      }
      else {
        await downloadModelResourceFile(file, tempPath, category)
      }

      await verifyStagedModelFile(file, tempPath)
      stagedFiles.push({ tempPath, targetPath })
    }

    for (const stagedFile of stagedFiles) {
      await rename(stagedFile.tempPath, stagedFile.targetPath)
      promotedPaths.push(stagedFile.targetPath)
    }
    const verified = await verifyModelResource(category)
    recordEvent({
      type: 'model-resource',
      status: 'success',
      message: `Installed ${manifest.displayName}`,
      attrs: { category, source },
    })
    return verified
  }
  catch (error) {
    for (const tempPath of tempPaths) {
      await rm(tempPath, { force: true }).catch(() => {})
    }
    for (const promotedPath of promotedPaths) {
      await rm(promotedPath, { force: true }).catch(() => {})
    }
    const message = error instanceof Error ? error.message : String(error)
    db().update(chronicleModelResources).set({
      status: 'error',
      message,
      updatedAt: currentUnixSeconds(),
    }).where(eq(chronicleModelResources.id, current.id)).run()
    recordEvent({
      type: 'model-resource',
      status: 'error',
      message,
      attrs: { category },
    })
    return getModelResourceEntry(category)
  }
}

export async function removeModelResource(category: ModelResourceCategory): Promise<ModelResourceEntry> {
  const manifest = getModelResourceManifest(category)
  for (const file of manifest.files) {
    await rm(getModelResourceAbsolutePath(file.path), { force: true }).catch(() => {})
  }
  const current = getModelResourceRow(category)
  const now = currentUnixSeconds()
  db().update(chronicleModelResources).set({
    status: manifest.files.length === 0 ? 'available' : 'missing',
    displayName: manifest.displayName,
    path: null,
    version: manifest.version,
    message: manifest.files.length === 0 ? manifest.message : 'Model resource files removed.',
    sizeBytes: 0,
    metadataJson: JSON.stringify(buildModelResourceMetadata(manifest, { removedAt: now })),
    updatedAt: now,
  }).where(eq(chronicleModelResources.id, current.id)).run()
  recordEvent({
    type: 'model-resource',
    status: 'success',
    message: `Removed ${manifest.displayName}`,
    attrs: { category },
  })
  return getModelResourceEntry(category)
}

export function listMessageSources(): MessageSourceEntry[] {
  return db()
    .select()
    .from(chronicleMessageSources)
    .orderBy(chronicleMessageSources.label)
    .all()
    .map(toMessageSourceEntry)
}

export function createMessageSource(input: MessageSourceInput): MessageSourceEntry {
  const now = currentUnixSeconds()
  const id = randomUUID()
  const sourceConfig = buildSlackSourceConfig({
    realtimeMode: input.realtimeMode,
    signingSecretRef: input.signingSecretRef,
    socketAppTokenRef: input.socketAppTokenRef,
  })
  db().insert(chronicleMessageSources).values({
    id,
    platform: input.platform,
    label: input.label,
    enabled: input.enabled,
    workspaceId: normalizeNullableString(input.workspaceId),
    teamId: normalizeNullableString(input.teamId),
    botTokenRef: normalizeNullableString(input.botTokenRef),
    channelIdsJson: JSON.stringify(normalizeChannelIds(input.channelIds)),
    configJson: JSON.stringify(sourceConfig),
    status: input.enabled ? 'idle' : 'disabled',
    createdAt: now,
    updatedAt: now,
  }).run()
  recordEvent({
    type: 'message',
    status: 'success',
    message: 'Chronicle Slack source created',
    attrs: { sourceId: id, label: input.label },
  })
  return getMessageSourceEntry(id)
}

export function updateMessageSource(sourceId: string, input: MessageSourcePatchInput): MessageSourceEntry {
  const existing = db().select().from(chronicleMessageSources).where(eq(chronicleMessageSources.id, sourceId)).get()
  if (!existing) {
    throw new AppError({ code: 'chronicle_message_source_not_found', status: 404, message: 'Chronicle message source not found' })
  }
  const nextEnabled = input.enabled ?? existing.enabled
  const nextConfig = mergeSlackSourceConfig(existing.configJson, {
    realtimeMode: input.realtimeMode,
    signingSecretRef: input.signingSecretRef,
    socketAppTokenRef: input.socketAppTokenRef,
  })
  db().update(chronicleMessageSources).set({
    label: input.label ?? existing.label,
    enabled: nextEnabled,
    workspaceId: input.workspaceId === undefined ? existing.workspaceId : normalizeNullableString(input.workspaceId),
    teamId: input.teamId === undefined ? existing.teamId : normalizeNullableString(input.teamId),
    botTokenRef: input.botTokenRef === undefined ? existing.botTokenRef : normalizeNullableString(input.botTokenRef),
    channelIdsJson: input.channelIds === undefined ? existing.channelIdsJson : JSON.stringify(normalizeChannelIds(input.channelIds)),
    configJson: JSON.stringify(nextConfig),
    status: nextEnabled ? existing.status === 'disabled' ? 'idle' : existing.status : 'disabled',
    updatedAt: currentUnixSeconds(),
  }).where(eq(chronicleMessageSources.id, sourceId)).run()
  return getMessageSourceEntry(sourceId)
}

export function deleteMessageSource(sourceId: string): { ok: true } {
  db().delete(chronicleMessageSources).where(eq(chronicleMessageSources.id, sourceId)).run()
  recordEvent({
    type: 'message',
    status: 'success',
    message: 'Chronicle Slack source deleted',
    attrs: { sourceId },
  })
  return { ok: true }
}

export function listMessages(limit = 50): MessageEntry[] {
  return db()
    .select()
    .from(chronicleMessages)
    .orderBy(desc(chronicleMessages.messageAt))
    .limit(limit)
    .all()
    .map(toMessageEntry)
}

export function listAudioTranscripts(limit = 20): AudioTranscriptEntry[] {
  return db()
    .select()
    .from(chronicleAudioTranscripts)
    .orderBy(desc(chronicleAudioTranscripts.startedAt))
    .limit(limit)
    .all()
    .map(row => toAudioTranscriptEntry(row))
}

export function listAudioRawSegments(limit = 20): AudioRawSegmentEntry[] {
  return db()
    .select()
    .from(chronicleAudioRawSegments)
    .orderBy(desc(chronicleAudioRawSegments.recordedAt))
    .limit(limit)
    .all()
    .map(toAudioRawSegmentEntry)
}

export function listAccessibilitySnapshots(limit = 20): AccessibilitySnapshotEntry[] {
  return db()
    .select()
    .from(chronicleAccessibilitySnapshots)
    .orderBy(desc(chronicleAccessibilitySnapshots.capturedAt))
    .limit(limit)
    .all()
    .map(toAccessibilitySnapshotEntry)
}

export function listActivitySegments(limit = 20): ActivitySegmentEntry[] {
  return db()
    .select()
    .from(chronicleActivitySegments)
    .orderBy(desc(chronicleActivitySegments.startedAt))
    .limit(limit)
    .all()
    .map(toActivitySegmentEntry)
}

export function listPipelineRuns(limit = 20): PipelineRunEntry[] {
  return db()
    .select()
    .from(chroniclePipelineRuns)
    .orderBy(desc(chroniclePipelineRuns.startedAt))
    .limit(limit)
    .all()
    .map(toPipelineRunEntry)
}

export function listKnowledgeCards(input: {
  limit?: number
  dimension?: KnowledgeDimension
  cardType?: KnowledgeCardType
  includeDeleted?: boolean
} = {}): KnowledgeCardEntry[] {
  return db()
    .select()
    .from(chronicleKnowledgeCards)
    .orderBy(desc(chronicleKnowledgeCards.updatedAt))
    .limit(Math.max(1, Math.min(input.limit ?? 50, 200)))
    .all()
    .filter(row => input.includeDeleted || row.status !== 'deleted')
    .filter(row => !input.dimension || row.dimension === input.dimension)
    .filter(row => !input.cardType || row.cardType === input.cardType)
    .map(toKnowledgeCardEntry)
}

export function listKnowledgeVersions(knowledgeId: string): KnowledgeVersionEntry[] {
  return db()
    .select()
    .from(chronicleKnowledgeVersions)
    .where(eq(chronicleKnowledgeVersions.knowledgeId, knowledgeId))
    .orderBy(desc(chronicleKnowledgeVersions.version))
    .all()
    .map(toKnowledgeVersionEntry)
}

export function listDreamRuns(limit = 20): DreamRunEntry[] {
  return db()
    .select()
    .from(chronicleDreamRuns)
    .orderBy(desc(chronicleDreamRuns.startedAt))
    .limit(Math.max(1, Math.min(limit, 100)))
    .all()
    .map(toDreamRunEntry)
}

export function startDreamRun(input: DreamRunInput = {}): DreamRunEntry {
  const dryRun = input.dryRun !== false && input.applyMerge !== true
  const runType: DreamRunType = dryRun ? 'dry-run' : input.runType ?? 'merge'
  const threshold = clampNumber(input.similarityThreshold, 0.1, 1, 0.76)
  const limit = Math.max(2, Math.min(input.limit ?? 80, 300))
  const vectorMode = currentTextEmbeddingVectorMode()
  const now = currentUnixSeconds()
  const runId = randomUUID()
  db().insert(chronicleDreamRuns).values({
    id: runId,
    workspaceId: null,
    runType,
    status: 'running',
    startedAt: now,
    endedAt: null,
    inputCount: 0,
    outputCount: 0,
    mergedCount: 0,
    deletedCount: 0,
    sourceKnowledgeIdsJson: '[]',
    outputKnowledgeIdsJson: '[]',
    configJson: JSON.stringify({
      dryRun,
      runType,
      limit,
      similarityThreshold: threshold,
      vectorMode,
    }),
    resultJson: '{}',
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  }).run()

  try {
    const cards = db()
      .select()
      .from(chronicleKnowledgeCards)
      .orderBy(desc(chronicleKnowledgeCards.updatedAt))
      .limit(limit)
      .all()
      .filter(card => card.status === 'active')
    const candidates = buildDreamMergeCandidates(cards, threshold)
    const result = db().transaction((tx) => {
      const outputKnowledgeIds: string[] = []
      for (const candidate of candidates) {
        let outputKnowledgeId: string | null = null
        if (!dryRun) {
          outputKnowledgeId = applyDreamMergeCandidate(tx, candidate, runId, now)
          outputKnowledgeIds.push(outputKnowledgeId)
        }
        tx.insert(chronicleDreamCandidates).values({
          id: randomUUID(),
          runId,
          workspaceId: candidate.workspaceId,
          candidateType: 'merge',
          scoreBps: ratioToBps(candidate.score),
          sourceKnowledgeIdsJson: JSON.stringify(candidate.sourceKnowledgeIds),
          proposedTitle: candidate.proposedTitle,
          proposedContent: candidate.proposedContent,
          proposedCardType: candidate.proposedCardType,
          proposedDimension: candidate.proposedDimension,
          outputKnowledgeId,
          status: outputKnowledgeId ? 'applied' : 'proposed',
          reason: candidate.reason,
          metadataJson: JSON.stringify({ vectorMode }),
          createdAt: now,
          updatedAt: now,
        }).run()
      }
      const sourceKnowledgeIds = uniqueStrings(candidates.flatMap(candidate => candidate.sourceKnowledgeIds))
      tx.update(chronicleDreamRuns).set({
        status: 'completed',
        endedAt: now,
        inputCount: cards.length,
        outputCount: dryRun ? candidates.length : outputKnowledgeIds.length,
        mergedCount: dryRun ? 0 : outputKnowledgeIds.length,
        deletedCount: 0,
        sourceKnowledgeIdsJson: JSON.stringify(sourceKnowledgeIds),
        outputKnowledgeIdsJson: JSON.stringify(outputKnowledgeIds),
        resultJson: JSON.stringify({
          dryRun,
          vectorMode,
          candidateCount: candidates.length,
          candidates: candidates.slice(0, 50),
        }),
        updatedAt: now,
      }).where(eq(chronicleDreamRuns.id, runId)).run()
      return tx.select().from(chronicleDreamRuns).where(eq(chronicleDreamRuns.id, runId)).get()!
    })
    recordEvent({
      type: 'activity',
      status: 'success',
      message: dryRun ? 'Chronicle dream merge dry run completed' : 'Chronicle dream merge completed',
      attrs: { runId, candidateCount: candidates.length, dryRun },
    })
    return toDreamRunEntry(result)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const endedAt = currentUnixSeconds()
    db().update(chronicleDreamRuns).set({
      status: 'failed',
      endedAt,
      errorMessage: message,
      updatedAt: endedAt,
    }).where(eq(chronicleDreamRuns.id, runId)).run()
    recordEvent({ type: 'activity', status: 'error', message, attrs: { runId, stage: 'dream-run' } })
    return toDreamRunEntry(db().select().from(chronicleDreamRuns).where(eq(chronicleDreamRuns.id, runId)).get()!)
  }
}

export async function triageActivitySegment(segmentId: string): Promise<ActivityPipelineActionResult> {
  const context = getActivitySegmentContext(segmentId)
  const evidenceHash = buildActivityEvidenceHash(context)
  const sourceKey = `activity-segment:${segmentId}:triage:${evidenceHash}`
  const completed = getCompletedActivityPipelineRun(sourceKey, context.segment.id)
  if (completed) {
    return completed
  }
  const now = currentUnixSeconds()
  const run = upsertActivityPipelineRun({
    sourceKey,
    segment: context.segment,
    stage: 'triage',
    status: 'running',
    startedAt: now,
    metadata: { evidenceCounts: context.evidenceCounts, evidenceHash },
  })
  const config = await getConfig()
  const modelContext = resolveChronicleLanguageModelContext(config)
  if (typeof modelContext === 'string') {
    return failActivityPipelineRun(context.segment.id, run.id, 'triage', modelContext)
  }

  try {
    const prompt = buildActivityTriagePrompt(context)
    const result = await generateText({
      model: modelContext.model,
      prompt,
      maxRetries: 1,
      timeout: 120_000,
    })
    const triage = parseActivityTriageResult(result.text)
    const endedAt = currentUnixSeconds()
    const metadata = {
      ...parseJson<Record<string, unknown>>(context.segment.metadataJson, {}),
      triage: {
        keep: triage.keep,
        reason: triage.reason,
        priority: triage.priority,
        modelId: modelContext.modelId,
        profileId: modelContext.profileId,
        evidenceHash,
        completedAt: endedAt,
      },
    }
    db().update(chronicleActivitySegments).set({
      segmentType: triage.segmentType,
      title: triage.title ?? context.segment.title,
      pipelineStatus: 'triaged',
      metadataJson: JSON.stringify(metadata),
      updatedAt: endedAt,
    }).where(eq(chronicleActivitySegments.id, context.segment.id)).run()

    db().update(chroniclePipelineRuns).set({
      status: triage.keep ? 'success' : 'skipped',
      endedAt,
      errorMessage: null,
      triageResultsJson: JSON.stringify({
        ...triage,
        rawText: result.text,
        usage: normalizeLanguageModelUsage(result.usage),
      }),
      metadataJson: JSON.stringify({
        evidenceCounts: context.evidenceCounts,
        evidenceHash,
        modelId: modelContext.modelId,
        profileId: modelContext.profileId,
      }),
      updatedAt: endedAt,
    }).where(eq(chroniclePipelineRuns.id, run.id)).run()

    recordEvent({
      type: 'activity',
      status: triage.keep ? 'success' : 'info',
      message: triage.keep ? 'Chronicle activity segment triaged' : 'Chronicle activity segment skipped by triage',
      attrs: { segmentId: context.segment.id, runId: run.id, reason: triage.reason },
    })

    return {
      segment: toActivitySegmentEntry(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, context.segment.id)).get()!),
      run: toPipelineRunEntry(db().select().from(chroniclePipelineRuns).where(eq(chroniclePipelineRuns.id, run.id)).get()!),
      memoryId: null,
      status: triage.keep ? 'success' : 'skipped',
      message: triage.reason,
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failActivityPipelineRun(context.segment.id, run.id, 'triage', message)
  }
}

export async function summarizeActivitySegment(segmentId: string): Promise<ActivityPipelineActionResult> {
  const triageResult = await triageActivitySegment(segmentId)
  if (triageResult.status === 'error') {
    return triageResult
  }
  if (triageResult.status === 'skipped') {
    return triageResult
  }

  const context = getActivitySegmentContext(segmentId)
  const evidenceHash = buildActivityEvidenceHash(context)
  const sourceKey = `activity-segment:${segmentId}:summarization:${evidenceHash}`
  const completed = getCompletedActivityPipelineRun(sourceKey, context.segment.id)
  if (completed) {
    return completed
  }
  const now = currentUnixSeconds()
  const run = upsertActivityPipelineRun({
    sourceKey,
    segment: context.segment,
    stage: 'summarization',
    status: 'running',
    startedAt: now,
    metadata: { evidenceCounts: context.evidenceCounts, evidenceHash },
  })
  const config = await getConfig()
  const modelContext = resolveChronicleLanguageModelContext(config)
  if (typeof modelContext === 'string') {
    return failActivityPipelineRun(context.segment.id, run.id, 'summarization', modelContext)
  }

  try {
    const prompt = buildActivitySummaryPrompt(context)
    const result = await generateText({
      model: modelContext.model,
      prompt,
      maxRetries: 1,
      timeout: 120_000,
    })
    const summary = parseActivitySummaryResult(result.text)
    const usage = normalizeLanguageModelUsage(result.usage)
    const memory = recordMemory({
      sourceId: `activity-segment:${segmentId}:summary`,
      windowType: '10min',
      createdAt: new Date(context.segment.endedAt * 1000).toISOString(),
      content: buildActivitySummaryMemoryContent(context, summary),
      summaryKind: 'llm',
      metadata: {
        source: 'activity-segment-summary',
        segmentId,
        title: summary.title,
        keyPoints: summary.keyPoints,
        entities: summary.entities,
        followUps: summary.followUps,
      },
    }, {
      prompt,
      modelId: modelContext.modelId,
      profileId: modelContext.profileId,
      usage,
      sourceSnapshotIds: context.sourceRefs.snapshotIds ?? [],
      skipActivityAssignment: true,
    })
    const endedAt = currentUnixSeconds()
    const metadata = {
      ...parseJson<Record<string, unknown>>(context.segment.metadataJson, {}),
      summarization: {
        memoryId: memory.id,
        modelId: modelContext.modelId,
        profileId: modelContext.profileId,
        evidenceHash,
        completedAt: endedAt,
      },
    }
    db().update(chronicleActivitySegments).set({
      title: summary.title || context.segment.title,
      summary: summary.summary,
      pipelineStatus: 'summarized',
      metadataJson: JSON.stringify(metadata),
      updatedAt: endedAt,
    }).where(eq(chronicleActivitySegments.id, context.segment.id)).run()
    db().update(chroniclePipelineRuns).set({
      status: 'success',
      endedAt,
      errorMessage: null,
      memoryIdsJson: JSON.stringify([memory.id]),
      memoriesCount: 1,
      summaryResultsJson: JSON.stringify({
        ...summary,
        memoryId: memory.id,
        rawText: result.text,
        usage,
      }),
      metadataJson: JSON.stringify({
        evidenceCounts: context.evidenceCounts,
        evidenceHash,
        modelId: modelContext.modelId,
        profileId: modelContext.profileId,
      }),
      updatedAt: endedAt,
    }).where(eq(chroniclePipelineRuns.id, run.id)).run()
    recordEvent({
      type: 'activity',
      status: 'success',
      message: 'Chronicle activity segment summarized',
      memoryId: memory.id,
      attrs: { segmentId, runId: run.id, modelId: modelContext.modelId },
    })
    return {
      segment: toActivitySegmentEntry(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, context.segment.id)).get()!),
      run: toPipelineRunEntry(db().select().from(chroniclePipelineRuns).where(eq(chroniclePipelineRuns.id, run.id)).get()!),
      memoryId: memory.id,
      status: 'success',
      message: 'Activity segment summarized',
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failActivityPipelineRun(context.segment.id, run.id, 'summarization', message)
  }
}

export async function crystallizeActivitySegment(segmentId: string): Promise<ActivityPipelineActionResult> {
  const currentSegment = db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, segmentId)).get()
  if (!currentSegment) {
    throw new AppError({ code: 'chronicle_activity_segment_not_found', status: 404, message: 'Chronicle activity segment not found' })
  }
  if (!currentSegment.summary && currentSegment.pipelineStatus !== 'crystallized') {
    const summaryResult = await summarizeActivitySegment(segmentId)
    if (summaryResult.status !== 'success') {
      return summaryResult
    }
  }

  const context = getActivitySegmentContext(segmentId)
  const evidenceHash = buildActivityCrystallizationEvidenceHash(context)
  const sourceKey = `activity-segment:${segmentId}:crystallization:${evidenceHash}`
  const completed = getCompletedCrystallizationRun(sourceKey, context.segment.id)
  if (completed) {
    return completed
  }

  const now = currentUnixSeconds()
  const run = upsertActivityPipelineRun({
    sourceKey,
    segment: context.segment,
    stage: 'crystallization',
    status: 'running',
    startedAt: now,
    metadata: { evidenceCounts: context.evidenceCounts, evidenceHash },
  })
  const config = await getConfig()
  const modelContext = resolveChronicleLanguageModelContext(config)
  if (typeof modelContext === 'string') {
    return failActivityPipelineRun(context.segment.id, run.id, 'crystallization', modelContext)
  }

  try {
    const prompt = buildActivityCrystallizationPrompt(context)
    const result = await generateText({
      model: modelContext.model,
      prompt,
      maxRetries: 1,
      timeout: 120_000,
    })
    const parsed = parseActivityCrystallizationResult(result.text)
    const usage = normalizeLanguageModelUsage(result.usage)
    const endedAt = currentUnixSeconds()
    const memoryIds = getActivityCrystallizationMemoryIds(context)

    const cards = db().transaction((tx) => {
      const writtenCards: Array<typeof chronicleKnowledgeCards.$inferSelect> = []
      const versionIds: string[] = []

      for (const draft of parsed.knowledgeCards) {
        const written = upsertKnowledgeCardFromDraft(tx, {
          draft,
          context,
          runId: run.id,
          modelId: modelContext.modelId,
          profileId: modelContext.profileId,
          evidenceHash,
          memoryIds,
          now: endedAt,
        })
        writtenCards.push(written.card)
        versionIds.push(written.versionId)
      }

      const metadata = {
        ...parseJson<Record<string, unknown>>(context.segment.metadataJson, {}),
        crystallization: {
          knowledgeCardIds: writtenCards.map(card => card.id),
          modelId: modelContext.modelId,
          profileId: modelContext.profileId,
          evidenceHash,
          completedAt: endedAt,
        },
      }
      tx.update(chronicleActivitySegments).set({
        pipelineStatus: writtenCards.length > 0 ? 'crystallized' : context.segment.pipelineStatus,
        isCrystallized: writtenCards.length > 0,
        metadataJson: JSON.stringify(metadata),
        updatedAt: endedAt,
      }).where(eq(chronicleActivitySegments.id, context.segment.id)).run()
      tx.update(chroniclePipelineRuns).set({
        status: writtenCards.length > 0 ? 'success' : 'skipped',
        endedAt,
        errorMessage: null,
        memoryIdsJson: JSON.stringify(memoryIds),
        memoriesCount: memoryIds.length,
        segmentIdsJson: JSON.stringify([context.segment.id]),
        segmentsCount: 1,
        summaryResultsJson: JSON.stringify({
          summary: parsed.summary,
          knowledgeCardIds: writtenCards.map(card => card.id),
          versionIds,
          rejectedCount: parsed.rejectedCount,
          rawText: result.text.slice(0, 16_000),
          usage,
        }),
        metadataJson: JSON.stringify({
          evidenceCounts: context.evidenceCounts,
          evidenceHash,
          modelId: modelContext.modelId,
          profileId: modelContext.profileId,
          promptHash: hashText(prompt),
          promptVersion: 'chronicle-crystallization-v1',
        }),
        updatedAt: endedAt,
      }).where(eq(chroniclePipelineRuns.id, run.id)).run()

      return writtenCards.map(toKnowledgeCardEntry)
    })

    recordEvent({
      type: 'activity',
      status: cards.length > 0 ? 'success' : 'info',
      message: cards.length > 0 ? 'Chronicle activity segment crystallized' : 'Chronicle activity segment produced no knowledge cards',
      attrs: { segmentId, runId: run.id, knowledgeCardIds: cards.map(card => card.id) },
    })

    return {
      segment: toActivitySegmentEntry(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, context.segment.id)).get()!),
      run: toPipelineRunEntry(db().select().from(chroniclePipelineRuns).where(eq(chroniclePipelineRuns.id, run.id)).get()!),
      memoryId: memoryIds[0] ?? null,
      knowledgeCards: cards,
      status: cards.length > 0 ? 'success' : 'skipped',
      message: cards.length > 0 ? 'Activity segment crystallized' : 'No durable knowledge cards were produced',
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failActivityPipelineRun(context.segment.id, run.id, 'crystallization', message)
  }
}

function getCompletedActivityPipelineRun(
  sourceKey: string,
  segmentId: string,
): ActivityPipelineActionResult | null {
  const run = db()
    .select()
    .from(chroniclePipelineRuns)
    .where(eq(chroniclePipelineRuns.sourceKey, sourceKey))
    .get()
  if (!run || (run.status !== 'success' && run.status !== 'skipped')) {
    return null
  }
  const memoryIds = ActivityPipelineMemoryIdsJsonSchema.parse(run.memoryIdsJson)
  return {
    segment: toActivitySegmentEntry(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, segmentId)).get()!),
    run: toPipelineRunEntry(run),
    memoryId: memoryIds[0] ?? null,
    status: run.status,
    message: run.status === 'skipped' ? 'Activity segment was already skipped' : 'Activity pipeline result already exists',
  }
}

function getCompletedCrystallizationRun(
  sourceKey: string,
  segmentId: string,
): ActivityPipelineActionResult | null {
  const run = db()
    .select()
    .from(chroniclePipelineRuns)
    .where(eq(chroniclePipelineRuns.sourceKey, sourceKey))
    .get()
  if (!run || (run.status !== 'success' && run.status !== 'skipped')) {
    return null
  }
  const result = ActivityCrystallizationRunResultJsonSchema.parse(run.summaryResultsJson)
  const knowledgeCardIds = result.knowledgeCardIds
  const cards = knowledgeCardIds.length === 0
    ? []
    : db()
        .select()
        .from(chronicleKnowledgeCards)
        .where(inArray(chronicleKnowledgeCards.id, knowledgeCardIds))
        .all()
        .map(toKnowledgeCardEntry)
  const memoryIds = ActivityPipelineMemoryIdsJsonSchema.parse(run.memoryIdsJson)
  return {
    segment: toActivitySegmentEntry(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, segmentId)).get()!),
    run: toPipelineRunEntry(run),
    memoryId: memoryIds[0] ?? null,
    knowledgeCards: cards,
    status: run.status,
    message: run.status === 'skipped' ? 'Activity crystallization produced no cards' : 'Activity crystallization result already exists',
  }
}

function getActivitySegmentContext(segmentId: string): ActivitySegmentContext {
  const segment = db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, segmentId)).get()
  if (!segment) {
    throw new AppError({ code: 'chronicle_activity_segment_not_found', status: 404, message: 'Chronicle activity segment not found' })
  }
  const sourceRefs = parseJson<Record<string, string[]>>(segment.sourceRefsJson, {})
  const evidenceText = [
    `Segment: ${segment.title ?? 'Untitled activity'}`,
    `Type: ${segment.segmentType}`,
    `Window: ${segment.frontApp ?? 'unknown'} / ${segment.title ?? 'unknown'}`,
    `Time: ${new Date(segment.startedAt * 1000).toISOString()} - ${new Date(segment.endedAt * 1000).toISOString()}`,
    `Existing summary: ${segment.summary ?? ''}`,
    buildSnapshotEvidenceText(sourceRefs.snapshotIds ?? []),
    buildAccessibilityEvidenceText(sourceRefs.accessibilitySnapshotIds ?? []),
    buildSlackEvidenceText(sourceRefs.messageIds ?? []),
    buildAudioTranscriptEvidenceText(sourceRefs.audioTranscriptIds ?? []),
    buildAudioRawEvidenceText(sourceRefs.audioRawSegmentIds ?? []),
    buildMemoryEvidenceText(sourceRefs.memoryIds ?? []),
  ].filter(section => section.trim().length > 0).join('\n\n')

  return {
    segment,
    sourceRefs,
    evidenceText,
    evidenceCounts: countActivitySourceRefs(sourceRefs),
  }
}

function buildSnapshotEvidenceText(snapshotIds: string[]): string {
  const ids = uniqueStrings(snapshotIds)
  if (ids.length === 0) {
    return ''
  }
  return db()
    .select()
    .from(chronicleSnapshots)
    .where(inArray(chronicleSnapshots.id, ids))
    .orderBy(chronicleSnapshots.capturedAt)
    .all()
    .map(row => [
      `[Snapshot ${new Date(row.capturedAt * 1000).toISOString()}]`,
      `App: ${row.appBundleId ?? 'unknown'}`,
      `Title: ${row.windowTitle ?? 'unknown'}`,
      `OCR: ${row.ocrText ?? ''}`,
    ].join('\n'))
    .join('\n\n')
}

function buildAccessibilityEvidenceText(accessibilitySnapshotIds: string[]): string {
  const ids = uniqueStrings(accessibilitySnapshotIds)
  if (ids.length === 0) {
    return ''
  }
  return db()
    .select()
    .from(chronicleAccessibilitySnapshots)
    .where(inArray(chronicleAccessibilitySnapshots.id, ids))
    .orderBy(chronicleAccessibilitySnapshots.capturedAt)
    .all()
    .map(row => [
      `[Accessibility ${new Date(row.capturedAt * 1000).toISOString()}]`,
      `Status: ${row.status}`,
      `Provider: ${row.provider}`,
      `Text: ${row.text ?? ''}`,
    ].join('\n'))
    .join('\n\n')
}

function buildSlackEvidenceText(messageIds: string[]): string {
  const ids = uniqueStrings(messageIds)
  if (ids.length === 0) {
    return ''
  }
  return db()
    .select()
    .from(chronicleMessages)
    .where(inArray(chronicleMessages.id, ids))
    .orderBy(chronicleMessages.messageAt)
    .all()
    .map(row => `[Slack ${row.channelName ?? row.channelId} ${new Date(row.messageAt * 1000).toISOString()}] ${row.userName ?? row.userId ?? 'unknown'}: ${row.text}`)
    .join('\n')
}

function buildAudioTranscriptEvidenceText(audioTranscriptIds: string[]): string {
  const ids = uniqueStrings(audioTranscriptIds)
  if (ids.length === 0) {
    return ''
  }
  return db()
    .select()
    .from(chronicleAudioTranscripts)
    .where(inArray(chronicleAudioTranscripts.id, ids))
    .orderBy(chronicleAudioTranscripts.startedAt)
    .all()
    .map(row => [
      `[Audio Transcript ${new Date(row.startedAt * 1000).toISOString()}]`,
      `Title: ${row.title ?? row.windowTitle ?? 'Untitled transcript'}`,
      `Text: ${buildAudioTranscriptPreview(row.id)}`,
    ].join('\n'))
    .join('\n\n')
}

function buildAudioRawEvidenceText(audioRawSegmentIds: string[]): string {
  const ids = uniqueStrings(audioRawSegmentIds)
  if (ids.length === 0) {
    return ''
  }
  return db()
    .select()
    .from(chronicleAudioRawSegments)
    .where(inArray(chronicleAudioRawSegments.id, ids))
    .orderBy(chronicleAudioRawSegments.recordedAt)
    .all()
    .map(row => [
      `[Raw Audio ${new Date(row.recordedAt * 1000).toISOString()}]`,
      `Source: ${row.source}`,
      `Active: ${row.active}`,
      `Duration: ${row.durationMs}ms`,
      `RMS: ${bpsToRatio(row.rmsBps)}`,
    ].join('\n'))
    .join('\n\n')
}

function buildMemoryEvidenceText(memoryIds: string[]): string {
  const ids = uniqueStrings(memoryIds)
  if (ids.length === 0) {
    return ''
  }
  return db()
    .select()
    .from(chronicleMemories)
    .where(inArray(chronicleMemories.id, ids))
    .orderBy(chronicleMemories.createdAt)
    .all()
    .map(row => `[Memory ${new Date(row.createdAt * 1000).toISOString()} ${row.source}] ${row.content}`)
    .join('\n\n')
}

function buildActivityEvidenceHash(context: ActivitySegmentContext): string {
  return hashText(JSON.stringify({
    segmentId: context.segment.id,
    startedAt: context.segment.startedAt,
    endedAt: context.segment.endedAt,
    sourceRefs: normalizeActivityEvidenceRefs(context.sourceRefs),
    sourceVersions: buildActivityEvidenceSourceVersions(context.sourceRefs),
  })).slice(0, 24)
}

function buildActivityCrystallizationEvidenceHash(context: ActivitySegmentContext): string {
  return hashText(JSON.stringify({
    activityEvidenceHash: buildActivityEvidenceHash(context),
    summaryMemoryVersions: buildActivityCrystallizationMemoryVersions(context),
  })).slice(0, 24)
}

function buildActivityCrystallizationMemoryVersions(context: ActivitySegmentContext): Array<{ id: string, updatedAt: number }> {
  const memoryIds = getActivityCrystallizationMemoryIds(context)
  if (memoryIds.length === 0) {
    return []
  }
  return db()
    .select({ id: chronicleMemories.id, updatedAt: chronicleMemories.updatedAt })
    .from(chronicleMemories)
    .where(inArray(chronicleMemories.id, memoryIds))
    .all()
    .sort(compareActivityEvidenceVersion)
}

function getActivityCrystallizationMemoryIds(context: ActivitySegmentContext): string[] {
  const sourceRefs = ActivitySourceRefsSchema.parse(context.sourceRefs)
  const metadata = ActivitySegmentMetadataJsonSchema.parse(context.segment.metadataJson)
  return uniqueStrings([
    ...sourceRefs.memoryIds,
    ...(metadata.summarization.memoryId ? [metadata.summarization.memoryId] : []),
  ])
}

function normalizeActivityEvidenceRefs(sourceRefs: Record<string, string[]>): Record<string, string[]> {
  const entries: Array<[string, string[]]> = Object.entries(sourceRefs)
    .map(([key, values]) => [key, uniqueStrings(values).sort()])
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)))
}

function buildActivityEvidenceSourceVersions(sourceRefs: Record<string, string[]>): Record<string, Array<{ id: string, updatedAt: number }>> {
  return {
    snapshotIds: readActivityEvidenceVersions('snapshotIds', sourceRefs.snapshotIds ?? []),
    accessibilitySnapshotIds: readActivityEvidenceVersions('accessibilitySnapshotIds', sourceRefs.accessibilitySnapshotIds ?? []),
    messageIds: readActivityEvidenceVersions('messageIds', sourceRefs.messageIds ?? []),
    audioTranscriptIds: readActivityEvidenceVersions('audioTranscriptIds', sourceRefs.audioTranscriptIds ?? []),
    audioRawSegmentIds: readActivityEvidenceVersions('audioRawSegmentIds', sourceRefs.audioRawSegmentIds ?? []),
    memoryIds: readActivityEvidenceVersions('memoryIds', sourceRefs.memoryIds ?? []),
  }
}

function readActivityEvidenceVersions(
  kind: 'snapshotIds' | 'accessibilitySnapshotIds' | 'messageIds' | 'audioTranscriptIds' | 'audioRawSegmentIds' | 'memoryIds',
  ids: string[],
): Array<{ id: string, updatedAt: number }> {
  const uniqueIds = uniqueStrings(ids)
  if (uniqueIds.length === 0) {
    return []
  }
  if (kind === 'snapshotIds') {
    return db().select({ id: chronicleSnapshots.id, updatedAt: chronicleSnapshots.updatedAt }).from(chronicleSnapshots).where(inArray(chronicleSnapshots.id, uniqueIds)).all().sort(compareActivityEvidenceVersion)
  }
  if (kind === 'accessibilitySnapshotIds') {
    return db().select({ id: chronicleAccessibilitySnapshots.id, updatedAt: chronicleAccessibilitySnapshots.updatedAt }).from(chronicleAccessibilitySnapshots).where(inArray(chronicleAccessibilitySnapshots.id, uniqueIds)).all().sort(compareActivityEvidenceVersion)
  }
  if (kind === 'messageIds') {
    return db().select({ id: chronicleMessages.id, updatedAt: chronicleMessages.updatedAt }).from(chronicleMessages).where(inArray(chronicleMessages.id, uniqueIds)).all().sort(compareActivityEvidenceVersion)
  }
  if (kind === 'audioTranscriptIds') {
    return db().select({ id: chronicleAudioTranscripts.id, updatedAt: chronicleAudioTranscripts.updatedAt }).from(chronicleAudioTranscripts).where(inArray(chronicleAudioTranscripts.id, uniqueIds)).all().sort(compareActivityEvidenceVersion)
  }
  if (kind === 'audioRawSegmentIds') {
    return db().select({ id: chronicleAudioRawSegments.id, updatedAt: chronicleAudioRawSegments.updatedAt }).from(chronicleAudioRawSegments).where(inArray(chronicleAudioRawSegments.id, uniqueIds)).all().sort(compareActivityEvidenceVersion)
  }
  return db().select({ id: chronicleMemories.id, updatedAt: chronicleMemories.updatedAt }).from(chronicleMemories).where(inArray(chronicleMemories.id, uniqueIds)).all().sort(compareActivityEvidenceVersion)
}

function compareActivityEvidenceVersion(
  left: { id: string, updatedAt: number },
  right: { id: string, updatedAt: number },
): number {
  return left.id.localeCompare(right.id)
}

function upsertActivityPipelineRun(input: {
  sourceKey: string
  segment: typeof chronicleActivitySegments.$inferSelect
  stage: ActivityPipelineStage
  status: ActivityPipelineRunStatus
  startedAt: number
  metadata: Record<string, unknown>
}): typeof chroniclePipelineRuns.$inferSelect {
  const now = currentUnixSeconds()
  const sourceRefs = parseJson<Record<string, string[]>>(input.segment.sourceRefsJson, {})
  const values = {
    sessionId: input.segment.sessionId,
    segmentId: input.segment.id,
    workspaceId: input.segment.workspaceId,
    trigger: input.stage === 'summarization' ? 'summarize' as const : 'manual' as const,
    sourceKey: input.sourceKey,
    stage: input.stage,
    status: input.status,
    startedAt: input.startedAt,
    endedAt: null,
    errorMessage: null,
    snapshotIdsJson: JSON.stringify(sourceRefs.snapshotIds ?? []),
    messageIdsJson: JSON.stringify(sourceRefs.messageIds ?? []),
    audioTranscriptIdsJson: JSON.stringify(sourceRefs.audioTranscriptIds ?? []),
    audioRawSegmentIdsJson: JSON.stringify(sourceRefs.audioRawSegmentIds ?? []),
    memoryIdsJson: JSON.stringify(sourceRefs.memoryIds ?? []),
    segmentIdsJson: JSON.stringify([input.segment.id]),
    snapshotsCount: sourceRefs.snapshotIds?.length ?? 0,
    messagesCount: sourceRefs.messageIds?.length ?? 0,
    audioTranscriptsCount: sourceRefs.audioTranscriptIds?.length ?? 0,
    audioRawSegmentsCount: sourceRefs.audioRawSegmentIds?.length ?? 0,
    memoriesCount: sourceRefs.memoryIds?.length ?? 0,
    segmentsCount: 1,
    metadataJson: JSON.stringify(input.metadata),
    updatedAt: now,
  }
  const existing = db()
    .select()
    .from(chroniclePipelineRuns)
    .where(eq(chroniclePipelineRuns.sourceKey, input.sourceKey))
    .get()
  if (existing) {
    db().update(chroniclePipelineRuns).set(values).where(eq(chroniclePipelineRuns.id, existing.id)).run()
    return db().select().from(chroniclePipelineRuns).where(eq(chroniclePipelineRuns.id, existing.id)).get()!
  }
  const id = randomUUID()
  db().insert(chroniclePipelineRuns).values({
    id,
    ...values,
    triageResultsJson: '{}',
    summaryResultsJson: '{}',
    createdAt: now,
  }).run()
  return db().select().from(chroniclePipelineRuns).where(eq(chroniclePipelineRuns.id, id)).get()!
}

function failActivityPipelineRun(
  segmentId: string,
  runId: string,
  stage: ActivityPipelineStage,
  message: string,
): ActivityPipelineActionResult {
  const endedAt = currentUnixSeconds()
  db().update(chronicleActivitySegments).set({
    pipelineStatus: 'error',
    updatedAt: endedAt,
  }).where(eq(chronicleActivitySegments.id, segmentId)).run()
  db().update(chroniclePipelineRuns).set({
    status: 'error',
    endedAt,
    errorMessage: message,
    updatedAt: endedAt,
  }).where(eq(chroniclePipelineRuns.id, runId)).run()
  recordEvent({
    type: 'activity',
    status: 'error',
    message,
    attrs: { segmentId, runId, stage },
  })
  return {
    segment: toActivitySegmentEntry(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, segmentId)).get()!),
    run: toPipelineRunEntry(db().select().from(chroniclePipelineRuns).where(eq(chroniclePipelineRuns.id, runId)).get()!),
    memoryId: null,
    status: 'error',
    message,
  }
}

function buildActivityTriagePrompt(context: ActivitySegmentContext): string {
  return [
    'You are Cradle Chronicle triage. Decide whether this desktop activity segment is worth keeping as long-term memory.',
    'Return only compact JSON with keys: keep boolean, reason string, segmentType one of work|meeting|browsing|chat|audio|idle|unknown, title string|null, priority one of low|normal|high.',
    'Keep useful project work, decisions, meetings, Slack coordination, debugging, and concrete user intent. Skip idle, empty, duplicated, or privacy-sensitive noise.',
    '',
    context.evidenceText.slice(0, 16_000),
  ].join('\n')
}

function buildActivitySummaryPrompt(context: ActivitySegmentContext): string {
  return [
    'You are Cradle Chronicle crystallization. Turn this activity segment into a concise structured memory for future agent search.',
    'Return only compact JSON with keys: title string, summary string, keyPoints string[], entities string[], followUps string[].',
    'Prefer factual details, decisions, artifacts, blockers, file names, channels, and next actions. Do not invent missing facts.',
    '',
    context.evidenceText.slice(0, 20_000),
  ].join('\n')
}

function buildActivityCrystallizationPrompt(context: ActivitySegmentContext): string {
  return [
    'You are Cradle Chronicle knowledge crystallization. Convert this activity segment into durable knowledge cards for future agent search.',
    'Return only compact JSON with keys: summary string, knowledgeCards array, rejectedCount number.',
    'Each knowledgeCards item must contain: title string, content string, type one of fact|insight|decision|task|pattern, dimension one of technical|business|personal|project|general, confidence number between 0 and 1, tags string[], stableKey string.',
    'Use stableKey as a short deterministic identity for the same future fact. Prefer project/file/decision nouns over timestamps. Do not invent missing facts.',
    '',
    context.evidenceText.slice(0, 24_000),
  ].join('\n')
}

function parseActivityTriageResult(text: string): ActivityTriageResult {
  return ActivityTriageModelTextSchema.parse(text)
}

function parseActivitySummaryResult(text: string): ActivitySummaryResult {
  return ActivitySummaryModelTextSchema.parse(text)
}

function parseActivityCrystallizationResult(text: string): ActivityCrystallizationResult {
  return ActivityCrystallizationModelTextSchema.parse(text)
}

function buildActivitySummaryMemoryContent(context: ActivitySegmentContext, summary: ActivitySummaryResult): string {
  const parts = [
    `Activity: ${summary.title}`,
    '',
    summary.summary,
  ]
  if (summary.keyPoints.length > 0) {
    parts.push('', 'Key points:', ...summary.keyPoints.map(point => `- ${point}`))
  }
  if (summary.followUps.length > 0) {
    parts.push('', 'Follow-ups:', ...summary.followUps.map(item => `- ${item}`))
  }
  if (summary.entities.length > 0) {
    parts.push('', `Entities: ${summary.entities.join(', ')}`)
  }
  parts.push('', `Source segment: ${context.segment.id}`)
  return parts.join('\n').trim()
}

function upsertKnowledgeCardFromDraft(
  tx: ChronicleTx,
  input: {
    draft: CrystallizedKnowledgeCardDraft
    context: ActivitySegmentContext
    runId: string
    modelId: string
    profileId: string
    evidenceHash: string
    memoryIds: string[]
    now: number
  },
): { card: typeof chronicleKnowledgeCards.$inferSelect, versionId: string } {
  const contentHash = hashText(canonicalizeMemoryContent(`${input.draft.title}\n${input.draft.content}`))
  const existing = tx
    .select()
    .from(chronicleKnowledgeCards)
    .where(eq(chronicleKnowledgeCards.stableKey, input.draft.stableKey))
    .all()
    .find(row => row.workspaceId === input.context.segment.workspaceId && row.status !== 'deleted')
  const sourceSegmentIds = uniqueStrings([
    ...(existing ? parseJson<string[]>(existing.sourceSegmentIdsJson, []) : []),
    input.context.segment.id,
  ])
  const sourceMemoryIds = uniqueStrings([
    ...(existing ? parseJson<string[]>(existing.sourceMemoryIdsJson, []) : []),
    ...input.memoryIds,
  ])
  const sourceChunkIds = existing ? parseJson<string[]>(existing.sourceChunkIdsJson, []) : []
  const tags = uniqueStrings([
    ...(existing ? parseJson<string[]>(existing.tagsJson, []) : []),
    ...input.draft.tags,
  ]).slice(0, 24)
  const previousMetadata = existing ? parseJson<Record<string, unknown>>(existing.metadataJson, {}) : {}
  const metadata = {
    ...previousMetadata,
    stableKey: input.draft.stableKey,
    lastEvidenceHash: input.evidenceHash,
    lastPipelineRunId: input.runId,
    lastModelId: input.modelId,
    lastProfileId: input.profileId,
    updatedBy: 'activity-crystallization',
  }

  let knowledgeId = existing?.id ?? randomUUID()
  let version = existing?.version ?? 0
  const materialChanged = !existing
    || existing.title !== input.draft.title
    || existing.content !== input.draft.content
    || existing.cardType !== input.draft.cardType
    || existing.dimension !== input.draft.dimension
    || existing.confidenceBps !== input.draft.confidenceBps
    || existing.contentHash !== contentHash

  if (!existing) {
    version = 1
    tx.insert(chronicleKnowledgeCards).values({
      id: knowledgeId,
      workspaceId: input.context.segment.workspaceId,
      title: input.draft.title,
      content: input.draft.content,
      cardType: input.draft.cardType,
      dimension: input.draft.dimension,
      confidenceBps: input.draft.confidenceBps,
      sourceMemoryIdsJson: JSON.stringify(sourceMemoryIds),
      sourceSegmentIdsJson: JSON.stringify(sourceSegmentIds),
      sourceChunkIdsJson: JSON.stringify(sourceChunkIds),
      tagsJson: JSON.stringify(tags),
      stableKey: input.draft.stableKey,
      contentHash,
      version,
      status: 'active',
      mergedIntoId: null,
      pinned: false,
      sortOrder: 0,
      metadataJson: JSON.stringify(metadata),
      createdAt: input.now,
      updatedAt: input.now,
    }).run()
  }
  else if (materialChanged) {
    version = existing.version + 1
    tx.update(chronicleKnowledgeCards).set({
      title: input.draft.title,
      content: input.draft.content,
      cardType: input.draft.cardType,
      dimension: input.draft.dimension,
      confidenceBps: input.draft.confidenceBps,
      sourceMemoryIdsJson: JSON.stringify(sourceMemoryIds),
      sourceSegmentIdsJson: JSON.stringify(sourceSegmentIds),
      sourceChunkIdsJson: JSON.stringify(sourceChunkIds),
      tagsJson: JSON.stringify(tags),
      contentHash,
      version,
      status: 'active',
      metadataJson: JSON.stringify(metadata),
      updatedAt: input.now,
    }).where(eq(chronicleKnowledgeCards.id, existing.id)).run()
  }
  else {
    knowledgeId = existing.id
    version = existing.version
    tx.update(chronicleKnowledgeCards).set({
      sourceMemoryIdsJson: JSON.stringify(sourceMemoryIds),
      sourceSegmentIdsJson: JSON.stringify(sourceSegmentIds),
      sourceChunkIdsJson: JSON.stringify(sourceChunkIds),
      tagsJson: JSON.stringify(tags),
      metadataJson: JSON.stringify(metadata),
      updatedAt: input.now,
    }).where(eq(chronicleKnowledgeCards.id, existing.id)).run()
  }

  const versionId = getOrCreateKnowledgeVersion(tx, {
    knowledgeId,
    version,
    title: input.draft.title,
    content: input.draft.content,
    cardType: input.draft.cardType,
    dimension: input.draft.dimension,
    confidenceBps: input.draft.confidenceBps,
    sourceMemoryIds,
    sourceSegmentIds,
    sourceChunkIds,
    tags,
    metadata: {
      evidenceHash: input.evidenceHash,
      pipelineRunId: input.runId,
      modelId: input.modelId,
      profileId: input.profileId,
      materialChanged,
    },
    now: input.now,
  })
  insertKnowledgeSources(tx, {
    knowledgeId,
    versionId,
    context: input.context,
    runId: input.runId,
    memoryIds: input.memoryIds,
    evidenceHash: input.evidenceHash,
    now: input.now,
  })

  return {
    card: tx.select().from(chronicleKnowledgeCards).where(eq(chronicleKnowledgeCards.id, knowledgeId)).get()!,
    versionId,
  }
}

function getOrCreateKnowledgeVersion(
  tx: ChronicleTx,
  input: {
    knowledgeId: string
    version: number
    title: string
    content: string
    cardType: KnowledgeCardType
    dimension: KnowledgeDimension
    confidenceBps: number
    sourceMemoryIds: string[]
    sourceSegmentIds: string[]
    sourceChunkIds: string[]
    tags: string[]
    metadata: Record<string, unknown>
    now: number
  },
): string {
  const existing = tx
    .select({ id: chronicleKnowledgeVersions.id })
    .from(chronicleKnowledgeVersions)
    .where(sql`${chronicleKnowledgeVersions.knowledgeId} = ${input.knowledgeId} AND ${chronicleKnowledgeVersions.version} = ${input.version}`)
    .get()
  if (existing) {
    return existing.id
  }
  const id = randomUUID()
  tx.insert(chronicleKnowledgeVersions).values({
    id,
    knowledgeId: input.knowledgeId,
    version: input.version,
    title: input.title,
    content: input.content,
    cardType: input.cardType,
    dimension: input.dimension,
    confidenceBps: input.confidenceBps,
    sourceMemoryIdsJson: JSON.stringify(input.sourceMemoryIds),
    sourceSegmentIdsJson: JSON.stringify(input.sourceSegmentIds),
    sourceChunkIdsJson: JSON.stringify(input.sourceChunkIds),
    tagsJson: JSON.stringify(input.tags),
    metadataJson: JSON.stringify(input.metadata),
    createdAt: input.now,
  }).run()
  return id
}

function insertKnowledgeSources(
  tx: ChronicleTx,
  input: {
    knowledgeId: string
    versionId: string
    context: ActivitySegmentContext
    runId: string
    memoryIds: string[]
    evidenceHash: string
    now: number
  },
): void {
  const sources = [
    { sourceKind: 'activity' as const, evidenceType: 'activity-segment', evidenceId: input.context.segment.id, memoryId: null as string | null },
    ...input.memoryIds.map(memoryId => ({ sourceKind: 'memory' as const, evidenceType: 'memory', evidenceId: memoryId, memoryId })),
  ]
  for (const source of sources) {
    const exists = tx
      .select({ id: chronicleKnowledgeSources.id })
      .from(chronicleKnowledgeSources)
      .where(sql`${chronicleKnowledgeSources.knowledgeId} = ${input.knowledgeId} AND ${chronicleKnowledgeSources.versionId} = ${input.versionId} AND ${chronicleKnowledgeSources.evidenceType} = ${source.evidenceType} AND ${chronicleKnowledgeSources.evidenceId} = ${source.evidenceId}`)
      .get()
    if (exists) {
      continue
    }
    tx.insert(chronicleKnowledgeSources).values({
      id: randomUUID(),
      knowledgeId: input.knowledgeId,
      versionId: input.versionId,
      segmentId: input.context.segment.id,
      memoryId: source.memoryId,
      memoryChunkId: null,
      pipelineRunId: input.runId,
      sourceKind: source.sourceKind,
      evidenceType: source.evidenceType,
      evidenceId: source.evidenceId,
      metadataJson: JSON.stringify({ evidenceHash: input.evidenceHash }),
      createdAt: input.now,
      updatedAt: input.now,
    }).run()
  }
}

function buildDreamMergeCandidates(
  cards: Array<typeof chronicleKnowledgeCards.$inferSelect>,
  threshold: number,
): DreamMergeCandidateDraft[] {
  const candidates: DreamMergeCandidateDraft[] = []
  const used = new Set<string>()
  for (const card of cards) {
    if (used.has(card.id)) {
      continue
    }
    const cardEmbedding = buildTextEmbeddingVector(`${card.title}\n${card.content}`)
    const matches = cards
      .filter(candidate => candidate.id !== card.id
        && !used.has(candidate.id)
        && candidate.workspaceId === card.workspaceId
        && candidate.dimension === card.dimension
        && candidate.status === 'active')
      .map((candidate) => {
        const candidateEmbedding = buildTextEmbeddingVector(`${candidate.title}\n${candidate.content}`)
        const score = cardEmbedding.modelId === candidateEmbedding.modelId && cardEmbedding.modelVersion === candidateEmbedding.modelVersion
          ? cosineSimilarity(cardEmbedding.vector, candidateEmbedding.vector)
          : 0
        return { card: candidate, score }
      })
      .filter(match => match.score >= threshold)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
    if (matches.length === 0) {
      continue
    }
    const group = [card, ...matches.map(match => match.card)]
    for (const item of group) {
      used.add(item.id)
    }
    const bestScore = matches[0]?.score ?? threshold
    candidates.push({
      workspaceId: card.workspaceId,
      sourceKnowledgeIds: group.map(item => item.id),
      proposedTitle: chooseDreamMergedTitle(group),
      proposedContent: group.map(item => item.content.trim()).filter(Boolean).join('\n\n'),
      proposedCardType: chooseDreamMergedCardType(group),
      proposedDimension: card.dimension,
      score: bestScore,
      reason: `Semantic similarity ${bestScore.toFixed(3)} using ${cardEmbedding.modelId}/${cardEmbedding.modelVersion}`,
      vectorMode: `${cardEmbedding.modelId}/${cardEmbedding.modelVersion}`,
    })
  }
  return candidates
}

function applyDreamMergeCandidate(
  tx: ChronicleTx,
  candidate: DreamMergeCandidateDraft,
  runId: string,
  now: number,
): string {
  const sourceCards = tx
    .select()
    .from(chronicleKnowledgeCards)
    .where(inArray(chronicleKnowledgeCards.id, candidate.sourceKnowledgeIds))
    .all()
  const sourceMemoryIds = uniqueStrings(sourceCards.flatMap(card => parseJson<string[]>(card.sourceMemoryIdsJson, [])))
  const sourceSegmentIds = uniqueStrings(sourceCards.flatMap(card => parseJson<string[]>(card.sourceSegmentIdsJson, [])))
  const sourceChunkIds = uniqueStrings(sourceCards.flatMap(card => parseJson<string[]>(card.sourceChunkIdsJson, [])))
  const tags = uniqueStrings(sourceCards.flatMap(card => parseJson<string[]>(card.tagsJson, []))).slice(0, 24)
  const stableKey = `dream-merge:${hashText(candidate.sourceKnowledgeIds.slice().sort().join('|')).slice(0, 32)}`
  const contentHash = hashText(canonicalizeMemoryContent(`${candidate.proposedTitle}\n${candidate.proposedContent}`))
  const outputId = randomUUID()

  tx.insert(chronicleKnowledgeCards).values({
    id: outputId,
    workspaceId: candidate.workspaceId,
    title: candidate.proposedTitle,
    content: candidate.proposedContent,
    cardType: candidate.proposedCardType,
    dimension: candidate.proposedDimension,
    confidenceBps: Math.max(1, Math.min(10_000, ratioToBps(candidate.score))),
    sourceMemoryIdsJson: JSON.stringify(sourceMemoryIds),
    sourceSegmentIdsJson: JSON.stringify(sourceSegmentIds),
    sourceChunkIdsJson: JSON.stringify(sourceChunkIds),
    tagsJson: JSON.stringify(tags),
    stableKey,
    contentHash,
    version: 1,
    status: 'active',
    mergedIntoId: null,
    pinned: false,
    sortOrder: 0,
    metadataJson: JSON.stringify({
      source: 'dream-merge',
      runId,
      mergedFromIds: candidate.sourceKnowledgeIds,
      vectorMode: candidate.vectorMode,
    }),
    createdAt: now,
    updatedAt: now,
  }).run()

  tx.insert(chronicleKnowledgeVersions).values({
    id: randomUUID(),
    knowledgeId: outputId,
    version: 1,
    title: candidate.proposedTitle,
    content: candidate.proposedContent,
    cardType: candidate.proposedCardType,
    dimension: candidate.proposedDimension,
    confidenceBps: Math.max(1, Math.min(10_000, ratioToBps(candidate.score))),
    sourceMemoryIdsJson: JSON.stringify(sourceMemoryIds),
    sourceSegmentIdsJson: JSON.stringify(sourceSegmentIds),
    sourceChunkIdsJson: JSON.stringify(sourceChunkIds),
    tagsJson: JSON.stringify(tags),
    metadataJson: JSON.stringify({
      source: 'dream-merge',
      runId,
      mergedFromIds: candidate.sourceKnowledgeIds,
    }),
    createdAt: now,
  }).run()

  for (const source of sourceCards) {
    tx.update(chronicleKnowledgeCards).set({
      version: source.version + 1,
      status: 'merged',
      mergedIntoId: outputId,
      updatedAt: now,
      metadataJson: JSON.stringify({
        ...parseJson<Record<string, unknown>>(source.metadataJson, {}),
        mergedByRunId: runId,
        mergedIntoId: outputId,
      }),
    }).where(eq(chronicleKnowledgeCards.id, source.id)).run()
    tx.insert(chronicleKnowledgeVersions).values({
      id: randomUUID(),
      knowledgeId: source.id,
      version: source.version + 1,
      title: source.title,
      content: source.content,
      cardType: source.cardType,
      dimension: source.dimension,
      confidenceBps: source.confidenceBps,
      sourceMemoryIdsJson: source.sourceMemoryIdsJson,
      sourceSegmentIdsJson: source.sourceSegmentIdsJson,
      sourceChunkIdsJson: source.sourceChunkIdsJson,
      tagsJson: source.tagsJson,
      metadataJson: JSON.stringify({
        source: 'dream-merge-mark-merged',
        runId,
        mergedIntoId: outputId,
      }),
      createdAt: now,
    }).run()
  }

  return outputId
}

function chooseDreamMergedTitle(cards: Array<typeof chronicleKnowledgeCards.$inferSelect>): string {
  return cards
    .slice()
    .sort((left, right) => right.confidenceBps - left.confidenceBps || left.title.length - right.title.length)[0]
    ?.title ?? 'Merged knowledge'
}

function chooseDreamMergedCardType(cards: Array<typeof chronicleKnowledgeCards.$inferSelect>): KnowledgeCardType {
  const priority: KnowledgeCardType[] = ['decision', 'task', 'insight', 'pattern', 'fact']
  return priority.find(type => cards.some(card => card.cardType === type)) ?? 'fact'
}

interface ActivityAssignmentInput {
  trigger: ActivityPipelineTrigger
  workspaceId: string | null
  occurredAt: number
  segmentType: ActivitySegmentType
  frontApp: string | null
  title: string | null
  summary?: string | null
  refs: Partial<Record<'snapshotIds' | 'messageIds' | 'audioTranscriptIds' | 'audioRawSegmentIds' | 'memoryIds' | 'accessibilitySnapshotIds', string[]>>
  metadata?: Record<string, unknown>
}

function assignActivityEvidence(input: ActivityAssignmentInput): { sessionId: string, segmentId: string } {
  const now = currentUnixSeconds()
  return db().transaction((tx) => {
    const session = findActivitySession(tx, input.workspaceId, input.occurredAt, now, input)
    const candidate = findActivitySegmentCandidate(tx, session.id, input)
    const shouldAppend = !!candidate
    const segmentId = shouldAppend && candidate ? candidate.id : randomUUID()
    const sourceRefs = mergeActivitySourceRefs(candidate?.sourceRefsJson, input.refs)
    const sourceCounts = countActivitySourceRefs(sourceRefs)
    const metadata = {
      ...(candidate ? parseJson<Record<string, unknown>>(candidate.metadataJson, {}) : {}),
      ...(input.metadata ?? {}),
    }
    const startedAt = candidate && shouldAppend ? Math.min(candidate.startedAt, input.occurredAt) : input.occurredAt
    const endedAt = candidate && shouldAppend ? Math.max(candidate.endedAt, input.occurredAt) : input.occurredAt
    const startSnapshotId = candidate?.startSnapshotId ?? firstSourceRef(sourceRefs.snapshotIds) ?? null
    const endSnapshotId = lastSourceRef(sourceRefs.snapshotIds) ?? candidate?.endSnapshotId ?? null

    if (candidate && shouldAppend) {
      tx.update(chronicleActivitySegments).set({
        startSnapshotId,
        endSnapshotId,
        startedAt,
        endedAt,
        segmentType: chooseActivitySegmentType(candidate.segmentType, input.segmentType),
        frontApp: input.frontApp ?? candidate.frontApp,
        title: input.title ?? candidate.title,
        summary: input.summary ?? candidate.summary,
        sourceCountsJson: JSON.stringify(sourceCounts),
        sourceRefsJson: JSON.stringify(sourceRefs),
        metadataJson: JSON.stringify(metadata),
        updatedAt: now,
      }).where(eq(chronicleActivitySegments.id, candidate.id)).run()
    }
    else {
      tx.insert(chronicleActivitySegments).values({
        id: segmentId,
        sessionId: session.id,
        workspaceId: input.workspaceId,
        startSnapshotId,
        endSnapshotId,
        startedAt: input.occurredAt,
        endedAt: input.occurredAt,
        segmentType: input.segmentType,
        frontApp: input.frontApp,
        title: input.title,
        summary: input.summary ?? null,
        sourceCountsJson: JSON.stringify(sourceCounts),
        sourceRefsJson: JSON.stringify(sourceRefs),
        metadataJson: JSON.stringify(metadata),
        pipelineStatus: 'collecting',
        isCrystallized: false,
        createdAt: now,
        updatedAt: now,
      }).run()
    }

    recordSegmentationRun(tx, input, session.id, segmentId, now)

    refreshActivitySession(tx, session.id, now)
    return { sessionId: session.id, segmentId }
  })
}

function recordSegmentationRun(
  tx: ChronicleTx,
  input: ActivityAssignmentInput,
  sessionId: string,
  segmentId: string,
  now: number,
): void {
  const sourceKey = buildPipelineSourceKey(input)
  const existing = tx
    .select({ id: chroniclePipelineRuns.id })
    .from(chroniclePipelineRuns)
    .where(eq(chroniclePipelineRuns.sourceKey, sourceKey))
    .get()
  const values = {
    sessionId,
    segmentId,
    workspaceId: input.workspaceId,
    trigger: input.trigger,
    sourceKey,
    stage: 'segmentation' as const,
    status: 'running' as const,
    startedAt: input.occurredAt,
    endedAt: null,
    errorMessage: null,
    snapshotIdsJson: JSON.stringify(input.refs.snapshotIds ?? []),
    messageIdsJson: JSON.stringify(input.refs.messageIds ?? []),
    audioTranscriptIdsJson: JSON.stringify(input.refs.audioTranscriptIds ?? []),
    audioRawSegmentIdsJson: JSON.stringify(input.refs.audioRawSegmentIds ?? []),
    memoryIdsJson: JSON.stringify(input.refs.memoryIds ?? []),
    segmentIdsJson: JSON.stringify([segmentId]),
    snapshotsCount: input.refs.snapshotIds?.length ?? 0,
    messagesCount: input.refs.messageIds?.length ?? 0,
    audioTranscriptsCount: input.refs.audioTranscriptIds?.length ?? 0,
    audioRawSegmentsCount: input.refs.audioRawSegmentIds?.length ?? 0,
    memoriesCount: input.refs.memoryIds?.length ?? 0,
    segmentsCount: 1,
    triageResultsJson: '{}',
    summaryResultsJson: '{}',
    metadataJson: JSON.stringify({
      ...(input.metadata ?? {}),
      pendingStages: ['triage', 'summarization', 'crystallization'],
    }),
    updatedAt: now,
  }

  if (existing) {
    tx.update(chroniclePipelineRuns).set(values).where(eq(chroniclePipelineRuns.id, existing.id)).run()
    return
  }

  tx.insert(chroniclePipelineRuns).values({
    id: randomUUID(),
    ...values,
    createdAt: now,
  }).run()
}

function buildPipelineSourceKey(input: ActivityAssignmentInput): string {
  const refs = ActivitySourceRefsSchema.parse(input.refs)
  const parts = [
    ...refs.snapshotIds.map(id => `snapshot:${id}`),
    ...refs.messageIds.map(id => `message:${id}`),
    ...refs.audioTranscriptIds.map(id => `audio-transcript:${id}`),
    ...refs.audioRawSegmentIds.map(id => `audio-raw:${id}`),
    ...refs.memoryIds.map(id => `memory:${id}`),
    ...refs.accessibilitySnapshotIds.map(id => `accessibility:${id}`),
  ].sort()
  return `${input.trigger}:${parts.join('|') || `${input.workspaceId ?? 'global'}:${input.occurredAt}`}`
}

function findActivitySession(
  tx: ChronicleTx,
  workspaceId: string | null,
  occurredAt: number,
  now: number,
  input: ActivityAssignmentInput,
): typeof chronicleActivitySessions.$inferSelect {
  const existing = tx
    .select()
    .from(chronicleActivitySessions)
    .where(workspaceId === null
      ? sql`${chronicleActivitySessions.workspaceId} IS NULL`
      : eq(chronicleActivitySessions.workspaceId, workspaceId))
    .all()
    .find(session => occurredAt >= session.startedAt - ACTIVITY_SESSION_GAP_SECONDS
      && occurredAt <= (session.endedAt ?? session.startedAt) + ACTIVITY_SESSION_GAP_SECONDS)

  if (existing) {
    return existing
  }

  const id = randomUUID()
  tx.insert(chronicleActivitySessions).values({
    id,
    workspaceId,
    startedAt: occurredAt,
    endedAt: occurredAt,
    frontApp: input.frontApp,
    title: input.title,
    segmentCount: 0,
    snapshotCount: 0,
    messageCount: 0,
    audioTranscriptCount: 0,
    audioRawSegmentCount: 0,
    accessibilitySnapshotCount: 0,
    durationSeconds: 0,
    isMeeting: input.segmentType === 'meeting',
    meetingTitle: input.segmentType === 'meeting' ? input.title : null,
    metadataJson: JSON.stringify({ createdFrom: input.trigger }),
    createdAt: now,
    updatedAt: now,
  }).run()
  return tx.select().from(chronicleActivitySessions).where(eq(chronicleActivitySessions.id, id)).get()!
}

function findActivitySegmentCandidate(
  tx: ChronicleTx,
  sessionId: string,
  input: ActivityAssignmentInput,
): typeof chronicleActivitySegments.$inferSelect | undefined {
  return tx
    .select()
    .from(chronicleActivitySegments)
    .where(input.workspaceId === null
      ? sql`${chronicleActivitySegments.sessionId} = ${sessionId} AND ${chronicleActivitySegments.workspaceId} IS NULL`
      : sql`${chronicleActivitySegments.sessionId} = ${sessionId} AND ${chronicleActivitySegments.workspaceId} = ${input.workspaceId}`)
    .orderBy(desc(chronicleActivitySegments.startedAt))
    .all()
    .find(segment => canAppendActivitySegment(segment, input))
}

function canAppendActivitySegment(
  candidate: typeof chronicleActivitySegments.$inferSelect,
  input: ActivityAssignmentInput,
): boolean {
  if (input.occurredAt < candidate.startedAt || input.occurredAt < candidate.endedAt) {
    return false
  }
  const gapSeconds = input.occurredAt - candidate.endedAt
  if (gapSeconds > ACTIVITY_IDLE_BOUNDARY_SECONDS) {
    return false
  }
  if (input.occurredAt - candidate.startedAt > ACTIVITY_MAX_SEGMENT_SECONDS) {
    return false
  }
  return normalizeActivityBoundary(candidate.frontApp) === normalizeActivityBoundary(input.frontApp)
    && normalizeActivityBoundary(candidate.title) === normalizeActivityBoundary(input.title)
}

function chooseActivitySegmentType(current: ActivitySegmentType, next: ActivitySegmentType): ActivitySegmentType {
  if (current === next) {
    return current
  }
  if (current === 'unknown') {
    return next
  }
  if (next === 'unknown') {
    return current
  }
  if (current === 'meeting' || next === 'meeting') {
    return 'meeting'
  }
  if (current === 'chat' || next === 'chat') {
    return 'chat'
  }
  if (current === 'audio' || next === 'audio') {
    return 'audio'
  }
  return 'work'
}

function refreshActivitySession(tx: ChronicleTx, sessionId: string, now: number): void {
  const segments = tx.select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.sessionId, sessionId)).all()
  if (segments.length === 0) {
    return
  }

  const startedAt = Math.min(...segments.map(segment => segment.startedAt))
  const endedAt = Math.max(...segments.map(segment => segment.endedAt))
  const counts = segments.reduce((accumulator, segment) => {
    const sourceCounts = parseJson<Record<string, number>>(segment.sourceCountsJson, {})
    accumulator.snapshotCount += readCount(sourceCounts.snapshotIds)
    accumulator.messageCount += readCount(sourceCounts.messageIds)
    accumulator.audioTranscriptCount += readCount(sourceCounts.audioTranscriptIds)
    accumulator.audioRawSegmentCount += readCount(sourceCounts.audioRawSegmentIds)
    accumulator.accessibilitySnapshotCount += readCount(sourceCounts.accessibilitySnapshotIds)
    return accumulator
  }, {
    snapshotCount: 0,
    messageCount: 0,
    audioTranscriptCount: 0,
    audioRawSegmentCount: 0,
    accessibilitySnapshotCount: 0,
  })
  const first = segments.reduce((left, right) => left.startedAt <= right.startedAt ? left : right)
  const hasMeeting = segments.some(segment => segment.segmentType === 'meeting')

  tx.update(chronicleActivitySessions).set({
    startedAt,
    endedAt,
    frontApp: first.frontApp,
    title: first.title,
    segmentCount: segments.length,
    snapshotCount: counts.snapshotCount,
    messageCount: counts.messageCount,
    audioTranscriptCount: counts.audioTranscriptCount,
    audioRawSegmentCount: counts.audioRawSegmentCount,
    accessibilitySnapshotCount: counts.accessibilitySnapshotCount,
    durationSeconds: Math.max(0, endedAt - startedAt),
    isMeeting: hasMeeting,
    meetingTitle: hasMeeting ? segments.find(segment => segment.segmentType === 'meeting')?.title ?? null : null,
    updatedAt: now,
  }).where(eq(chronicleActivitySessions.id, sessionId)).run()
}

function mergeActivitySourceRefs(
  currentJson: string | undefined,
  next: ActivityAssignmentInput['refs'],
): Record<string, string[]> {
  const current = ActivitySourceRefsJsonSchema.parse(currentJson)
  const nextRefs = ActivitySourceRefsSchema.parse(next)
  const merged: Record<string, string[]> = {}
  for (const key of ['snapshotIds', 'messageIds', 'audioTranscriptIds', 'audioRawSegmentIds', 'memoryIds', 'accessibilitySnapshotIds']) {
    merged[key] = uniqueStrings([
      ...current[key],
      ...nextRefs[key],
    ])
  }
  return merged
}

function countActivitySourceRefs(sourceRefs: Record<string, string[]>): Record<string, number> {
  return Object.fromEntries(Object.entries(sourceRefs).map(([key, values]) => [key, values.length]))
}

function firstSourceRef(values: string[] | undefined): string | null {
  return values && values.length > 0 ? values[0] : null
}

function lastSourceRef(values: string[] | undefined): string | null {
  return values && values.length > 0 ? values[values.length - 1] : null
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(value => value.length > 0))]
}

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

interface SpeakerProfileUpsertInput {
  workspaceId: string | null
  displayName: string
  aliases?: string[]
  embedding?: number[] | null
  embeddingModelId?: string | null
  sampleCount?: number
  seenAt?: number | null
  transcriptId?: string | null
  segmentId?: string | null
  metadata?: Record<string, unknown>
  now?: number
}

function upsertSpeakerProfileFromLabel(
  d: ChronicleDb | ChronicleTx,
  input: SpeakerProfileUpsertInput,
): typeof chronicleSpeakerProfiles.$inferSelect {
  const now = input.now ?? currentUnixSeconds()
  const displayName = normalizeSpeakerDisplayName(input.displayName)
  const normalizedLabel = normalizeSpeakerLabel(displayName)
  const workspaceId = input.workspaceId || null
  const stableKey = buildSpeakerStableKey(workspaceId, normalizedLabel)
  const existing = d
    .select()
    .from(chronicleSpeakerProfiles)
    .where(eq(chronicleSpeakerProfiles.stableKey, stableKey))
    .get()
  const nextAliases = normalizeSpeakerAliases([
    ...(existing ? parseJson<string[]>(existing.aliasesJson, []) : []),
    ...(input.aliases ?? []),
    displayName,
  ])
  const sampleDelta = input.sampleCount ?? 1
  const nextSampleCount = Math.max(0, (existing?.sampleCount ?? 0) + sampleDelta)
  const existingMetadata = existing ? parseJson<Record<string, unknown>>(existing.metadataJson, {}) : {}
  const metadata = {
    ...existingMetadata,
    ...(input.metadata ?? {}),
  }
  const embeddingJson = input.embedding === undefined
    ? existing?.embeddingJson ?? null
    : input.embedding === null
      ? null
      : JSON.stringify(input.embedding)
  const embeddingDimensions = input.embedding === undefined
    ? existing?.embeddingDimensions ?? null
    : input.embedding === null
      ? null
      : input.embedding.length
  const embeddingModelId = input.embedding === undefined
    ? existing?.embeddingModelId ?? null
    : input.embedding === null
      ? null
      : input.embeddingModelId ?? existing?.embeddingModelId ?? 'speaker-embedding-extractor'
  const lastSeenAt = input.seenAt ?? existing?.lastSeenAt ?? null

  if (existing) {
    d.update(chronicleSpeakerProfiles).set({
      displayName,
      normalizedLabel,
      aliasesJson: JSON.stringify(nextAliases),
      embeddingJson,
      embeddingDimensions,
      embeddingModelId,
      sampleCount: nextSampleCount,
      lastSeenAt,
      sourceTranscriptId: input.transcriptId ?? existing.sourceTranscriptId,
      sourceSegmentId: input.segmentId ?? existing.sourceSegmentId,
      metadataJson: JSON.stringify(metadata),
      updatedAt: now,
    }).where(eq(chronicleSpeakerProfiles.id, existing.id)).run()
    return d.select().from(chronicleSpeakerProfiles).where(eq(chronicleSpeakerProfiles.id, existing.id)).get()!
  }

  const id = randomUUID()
  d.insert(chronicleSpeakerProfiles).values({
    id,
    workspaceId,
    stableKey,
    displayName,
    normalizedLabel,
    aliasesJson: JSON.stringify(nextAliases),
    embeddingJson,
    embeddingDimensions,
    embeddingModelId,
    sampleCount: nextSampleCount,
    lastSeenAt,
    sourceTranscriptId: input.transcriptId ?? null,
    sourceSegmentId: input.segmentId ?? null,
    metadataJson: JSON.stringify(metadata),
    createdAt: now,
    updatedAt: now,
  }).run()
  return d.select().from(chronicleSpeakerProfiles).where(eq(chronicleSpeakerProfiles.id, id)).get()!
}

function normalizeSpeakerDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    throw new AppError({
      code: 'chronicle_speaker_profile_name_required',
      status: 400,
      message: 'Speaker displayName is required',
    })
  }
  return normalized
}

function normalizeSpeakerLabel(value: string): string {
  return normalizeSpeakerDisplayName(value).toLocaleLowerCase()
}

function normalizeSpeakerAliases(values: string[]): string[] {
  const aliases = values
    .map(value => value.trim().replace(/\s+/g, ' '))
    .filter(value => value.length > 0)
  return [...new Map(aliases.map(value => [value.toLocaleLowerCase(), value])).values()]
}

function normalizeSpeakerEmbedding(value: number[] | null): number[] | null {
  if (value === null) {
    return null
  }
  const vector = value.map(item => Number(item))
  if (vector.length === 0 || vector.some(item => !Number.isFinite(item))) {
    throw new AppError({
      code: 'chronicle_speaker_profile_embedding_invalid',
      status: 400,
      message: 'Speaker embedding must contain finite numeric values',
    })
  }
  return vector
}

function buildSpeakerStableKey(workspaceId: string | null, normalizedLabel: string): string {
  return `${workspaceId ?? 'global'}:${normalizedLabel}`
}

function normalizeActivityBoundary(value: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

export function recordAudioRawSegment(input: AudioRawSegmentReportInput): AudioRawSegmentEntry {
  const config = syncConfig()
  const now = currentUnixSeconds()
  const recordedAt = readRequiredAudioRawSegmentTimestamp(input.recordedAt)
  const existing = db()
    .select()
    .from(chronicleAudioRawSegments)
    .where(eq(chronicleAudioRawSegments.sourceId, input.sourceId))
    .get()
  const id = existing?.id ?? randomUUID()
  const durationMs = input.durationMs ?? estimateAudioDurationMs(input.sampleCount, input.sampleRate)
  const metadata = {
    ...(input.metadata ?? {}),
    vadImplemented: input.vadImplemented ?? false,
    asrImplemented: input.asrImplemented ?? false,
    speakerLabelingImplemented: input.speakerLabelingImplemented ?? false,
  }
  const values = {
    sourceId: input.sourceId,
    workspaceId: config.workspaceId || null,
    recordedAt,
    source: input.source ?? 'microphone',
    status: input.status ?? 'captured',
    audioPath: toRootRelative(config.storageRoot, input.audioPath),
    metadataPath: toRootRelative(config.storageRoot, input.metadataPath),
    sampleRate: Math.floor(input.sampleRate),
    channels: Math.floor(input.channels),
    sampleCount: Math.floor(input.sampleCount),
    droppedSamples: Math.floor(input.droppedSamples ?? 0),
    durationMs,
    rmsBps: ratioToBps(input.rms),
    peakBps: ratioToBps(input.peak),
    active: input.active,
    vadStatus: input.vadImplemented ? 'pending' as const : 'not-implemented' as const,
    asrStatus: input.asrImplemented ? 'pending' as const : 'not-implemented' as const,
    speakerStatus: input.speakerLabelingImplemented ? 'pending' as const : 'not-implemented' as const,
    metadataJson: JSON.stringify(metadata),
    updatedAt: now,
  }

  if (existing) {
    db().update(chronicleAudioRawSegments).set(values).where(eq(chronicleAudioRawSegments.id, id)).run()
  }
  else {
    db().insert(chronicleAudioRawSegments).values({
      id,
      ...values,
      createdAt: now,
    }).run()
  }

  recordEvent({
    type: 'audio',
    status: values.status === 'error' ? 'error' : 'success',
    message: 'Chronicle raw audio segment ingested',
    attrs: {
      sourceId: input.sourceId,
      rawSegmentId: id,
      active: input.active,
      durationMs,
      audioPath: values.audioPath,
    },
  })
  if (!existing) {
    assignActivityEvidence({
      trigger: 'audio-raw',
      workspaceId: config.workspaceId || null,
      occurredAt: recordedAt,
      segmentType: 'audio',
      frontApp: input.source ?? 'microphone',
      title: input.active ? 'Audio activity' : 'Audio quiet segment',
      refs: { audioRawSegmentIds: [id] },
      metadata: {
        source: 'audio-raw-segment',
        rawSourceId: input.sourceId,
        active: input.active,
        status: values.status,
      },
    })
  }
  return toAudioRawSegmentEntry(db().select().from(chronicleAudioRawSegments).where(eq(chronicleAudioRawSegments.id, id)).get()!)
}

export function recordAudioRawSegmentProcessingResult(
  sourceId: string,
  input: AudioRawSegmentProcessingResultInput,
): AudioRawSegmentEntry {
  const row = db()
    .select()
    .from(chronicleAudioRawSegments)
    .where(eq(chronicleAudioRawSegments.sourceId, sourceId))
    .get()
  if (!row) {
    throw new AppError({
      code: 'chronicle_audio_raw_segment_not_found',
      status: 404,
      message: 'Chronicle raw audio segment not found',
    })
  }
  const metadata = {
    ...parseJson<Record<string, unknown>>(row.metadataJson, {}),
    ...(input.metadata ?? {}),
    processingResult: {
      transcriptSourceId: input.transcriptSourceId ?? null,
      speakerProfileIds: input.speakerProfileIds ?? [],
      errorMessage: input.errorMessage ?? null,
      updatedAt: currentUnixSeconds(),
    },
  }
  const status = input.status ?? deriveRawAudioStatus(input, row.status)
  db().update(chronicleAudioRawSegments).set({
    status,
    vadStatus: input.vadStatus ?? row.vadStatus,
    asrStatus: input.asrStatus ?? row.asrStatus,
    speakerStatus: input.speakerStatus ?? row.speakerStatus,
    metadataJson: JSON.stringify(metadata),
    updatedAt: currentUnixSeconds(),
  }).where(eq(chronicleAudioRawSegments.id, row.id)).run()
  recordEvent({
    type: 'audio',
    status: status === 'error' ? 'error' : 'success',
    message: 'Chronicle raw audio processing result recorded',
    attrs: {
      sourceId,
      rawSegmentId: row.id,
      status,
      vadStatus: input.vadStatus ?? row.vadStatus,
      asrStatus: input.asrStatus ?? row.asrStatus,
      speakerStatus: input.speakerStatus ?? row.speakerStatus,
      transcriptSourceId: input.transcriptSourceId ?? null,
    },
  })
  return toAudioRawSegmentEntry(db().select().from(chronicleAudioRawSegments).where(eq(chronicleAudioRawSegments.id, row.id)).get()!)
}

function deriveRawAudioStatus(
  input: AudioRawSegmentProcessingResultInput,
  currentStatus: AudioRawSegmentEntry['status'],
): AudioRawSegmentEntry['status'] {
  if ([input.vadStatus, input.asrStatus, input.speakerStatus].some(status => status === 'error')) {
    return 'error'
  }
  if ([input.vadStatus, input.asrStatus, input.speakerStatus].some(status => status === 'pending')) {
    return 'queued'
  }
  if ([input.vadStatus, input.asrStatus, input.speakerStatus].some(status => status === 'ready')) {
    return 'processed'
  }
  return currentStatus
}

export function recordAudioTranscript(input: AudioTranscriptReportInput): AudioTranscriptEntry {
  const config = syncConfig()
  const now = currentUnixSeconds()
  const startedAt = readRequiredAudioTimestamp(input.startedAt, 'startedAt')
  const endedAt = input.endedAt ? readRequiredAudioTimestamp(input.endedAt, 'endedAt') : null
  if (endedAt !== null && endedAt < startedAt) {
    throw new AppError({
      code: 'chronicle_audio_transcript_time_range_invalid',
      status: 400,
      message: 'Audio transcript endedAt must be greater than or equal to startedAt',
    })
  }
  validateAudioTranscriptSegments(input.segments)
  const status = input.status ?? (input.source === 'asr' ? 'completed' : 'imported')
  const source = input.source ?? 'imported'
  const existing = db()
    .select()
    .from(chronicleAudioTranscripts)
    .where(eq(chronicleAudioTranscripts.sourceId, input.sourceId))
    .get()
  const transcriptId = existing?.id ?? randomUUID()
  const transcriptText = buildAudioTranscriptMemoryContent({
    title: input.title ?? null,
    startedAt,
    segments: input.segments,
  })
  const sourcePaths = [
    input.audioPath ? toRootRelative(config.storageRoot, input.audioPath) : null,
    input.transcriptPath ? toRootRelative(config.storageRoot, input.transcriptPath) : null,
  ].filter((path): path is string => !!path)

  db().transaction((tx) => {
    if (existing) {
      tx.update(chronicleAudioTranscripts).set({
        workspaceId: config.workspaceId || null,
        title: normalizeNullableString(input.title),
        source,
        status,
        startedAt,
        endedAt,
        language: normalizeNullableString(input.language),
        appBundleId: normalizeNullableString(input.appBundleId),
        windowTitle: normalizeNullableString(input.windowTitle),
        audioPath: input.audioPath ? toRootRelative(config.storageRoot, input.audioPath) : null,
        transcriptPath: input.transcriptPath ? toRootRelative(config.storageRoot, input.transcriptPath) : null,
        metadataJson: JSON.stringify(input.metadata ?? {}),
        updatedAt: now,
      }).where(eq(chronicleAudioTranscripts.id, transcriptId)).run()
      tx.delete(chronicleAudioSegments).where(eq(chronicleAudioSegments.transcriptId, transcriptId)).run()
    }
    else {
      tx.insert(chronicleAudioTranscripts).values({
        id: transcriptId,
        sourceId: input.sourceId,
        workspaceId: config.workspaceId || null,
        memoryId: null,
        title: normalizeNullableString(input.title),
        source,
        status,
        startedAt,
        endedAt,
        language: normalizeNullableString(input.language),
        appBundleId: normalizeNullableString(input.appBundleId),
        windowTitle: normalizeNullableString(input.windowTitle),
        audioPath: input.audioPath ? toRootRelative(config.storageRoot, input.audioPath) : null,
        transcriptPath: input.transcriptPath ? toRootRelative(config.storageRoot, input.transcriptPath) : null,
        metadataJson: JSON.stringify(input.metadata ?? {}),
        createdAt: now,
        updatedAt: now,
      }).run()
    }

    for (const [segmentIndex, segment] of input.segments.entries()) {
      const segmentId = randomUUID()
      const speakerLabel = normalizeNullableString(segment.speakerLabel)
      tx.insert(chronicleAudioSegments).values({
        id: segmentId,
        transcriptId,
        segmentIndex,
        startMs: Math.floor(segment.startMs),
        endMs: segment.endMs === undefined || segment.endMs === null ? null : Math.floor(segment.endMs),
        speakerLabel,
        text: segment.text,
        confidenceBps: segment.confidence === undefined || segment.confidence === null
          ? null
          : Math.round(Math.max(0, Math.min(1, segment.confidence)) * 10_000),
        language: normalizeNullableString(segment.language) ?? normalizeNullableString(input.language),
        metadataJson: JSON.stringify(segment.metadata ?? {}),
        createdAt: now,
        updatedAt: now,
      }).run()
      if (speakerLabel) {
        upsertSpeakerProfileFromLabel(tx, {
          workspaceId: config.workspaceId || null,
          displayName: speakerLabel,
          seenAt: startedAt + Math.floor(segment.startMs / 1000),
          transcriptId,
          segmentId,
          metadata: {
            source: 'audio-transcript',
            transcriptSourceId: input.sourceId,
            transcriptTitle: input.title ?? null,
          },
        })
      }
    }
  })

  const memory = recordMemory({
    sourceId: `audio-transcript:${input.sourceId}`,
    windowType: '10min',
    createdAt: new Date(startedAt * 1000).toISOString(),
    content: transcriptText,
    summaryKind: 'imported',
    sourceFramePaths: sourcePaths,
    metadata: {
      source: 'audio-transcript',
      transcriptId,
      transcriptSourceId: input.sourceId,
      title: input.title ?? null,
      transcriptStatus: status,
      language: input.language ?? null,
      segmentCount: input.segments.length,
      ...(input.metadata ?? {}),
    },
  }, { skipActivityAssignment: true })

  db().update(chronicleAudioTranscripts).set({
    memoryId: memory.id,
    updatedAt: now,
  }).where(eq(chronicleAudioTranscripts.id, transcriptId)).run()

  recordEvent({
    type: 'audio',
    status: status === 'error' ? 'error' : 'success',
    message: 'Chronicle audio transcript ingested',
    memoryId: memory.id,
    attrs: { sourceId: input.sourceId, transcriptId, segmentCount: input.segments.length, status },
  })
  if (!existing) {
    assignActivityEvidence({
      trigger: 'audio-transcript',
      workspaceId: config.workspaceId || null,
      occurredAt: startedAt,
      segmentType: 'meeting',
      frontApp: normalizeNullableString(input.appBundleId) ?? 'audio',
      title: normalizeNullableString(input.title) ?? normalizeNullableString(input.windowTitle) ?? 'Audio transcript',
      summary: transcriptText.slice(0, 500),
      refs: { audioTranscriptIds: [transcriptId], memoryIds: [memory.id] },
      metadata: {
        source: 'audio-transcript',
        transcriptSourceId: input.sourceId,
        transcriptStatus: status,
        segmentCount: input.segments.length,
      },
    })
  }
  return toAudioTranscriptEntry(db().select().from(chronicleAudioTranscripts).where(eq(chronicleAudioTranscripts.id, transcriptId)).get()!)
}

export function listSpeakerProfiles(): SpeakerProfileEntry[] {
  const config = syncConfig()
  const workspaceId = config.workspaceId || null
  const rows = workspaceId
    ? db()
        .select()
        .from(chronicleSpeakerProfiles)
        .where(eq(chronicleSpeakerProfiles.workspaceId, workspaceId))
        .orderBy(desc(chronicleSpeakerProfiles.lastSeenAt), chronicleSpeakerProfiles.displayName)
        .all()
    : db()
        .select()
        .from(chronicleSpeakerProfiles)
        .orderBy(desc(chronicleSpeakerProfiles.lastSeenAt), chronicleSpeakerProfiles.displayName)
        .all()
  return rows.map(toSpeakerProfileEntry)
}

export function upsertSpeakerProfile(input: SpeakerProfileInput): SpeakerProfileEntry {
  const config = syncConfig()
  const now = currentUnixSeconds()
  const displayName = normalizeSpeakerDisplayName(input.displayName)
  const aliases = normalizeSpeakerAliases(input.aliases ?? [])
  const embedding = input.embedding === undefined ? undefined : normalizeSpeakerEmbedding(input.embedding)
  const lastSeenAt = input.lastSeenAt ? readRequiredAudioTimestamp(input.lastSeenAt, 'lastSeenAt') : null
  const sampleCount = input.sampleCount === undefined ? undefined : Math.max(0, Math.floor(input.sampleCount))
  const metadata = input.metadata ?? {}
  const row = upsertSpeakerProfileFromLabel(db(), {
    workspaceId: config.workspaceId || null,
    displayName,
    aliases,
    embedding,
    embeddingModelId: normalizeNullableString(input.embeddingModelId),
    sampleCount,
    seenAt: lastSeenAt,
    metadata: {
      source: 'manual',
      ...metadata,
    },
    now,
  })
  return toSpeakerProfileEntry(row)
}

export async function syncSlackSource(
  sourceId: string,
  trigger: SlackSyncTrigger = 'manual',
): Promise<{ sourceId: string, status: 'success' | 'error', ingested: number, message: string }> {
  if (activeSlackSyncs.has(sourceId)) {
    return { sourceId, status: 'success', ingested: 0, message: 'Slack sync already running' }
  }

  activeSlackSyncs.add(sourceId)
  try {
    return await syncSlackSourceNow(sourceId, trigger)
  }
  finally {
    activeSlackSyncs.delete(sourceId)
  }
}

export async function handleSlackEvents(
  sourceId: string,
  input: SlackEventsInput,
): Promise<SlackEventsResult> {
  const source = db().select().from(chronicleMessageSources).where(eq(chronicleMessageSources.id, sourceId)).get()
  if (!source) {
    throw new AppError({ code: 'chronicle_message_source_not_found', status: 404, message: 'Chronicle message source not found' })
  }
  if (source.platform !== 'slack') {
    throw new AppError({ code: 'chronicle_message_source_unsupported', status: 400, message: 'Only Slack message sources can receive Slack events' })
  }

  const sourceConfig = readSlackSourceConfig(source.configJson)
  if (sourceConfig.realtimeMode !== 'events-api') {
    throw new AppError({
      code: 'chronicle_slack_events_disabled',
      status: 400,
      message: 'Slack Events API is not enabled for this Chronicle source',
    })
  }
  if (!sourceConfig.signingSecretRef) {
    throw new AppError({
      code: 'chronicle_slack_signing_secret_missing',
      status: 400,
      message: 'Slack signing secret is not configured',
    })
  }

  const signingSecret = readSecret(sourceConfig.signingSecretRef)
  verifySlackSignature({
    rawBody: input.rawBody,
    signature: input.signature,
    timestamp: input.timestamp,
    signingSecret,
  })

  const payload = parseSlackEventsPayload(input.rawBody)
  if (payload.type === 'url_verification') {
    const challenge = readString(payload.challenge)
    if (!challenge) {
      throw new AppError({
        code: 'chronicle_slack_challenge_missing',
        status: 400,
        message: 'Slack URL verification challenge is missing',
      })
    }
    return {
      sourceId: source.id,
      status: 'ok',
      ingested: 0,
      message: 'Slack URL verification accepted',
      challenge,
    }
  }

  if (!source.enabled) {
    return { sourceId: source.id, status: 'ignored', ingested: 0, message: 'Chronicle message source is disabled' }
  }
  if (payload.type !== 'event_callback') {
    return { sourceId: source.id, status: 'ignored', ingested: 0, message: 'Slack event type ignored' }
  }

  const event = isRecord(payload.event) ? payload.event : null
  if (!event) {
    return { sourceId: source.id, status: 'ignored', ingested: 0, message: 'Slack event payload missing' }
  }
  const eventType = readString(event.type)
  if (eventType !== 'message' && eventType !== 'app_mention') {
    return { sourceId: source.id, status: 'ignored', ingested: 0, message: 'Slack event subtype ignored' }
  }
  const subtype = readString(event.subtype)
  if (subtype && subtype !== 'bot_message') {
    return { sourceId: source.id, status: 'ignored', ingested: 0, message: 'Slack message subtype ignored' }
  }

  const channelId = readString(event.channel)
  const messageTs = readString(event.ts)
  const text = readString(event.text) ?? ''
  if (!channelId || !messageTs || !text.trim()) {
    return { sourceId: source.id, status: 'ignored', ingested: 0, message: 'Slack message event missing required fields' }
  }

  const channelIds = parseJson<string[]>(source.channelIdsJson, [])
  if (!channelIds.includes(channelId)) {
    return { sourceId: source.id, status: 'ignored', ingested: 0, message: 'Slack channel is outside Chronicle allowlist' }
  }

  const teamId = readString(payload.team_id) ?? source.teamId
  const inserted = recordSlackMessage({
    sourceId: source.id,
    workspaceId: source.workspaceId,
    teamId,
    channelId,
    channelName: readString(event.channel_name) ?? null,
    userId: readString(event.user) ?? readString(event.bot_id) ?? null,
    userName: readString(event.username) ?? null,
    text,
    messageTs,
    threadId: readString(event.thread_ts) ?? messageTs,
    permalink: null,
    raw: payload,
  })
  const now = currentUnixSeconds()
  const messageAt = slackTsToUnix(messageTs)
  db().update(chronicleMessageSources).set({
    teamId,
    status: 'ready',
    lastMessageAt: Math.max(source.lastMessageAt ?? 0, messageAt),
    lastError: null,
    updatedAt: now,
  }).where(eq(chronicleMessageSources.id, source.id)).run()
  recordEvent({
    type: 'message',
    status: 'success',
    message: inserted ? 'Chronicle Slack event ingested' : 'Chronicle Slack event deduplicated',
    attrs: { sourceId: source.id, channelId, messageTs, inserted },
  })

  return {
    sourceId: source.id,
    status: 'ok',
    ingested: inserted ? 1 : 0,
    message: inserted ? 'Slack event ingested' : 'Slack event already ingested',
  }
}

async function syncSlackSourceNow(
  sourceId: string,
  trigger: SlackSyncTrigger,
): Promise<{ sourceId: string, status: 'success' | 'error', ingested: number, message: string }> {
  const source = db().select().from(chronicleMessageSources).where(eq(chronicleMessageSources.id, sourceId)).get()
  if (!source) {
    throw new AppError({ code: 'chronicle_message_source_not_found', status: 404, message: 'Chronicle message source not found' })
  }
  if (source.platform !== 'slack') {
    throw new AppError({ code: 'chronicle_message_source_unsupported', status: 400, message: 'Only Slack message sources can be synced' })
  }
  if (!source.enabled) {
    throw new AppError({ code: 'chronicle_message_source_disabled', status: 400, message: 'Chronicle message source is disabled' })
  }
  if (!source.botTokenRef) {
    if (trigger === 'background') {
      return failSlackSync(source.id, 'Slack bot token secret is not configured')
    }
    throw new AppError({ code: 'chronicle_slack_token_missing', status: 400, message: 'Slack bot token secret is not configured' })
  }
  const channelIds = parseJson<string[]>(source.channelIdsJson, []).filter(channelId => channelId.trim().length > 0)
  if (channelIds.length === 0) {
    if (trigger === 'background') {
      return failSlackSync(source.id, 'At least one Slack channel id is required')
    }
    throw new AppError({ code: 'chronicle_slack_channels_missing', status: 400, message: 'At least one Slack channel id is required' })
  }

  updateMessageSourceStatus(source.id, 'syncing', null)
  try {
    const token = readSecret(source.botTokenRef)
    let ingested = 0
    let lastMessageAt = source.lastMessageAt
    const channelNames = await fetchSlackChannelNames(token, channelIds)
    for (const channelId of channelIds) {
      const messages = await fetchSlackHistory(token, channelId, source.lastSyncAt)
      for (const message of messages) {
        const text = readString(message.text) ?? ''
        if (!text.trim()) {
          continue
        }
        const messageTs = readString(message.ts)
        if (!messageTs) {
          continue
        }
        const messageAt = slackTsToUnix(messageTs)
        const inserted = recordSlackMessage({
          sourceId: source.id,
          workspaceId: source.workspaceId,
          teamId: source.teamId,
          channelId,
          channelName: channelNames.get(channelId) ?? null,
          userId: readString(message.user) ?? readString(message.bot_id) ?? null,
          userName: readString(message.username) ?? null,
          text,
          messageTs,
          threadId: readString(message.thread_ts) ?? messageTs,
          permalink: null,
          raw: message,
        })
        if (inserted) {
          ingested += 1
        }
        lastMessageAt = Math.max(lastMessageAt ?? 0, messageAt)
      }
    }
    const now = currentUnixSeconds()
    db().update(chronicleMessageSources).set({
      status: 'ready',
      lastSyncAt: now,
      lastMessageAt,
      lastError: null,
      updatedAt: now,
    }).where(eq(chronicleMessageSources.id, source.id)).run()
    recordEvent({
      type: 'message',
      status: 'success',
      message: 'Chronicle Slack sync completed',
      attrs: { sourceId: source.id, ingested, trigger },
    })
    return { sourceId: source.id, status: 'success', ingested, message: 'Slack sync completed' }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failSlackSync(source.id, message, trigger)
  }
}

export function recordSnapshot(input: ChronicleSnapshotReportInput) {
  const config = syncConfig()
  const now = currentUnixSeconds()
  const capturedAt = parseTimestamp(input.capturedAt) ?? now
  const existing = db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.sourceId, input.sourceId)).get()
  const id = existing?.id ?? randomUUID()
  const values = {
    sourceId: input.sourceId,
    workspaceId: config.workspaceId || null,
    capturedAt,
    displayId: input.displayId,
    segmentDir: toRootRelative(config.storageRoot, input.segmentDir),
    framePath: toRootRelative(config.storageRoot, input.framePath),
    artifactPath: input.snapshotPath ? toRootRelative(config.storageRoot, input.snapshotPath) : null,
    ocrText: input.ocrText ?? null,
    appBundleId: input.appBundleId ?? null,
    windowTitle: input.windowTitle ?? null,
    metadataJson: JSON.stringify({
      frameIndex: input.frameIndex ?? null,
      capturePath: input.capturePath ? toRootRelative(config.storageRoot, input.capturePath) : null,
      ocrPath: input.ocrPath ? toRootRelative(config.storageRoot, input.ocrPath) : null,
      snapshotPath: input.snapshotPath ? toRootRelative(config.storageRoot, input.snapshotPath) : null,
      ...(input.metadata ?? {}),
    }),
    updatedAt: now,
  }

  if (existing) {
    db().update(chronicleSnapshots).set(values).where(eq(chronicleSnapshots.id, existing.id)).run()
  }
  else {
    db().insert(chronicleSnapshots).values({ id, ...values, createdAt: now }).run()
    recordEvent({
      type: 'snapshot',
      status: 'success',
      message: 'Chronicle snapshot ingested',
      snapshotId: id,
      attrs: { sourceId: input.sourceId, framePath: values.framePath },
    })
  }
  let accessibilitySnapshotId: string | null = null
  if (input.accessibility) {
    accessibilitySnapshotId = recordAccessibilitySnapshot(input.accessibility, {
      snapshotId: id,
      workspaceId: config.workspaceId || null,
      capturedAt,
      storageRoot: config.storageRoot,
      appBundleId: input.appBundleId ?? null,
      windowTitle: input.windowTitle ?? null,
    })
  }
  if (!existing) {
    assignActivityEvidence({
      trigger: 'snapshot',
      workspaceId: config.workspaceId || null,
      occurredAt: capturedAt,
      segmentType: inferScreenActivitySegmentType(input.appBundleId ?? null, input.windowTitle ?? null),
      frontApp: input.appBundleId ?? null,
      title: input.windowTitle ?? null,
      summary: input.ocrText ?? input.accessibility?.text ?? null,
      refs: {
        snapshotIds: [id],
        accessibilitySnapshotIds: accessibilitySnapshotId ? [accessibilitySnapshotId] : [],
      },
      metadata: {
        source: 'snapshot',
        sourceId: input.sourceId,
        displayId: input.displayId,
        framePath: values.framePath,
      },
    })
  }
  return db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.id, id)).get()!
}

function recordAccessibilitySnapshot(
  input: AccessibilitySnapshotReportInput,
  context: {
    snapshotId: string
    workspaceId: string | null
    capturedAt: number
    storageRoot: string
    appBundleId: string | null
    windowTitle: string | null
  },
): string {
  const now = currentUnixSeconds()
  const existing = db()
    .select()
    .from(chronicleAccessibilitySnapshots)
    .where(eq(chronicleAccessibilitySnapshots.sourceId, input.sourceId))
    .get()
  const id = existing?.id ?? randomUUID()
  const artifactPath = input.accessibilityPath
    ? toRootRelative(context.storageRoot, input.accessibilityPath)
    : null
  const metadata = {
    ...(input.metadata ?? {}),
    ...(artifactPath ? { artifactPath } : {}),
  }
  const values = {
    sourceId: input.sourceId,
    snapshotId: context.snapshotId,
    workspaceId: context.workspaceId,
    capturedAt: context.capturedAt,
    status: input.status ?? 'ready',
    provider: input.provider ?? 'macos-accessibility',
    appBundleId: normalizeNullableString(input.appBundleId) ?? context.appBundleId,
    windowTitle: normalizeNullableString(input.windowTitle) ?? context.windowTitle,
    elementCount: Math.max(0, Math.floor(input.elementCount ?? 0)),
    text: normalizeNullableString(input.text),
    treeJson: JSON.stringify(input.tree ?? []),
    metadataJson: JSON.stringify(metadata),
    updatedAt: now,
  }

  if (existing) {
    db().update(chronicleAccessibilitySnapshots).set(values).where(eq(chronicleAccessibilitySnapshots.id, id)).run()
  }
  else {
    db().insert(chronicleAccessibilitySnapshots).values({
      id,
      ...values,
      createdAt: now,
    }).run()
  }
  return id
}

export function recordMemory(
  input: ChronicleMemoryReportInput,
  options: {
    prompt?: string
    modelId?: string
    profileId?: string
    usage?: { promptTokens: number, completionTokens: number, totalTokens: number }
    sourceSnapshotIds?: string[]
    skipActivityAssignment?: boolean
  } = {},
) {
  reconcileMemorySearchIndex()
  const config = syncConfig()
  const now = currentUnixSeconds()
  const createdAt = parseTimestamp(input.createdAt) ?? now
  const canonicalContent = canonicalizeMemoryContent(input.content)
  const contentHash = hashText(canonicalContent)
  const existing = db().select().from(chronicleMemories).where(eq(chronicleMemories.sourceId, input.sourceId)).get()
  const duplicate = findDuplicateMemory(contentHash, canonicalContent, existing?.id)
  const sourceSnapshotIds = options.sourceSnapshotIds ?? findSnapshotIdsByPaths(input.sourceSnapshotPaths ?? [])
  const sourcePaths = [...new Set([
    ...(input.memoryPath ? [toRootRelative(config.storageRoot, input.memoryPath)] : []),
    ...(input.sourceSnapshotPaths ?? []).map(path => toRootRelative(config.storageRoot, path)),
    ...(input.sourceFramePaths ?? []).map(path => toRootRelative(config.storageRoot, path)),
  ])]
  const values = {
    sourceId: input.sourceId,
    contentHash,
    workspaceId: config.workspaceId || null,
    type: input.windowType,
    source: input.summaryKind,
    content: input.content,
    prompt: options.prompt ?? null,
    sourceSnapshotIdsJson: JSON.stringify(sourceSnapshotIds),
    sourcePathsJson: JSON.stringify(sourcePaths),
    modelProfileId: (options.profileId ?? config.profileId) || null,
    modelId: (options.modelId ?? config.modelId) || null,
    usageJson: JSON.stringify(options.usage ?? {}),
    metadataJson: JSON.stringify(input.metadata ?? {}),
    createdAt,
    updatedAt: now,
  }

  if (existing) {
    if (duplicate) {
      const merged = db().transaction((tx) => {
        const row = mergeDuplicateMemory(tx, duplicate, {
          sourceId: input.sourceId,
          sourcePaths,
          sourceSnapshotIds,
          now,
          contentHash,
        })
        tx.delete(chronicleMemories).where(eq(chronicleMemories.id, existing.id)).run()
        return row
      })
      recordEvent({
        type: 'memory',
        status: 'info',
        message: 'Chronicle memory duplicate merged',
        memoryId: merged.id,
        attrs: { sourceId: input.sourceId, duplicateOfSourceId: duplicate.sourceId, contentHash, removedMemoryId: existing.id },
      })
      assignMemoryToActivity(input, merged.id, createdAt, config.workspaceId || null, options)
      return merged
    }

    const updated = db().transaction((tx) => {
      tx.update(chronicleMemories).set(values).where(eq(chronicleMemories.id, existing.id)).run()
      const updated = tx.select().from(chronicleMemories).where(eq(chronicleMemories.id, existing.id)).get()!
      syncMemorySearchIndex(tx, updated)
      return updated
    })
    assignMemoryToActivity(input, updated.id, createdAt, config.workspaceId || null, options)
    return updated
  }

  if (duplicate) {
    const merged = db().transaction((tx) => mergeDuplicateMemory(tx, duplicate, {
      sourceId: input.sourceId,
      sourcePaths,
      sourceSnapshotIds,
      now,
      contentHash,
    }))
    recordEvent({
      type: 'memory',
      status: 'info',
      message: 'Chronicle memory duplicate merged',
      memoryId: duplicate.id,
      attrs: { sourceId: input.sourceId, duplicateOfSourceId: duplicate.sourceId, contentHash },
    })
    assignMemoryToActivity(input, merged.id, createdAt, config.workspaceId || null, options)
    return merged
  }

  const id = randomUUID()
  const inserted = db().transaction((tx) => {
    tx.insert(chronicleMemories).values({ id, ...values }).run()
    const row = tx.select().from(chronicleMemories).where(eq(chronicleMemories.id, id)).get()!
    syncMemorySearchIndex(tx, row)
    return row
  })
  recordEvent({
    type: 'memory',
    status: 'success',
    message: 'Chronicle memory ingested',
    memoryId: id,
    attrs: { sourceId: input.sourceId, source: input.summaryKind },
  })
  assignMemoryToActivity(input, inserted.id, createdAt, config.workspaceId || null, options)
  return inserted
}

function assignMemoryToActivity(
  input: ChronicleMemoryReportInput,
  memoryId: string,
  createdAt: number,
  workspaceId: string | null,
  options: { skipActivityAssignment?: boolean },
): void {
  if (options.skipActivityAssignment) {
    return
  }
  assignActivityEvidence({
    trigger: 'memory',
    workspaceId,
    occurredAt: createdAt,
    segmentType: 'work',
    frontApp: readString(input.metadata?.appBundleId) ?? null,
    title: readString(input.metadata?.title) ?? null,
    summary: input.content.slice(0, 500),
    refs: { memoryIds: [memoryId] },
    metadata: {
      source: 'memory',
      sourceId: input.sourceId,
      summaryKind: input.summaryKind,
      windowType: input.windowType,
    },
  })
}

function inferScreenActivitySegmentType(appBundleId: string | null, windowTitle: string | null): ActivitySegmentType {
  const haystack = `${appBundleId ?? ''} ${windowTitle ?? ''}`.toLowerCase()
  if (haystack.includes('zoom') || haystack.includes('meet') || haystack.includes('teams')) {
    return 'meeting'
  }
  if (haystack.includes('slack') || haystack.includes('discord')) {
    return 'chat'
  }
  if (haystack.includes('browser') || haystack.includes('safari') || haystack.includes('chrome') || haystack.includes('firefox')) {
    return 'browsing'
  }
  return appBundleId || windowTitle ? 'work' : 'unknown'
}

export async function getFrameImageBySnapshot(snapshotId: string): Promise<Response | null> {
  const snapshot = db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.id, snapshotId)).get()
  if (!snapshot) {
    return null
  }
  return readFrameImage(snapshot.framePath)
}

export async function getFrameImage(segment: string, frame: string): Promise<Response | null> {
  return readFrameImage(resolveRelativeJoin(segment, frame))
}

function syncConfig(): ChronicleConfig {
  const filePath = getConfigPath()
  try {
    const content = readFileSync(filePath, 'utf8')
    return ChronicleConfigJsonSchema.parse(content)
  }
  catch {
    return { ...defaultConfig }
  }
}

function validateSummaryConfig(config: ChronicleConfig): string | null {
  if (!config.enabled) {
    return 'Chronicle is not enabled'
  }
  if (!config.profileId) {
    return 'no profile set'
  }
  if (!Profiles.getProfile(config.profileId)) {
    return 'configured profile not found'
  }
  return null
}

function resolveProfileApiKey(credentialRef: string | null, configApiKey: string | undefined): string | null {
  if (credentialRef) {
    return readSecret(credentialRef)
  }
  return configApiKey ?? null
}

function getMessageSourceEntry(sourceId: string): MessageSourceEntry {
  const source = db().select().from(chronicleMessageSources).where(eq(chronicleMessageSources.id, sourceId)).get()
  if (!source) {
    throw new AppError({ code: 'chronicle_message_source_not_found', status: 404, message: 'Chronicle message source not found' })
  }
  return toMessageSourceEntry(source)
}

function toMessageSourceEntry(row: typeof chronicleMessageSources.$inferSelect): MessageSourceEntry {
  const sourceConfig = readSlackSourceConfig(row.configJson)
  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    enabled: row.enabled,
    workspaceId: row.workspaceId,
    teamId: row.teamId,
    botTokenRef: row.botTokenRef,
    channelIds: parseJson<string[]>(row.channelIdsJson, []),
    realtimeMode: sourceConfig.realtimeMode,
    signingSecretRef: sourceConfig.signingSecretRef,
    socketAppTokenRef: sourceConfig.socketAppTokenRef,
    status: row.status,
    lastSyncAt: row.lastSyncAt,
    lastMessageAt: row.lastMessageAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toMessageEntry(row: typeof chronicleMessages.$inferSelect): MessageEntry {
  return {
    id: row.id,
    sourceId: row.sourceId,
    platform: row.platform,
    channelId: row.channelId,
    channelName: row.channelName,
    userName: row.userName,
    text: row.text,
    messageTs: row.messageTs,
    messageAt: new Date(row.messageAt * 1000).toISOString(),
    messageAtUnix: row.messageAt,
    permalink: row.permalink,
  }
}

function toAudioRawSegmentEntry(row: typeof chronicleAudioRawSegments.$inferSelect): AudioRawSegmentEntry {
  return {
    id: row.id,
    sourceId: row.sourceId,
    recordedAt: new Date(row.recordedAt * 1000).toISOString(),
    recordedAtUnix: row.recordedAt,
    source: row.source,
    status: row.status,
    audioPath: row.audioPath,
    metadataPath: row.metadataPath,
    sampleRate: row.sampleRate,
    channels: row.channels,
    sampleCount: row.sampleCount,
    droppedSamples: row.droppedSamples,
    durationMs: row.durationMs,
    rms: bpsToRatio(row.rmsBps),
    peak: bpsToRatio(row.peakBps),
    active: row.active,
    vadStatus: row.vadStatus,
    asrStatus: row.asrStatus,
    speakerStatus: row.speakerStatus,
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
  }
}

function toAccessibilitySnapshotEntry(row: typeof chronicleAccessibilitySnapshots.$inferSelect): AccessibilitySnapshotEntry {
  const tree = parseJson<unknown>(row.treeJson, [])
  return {
    id: row.id,
    sourceId: row.sourceId,
    snapshotId: row.snapshotId,
    capturedAt: new Date(row.capturedAt * 1000).toISOString(),
    capturedAtUnix: row.capturedAt,
    status: row.status,
    provider: row.provider,
    appBundleId: row.appBundleId,
    windowTitle: row.windowTitle,
    elementCount: row.elementCount,
    text: row.text,
    tree: Array.isArray(tree) ? tree : [],
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
  }
}

function toActivitySegmentEntry(row: typeof chronicleActivitySegments.$inferSelect): ActivitySegmentEntry {
  return {
    id: row.id,
    sessionId: row.sessionId,
    startedAt: new Date(row.startedAt * 1000).toISOString(),
    startedAtUnix: row.startedAt,
    endedAt: new Date(row.endedAt * 1000).toISOString(),
    endedAtUnix: row.endedAt,
    durationSeconds: Math.max(0, row.endedAt - row.startedAt),
    segmentType: row.segmentType,
    frontApp: row.frontApp,
    title: row.title,
    summary: row.summary,
    sourceCounts: parseJson<Record<string, number>>(row.sourceCountsJson, {}),
    sourceRefs: parseJson<Record<string, string[]>>(row.sourceRefsJson, {}),
    pipelineStatus: row.pipelineStatus,
    isCrystallized: row.isCrystallized,
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
  }
}

function toPipelineRunEntry(row: typeof chroniclePipelineRuns.$inferSelect): PipelineRunEntry {
  return {
    id: row.id,
    sessionId: row.sessionId,
    segmentId: row.segmentId,
    trigger: row.trigger,
    stage: row.stage,
    status: row.status,
    startedAt: new Date(row.startedAt * 1000).toISOString(),
    startedAtUnix: row.startedAt,
    endedAt: row.endedAt === null ? null : new Date(row.endedAt * 1000).toISOString(),
    endedAtUnix: row.endedAt,
    errorMessage: row.errorMessage,
    snapshotsCount: row.snapshotsCount,
    messagesCount: row.messagesCount,
    audioTranscriptsCount: row.audioTranscriptsCount,
    audioRawSegmentsCount: row.audioRawSegmentsCount,
    memoriesCount: row.memoriesCount,
    segmentsCount: row.segmentsCount,
    segmentIds: parseJson<string[]>(row.segmentIdsJson, []),
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
  }
}

function toKnowledgeCardEntry(row: typeof chronicleKnowledgeCards.$inferSelect): KnowledgeCardEntry {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    cardType: row.cardType,
    dimension: row.dimension,
    confidence: bpsToRatio(row.confidenceBps),
    sourceMemoryIds: parseJson<string[]>(row.sourceMemoryIdsJson, []),
    sourceSegmentIds: parseJson<string[]>(row.sourceSegmentIdsJson, []),
    sourceChunkIds: parseJson<string[]>(row.sourceChunkIdsJson, []),
    tags: parseJson<string[]>(row.tagsJson, []),
    contentHash: row.contentHash,
    version: row.version,
    status: row.status,
    mergedIntoId: row.mergedIntoId,
    pinned: row.pinned,
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
    updatedAt: new Date(row.updatedAt * 1000).toISOString(),
    updatedAtUnix: row.updatedAt,
  }
}

function toKnowledgeVersionEntry(row: typeof chronicleKnowledgeVersions.$inferSelect): KnowledgeVersionEntry {
  return {
    id: row.id,
    knowledgeId: row.knowledgeId,
    version: row.version,
    title: row.title,
    content: row.content,
    cardType: row.cardType,
    dimension: row.dimension,
    confidence: bpsToRatio(row.confidenceBps),
    sourceMemoryIds: parseJson<string[]>(row.sourceMemoryIdsJson, []),
    sourceSegmentIds: parseJson<string[]>(row.sourceSegmentIdsJson, []),
    sourceChunkIds: parseJson<string[]>(row.sourceChunkIdsJson, []),
    tags: parseJson<string[]>(row.tagsJson, []),
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
  }
}

function toDreamRunEntry(row: typeof chronicleDreamRuns.$inferSelect): DreamRunEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    runType: row.runType,
    status: row.status,
    startedAt: new Date(row.startedAt * 1000).toISOString(),
    startedAtUnix: row.startedAt,
    endedAt: row.endedAt === null ? null : new Date(row.endedAt * 1000).toISOString(),
    endedAtUnix: row.endedAt,
    inputCount: row.inputCount,
    outputCount: row.outputCount,
    mergedCount: row.mergedCount,
    deletedCount: row.deletedCount,
    sourceKnowledgeIds: parseJson<string[]>(row.sourceKnowledgeIdsJson, []),
    outputKnowledgeIds: parseJson<string[]>(row.outputKnowledgeIdsJson, []),
    config: parseJson<Record<string, unknown>>(row.configJson, {}),
    result: parseJson<Record<string, unknown>>(row.resultJson, {}),
    errorMessage: row.errorMessage,
  }
}

function toAudioTranscriptEntry(row: typeof chronicleAudioTranscripts.$inferSelect): AudioTranscriptEntry {
  const segments = db()
    .select()
    .from(chronicleAudioSegments)
    .where(eq(chronicleAudioSegments.transcriptId, row.id))
    .orderBy(chronicleAudioSegments.segmentIndex)
    .all()
    .map(toAudioSegmentEntry)

  return {
    id: row.id,
    sourceId: row.sourceId,
    memoryId: row.memoryId,
    title: row.title,
    source: row.source,
    status: row.status,
    startedAt: new Date(row.startedAt * 1000).toISOString(),
    startedAtUnix: row.startedAt,
    endedAt: row.endedAt === null ? null : new Date(row.endedAt * 1000).toISOString(),
    endedAtUnix: row.endedAt,
    language: row.language,
    appBundleId: row.appBundleId,
    windowTitle: row.windowTitle,
    segmentCount: segments.length,
    previewText: segments.map(segment => segment.text).join(' ').slice(0, 500),
    segments,
  }
}

function toAudioSegmentEntry(row: typeof chronicleAudioSegments.$inferSelect): AudioTranscriptSegmentEntry {
  return {
    id: row.id,
    segmentIndex: row.segmentIndex,
    startMs: row.startMs,
    endMs: row.endMs,
    speakerLabel: row.speakerLabel,
    text: row.text,
    confidence: row.confidenceBps === null ? null : row.confidenceBps / 10_000,
    language: row.language,
  }
}

function toSpeakerProfileEntry(row: typeof chronicleSpeakerProfiles.$inferSelect): SpeakerProfileEntry {
  const embedding = row.embeddingJson ? parseJson<unknown>(row.embeddingJson, null) : null
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    displayName: row.displayName,
    normalizedLabel: row.normalizedLabel,
    aliases: parseJson<string[]>(row.aliasesJson, []),
    embedding: Array.isArray(embedding) && embedding.every(item => typeof item === 'number') ? embedding : null,
    embeddingDimensions: row.embeddingDimensions,
    embeddingModelId: row.embeddingModelId,
    sampleCount: row.sampleCount,
    lastSeenAt: row.lastSeenAt === null ? null : new Date(row.lastSeenAt * 1000).toISOString(),
    lastSeenAtUnix: row.lastSeenAt,
    sourceTranscriptId: row.sourceTranscriptId,
    sourceSegmentId: row.sourceSegmentId,
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
    updatedAt: new Date(row.updatedAt * 1000).toISOString(),
    updatedAtUnix: row.updatedAt,
  }
}

function buildAudioTranscriptPreview(transcriptId: string): string {
  return db()
    .select({ text: chronicleAudioSegments.text })
    .from(chronicleAudioSegments)
    .where(eq(chronicleAudioSegments.transcriptId, transcriptId))
    .orderBy(chronicleAudioSegments.segmentIndex)
    .limit(4)
    .all()
    .map(row => row.text)
    .join(' ')
}

function buildAudioTranscriptMemoryContent(input: {
  title: string | null
  startedAt: number
  segments: AudioTranscriptSegmentInput[]
}): string {
  const heading = input.title?.trim()
    ? `Meeting transcript: ${input.title.trim()}`
    : `Meeting transcript: ${new Date(input.startedAt * 1000).toISOString()}`
  const body = input.segments
    .map((segment) => {
      const speaker = segment.speakerLabel?.trim() || 'Speaker'
      const start = formatDurationMs(segment.startMs)
      return `[${start}] ${speaker}: ${segment.text.trim()}`
    })
    .filter(line => line.length > 0)
    .join('\n')
  return `${heading}\n\n${body}`.trim()
}

function formatDurationMs(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function updateMessageSourceStatus(
  sourceId: string,
  status: typeof chronicleMessageSources.$inferSelect.status,
  lastError: string | null,
): void {
  db().update(chronicleMessageSources).set({
    status,
    lastError,
    updatedAt: currentUnixSeconds(),
  }).where(eq(chronicleMessageSources.id, sourceId)).run()
}

function failSlackSync(
  sourceId: string,
  message: string,
  trigger: SlackSyncTrigger = 'manual',
): { sourceId: string, status: 'error', ingested: 0, message: string } {
  updateMessageSourceStatus(sourceId, 'error', message)
  recordEvent({
    type: 'message',
    status: 'error',
    message,
    attrs: { sourceId, trigger },
  })
  return { sourceId, status: 'error', ingested: 0, message }
}

function readSlackSourceConfig(configJson: string): SlackSourceConfig {
  const parsed = SlackSourceConfigSchema.safeParse(parseJson<unknown>(configJson, {}))
  if (!parsed.success) {
    return { realtimeMode: 'polling', signingSecretRef: null, socketAppTokenRef: null }
  }
  return buildSlackSourceConfig(parsed.data)
}

function buildSlackSourceConfig(input: {
  realtimeMode?: SlackRealtimeMode
  signingSecretRef?: string | null
  socketAppTokenRef?: string | null
}): SlackSourceConfig {
  return {
    realtimeMode: input.realtimeMode ?? 'polling',
    signingSecretRef: normalizeNullableString(input.signingSecretRef),
    socketAppTokenRef: normalizeNullableString(input.socketAppTokenRef),
  }
}

function mergeSlackSourceConfig(
  configJson: string,
  patch: {
    realtimeMode?: SlackRealtimeMode
    signingSecretRef?: string | null
    socketAppTokenRef?: string | null
  },
): SlackSourceConfig {
  const current = readSlackSourceConfig(configJson)
  return buildSlackSourceConfig({
    realtimeMode: patch.realtimeMode ?? current.realtimeMode,
    signingSecretRef: patch.signingSecretRef === undefined ? current.signingSecretRef : patch.signingSecretRef,
    socketAppTokenRef: patch.socketAppTokenRef === undefined ? current.socketAppTokenRef : patch.socketAppTokenRef,
  })
}

function normalizeChannelIds(channelIds: string[]): string[] {
  return [...new Set(channelIds.map(channelId => channelId.trim()).filter(Boolean))]
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

interface SlackApiResponse<T> {
  ok?: boolean
  error?: string
  messages?: T[]
  channel?: { id?: string, name?: string, is_channel?: boolean, is_group?: boolean, is_im?: boolean }
}

function verifySlackSignature(input: {
  rawBody: string
  signature: string | null
  timestamp: string | null
  signingSecret: string
}): void {
  if (!input.signature || !input.timestamp) {
    throw new AppError({
      code: 'chronicle_slack_signature_missing',
      status: 401,
      message: 'Slack signature headers are required',
    })
  }

  const timestampSeconds = Number(input.timestamp)
  if (!Number.isFinite(timestampSeconds)) {
    throw new AppError({
      code: 'chronicle_slack_timestamp_invalid',
      status: 401,
      message: 'Slack request timestamp is invalid',
    })
  }

  const now = currentUnixSeconds()
  if (Math.abs(now - timestampSeconds) > SLACK_SIGNATURE_TOLERANCE_SECONDS) {
    throw new AppError({
      code: 'chronicle_slack_timestamp_stale',
      status: 401,
      message: 'Slack request timestamp is outside the accepted window',
    })
  }

  const base = `${SLACK_SIGNATURE_VERSION}:${input.timestamp}:${input.rawBody}`
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac('sha256', input.signingSecret).update(base).digest('hex')}`
  if (!safeEqualText(input.signature, expected)) {
    throw new AppError({
      code: 'chronicle_slack_signature_invalid',
      status: 401,
      message: 'Slack signature is invalid',
    })
  }
}

function safeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function parseSlackEventsPayload(rawBody: string): Record<string, unknown> {
  const parsed = parseJson<unknown>(rawBody, null)
  if (!isRecord(parsed)) {
    throw new AppError({
      code: 'chronicle_slack_payload_invalid',
      status: 400,
      message: 'Slack event payload must be a JSON object',
    })
  }
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function fetchSlackHistory(token: string, channelId: string, oldestUnix: number | null): Promise<Record<string, unknown>[]> {
  const url = new URL('https://slack.com/api/conversations.history')
  url.searchParams.set('channel', channelId)
  url.searchParams.set('limit', '100')
  if (oldestUnix) {
    url.searchParams.set('oldest', String(oldestUnix))
    url.searchParams.set('inclusive', 'false')
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`Slack history request failed: ${response.status}`)
  }
  const payload = await response.json() as SlackApiResponse<Record<string, unknown>>
  if (!payload.ok) {
    throw new Error(`Slack history request failed: ${payload.error ?? 'unknown_error'}`)
  }
  return payload.messages ?? []
}

async function fetchSlackChannelNames(token: string, channelIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (const channelId of channelIds) {
    try {
      const url = new URL('https://slack.com/api/conversations.info')
      url.searchParams.set('channel', channelId)
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) {
        continue
      }
      const payload = await response.json() as SlackApiResponse<never>
      if (payload.ok && payload.channel?.name) {
        names.set(channelId, payload.channel.name)
      }
    }
    catch {
      // Channel names improve display only; message ingest should still proceed.
    }
  }
  return names
}

function recordSlackMessage(input: {
  sourceId: string
  workspaceId: string | null
  teamId: string | null
  channelId: string
  channelName: string | null
  userId: string | null
  userName: string | null
  text: string
  messageTs: string
  threadId: string
  permalink: string | null
  raw: Record<string, unknown>
}): boolean {
  const externalMessageId = `${input.channelId}:${input.messageTs}`
  const existing = db()
    .select({ id: chronicleMessages.id })
    .from(chronicleMessages)
    .where(sql`${chronicleMessages.sourceId} = ${input.sourceId} AND ${chronicleMessages.externalMessageId} = ${externalMessageId}`)
    .get()
  if (existing) {
    return false
  }

  const now = currentUnixSeconds()
  const messageAt = slackTsToUnix(input.messageTs)
  const dedupHash = createHash('sha256')
    .update(JSON.stringify({
      sourceId: input.sourceId,
      channelId: input.channelId,
      messageTs: input.messageTs,
      text: input.text,
    }))
    .digest('hex')
  const id = randomUUID()
  db().insert(chronicleMessages).values({
    id,
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
    platform: 'slack',
    externalMessageId,
    teamId: input.teamId,
    channelId: input.channelId,
    channelName: input.channelName,
    threadId: input.threadId,
    userId: input.userId,
    userName: input.userName,
    text: input.text,
    isDm: input.channelId.startsWith('D'),
    messageTs: input.messageTs,
    messageAt,
    permalink: input.permalink,
    attachmentsJson: JSON.stringify(readArray(input.raw.attachments)),
    rawJson: JSON.stringify(input.raw),
    dedupHash,
    createdAt: now,
    updatedAt: now,
  }).run()

  const channelLabel = input.channelName ? `#${input.channelName}` : input.channelId
  const memory = recordMemory({
    sourceId: `slack:${input.sourceId}:${externalMessageId}`,
    windowType: '10min',
    createdAt: new Date(messageAt * 1000).toISOString(),
    content: `[Slack ${channelLabel}] ${input.userName ?? input.userId ?? 'unknown'}: ${input.text}`,
    summaryKind: 'imported',
    metadata: {
      platform: 'slack',
      messageId: id,
      sourceId: input.sourceId,
      channelId: input.channelId,
      channelName: input.channelName,
      messageTs: input.messageTs,
    },
  }, { skipActivityAssignment: true })
  assignActivityEvidence({
    trigger: 'message',
    workspaceId: input.workspaceId,
    occurredAt: messageAt,
    segmentType: 'chat',
    frontApp: 'slack',
    title: input.channelName ?? input.channelId,
    summary: input.text.slice(0, 500),
    refs: { messageIds: [id], memoryIds: [memory.id] },
    metadata: {
      source: 'slack',
      sourceId: input.sourceId,
      externalMessageId,
      channelId: input.channelId,
      messageTs: input.messageTs,
    },
  })
  return true
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function slackTsToUnix(value: string): number {
  const seconds = Number(value.split('.')[0])
  return Number.isFinite(seconds) ? Math.floor(seconds) : currentUnixSeconds()
}

async function getConfiguredModel(config: ChronicleConfig): Promise<string | null> {
  if (!config.profileId) {
    return null
  }
  const profile = Profiles.getProfile(config.profileId)
  if (!profile) {
    return null
  }
  const parsedConfig = ProfileConfigJsonSchema.parse(profile.configJson)
  return config.modelId || parsedConfig.modelId || parsedConfig.model || null
}

function recordEvent(input: {
  type: 'config' | 'daemon' | 'snapshot' | 'memory' | 'summarize' | 'model-resource' | 'message' | 'audio' | 'activity'
  status: 'info' | 'success' | 'warning' | 'error'
  message: string
  snapshotId?: string
  memoryId?: string
  attrs?: Record<string, unknown>
}) {
  db().insert(chronicleEvents).values({
    id: randomUUID(),
    type: input.type,
    status: input.status,
    message: input.message,
    snapshotId: input.snapshotId ?? null,
    memoryId: input.memoryId ?? null,
    attrsJson: JSON.stringify(input.attrs ?? {}),
    createdAt: currentUnixSeconds(),
  }).run()
}

function seedModelResources(): void {
  const now = currentUnixSeconds()
  const d = db()
  for (const manifest of Object.values(builtInModelManifests)) {
    const existing = d.select().from(chronicleModelResources).where(eq(chronicleModelResources.category, manifest.category)).get()
    if (existing) {
      // Always refresh metadata to pick up manifest changes (e.g. new sourceUrls)
      d.update(chronicleModelResources).set({
        metadataJson: JSON.stringify(buildModelResourceMetadata(manifest)),
        displayName: manifest.displayName,
        version: manifest.version,
      }).where(eq(chronicleModelResources.id, existing.id)).run()
      continue
    }
    const status = manifest.files.length === 0 ? 'available' : 'missing'
    d.insert(chronicleModelResources).values({
      id: randomUUID(),
      category: manifest.category,
      status,
      displayName: manifest.displayName,
      path: null,
      version: manifest.version,
      message: manifest.message,
      sizeBytes: 0,
      metadataJson: JSON.stringify(buildModelResourceMetadata(manifest)),
      createdAt: now,
      updatedAt: now,
    }).run()
  }
}

function listModelResourceRows(): ModelResourceEntry[] {
  return db()
    .select()
    .from(chronicleModelResources)
    .orderBy(chronicleModelResources.category)
    .all()
    .map(row => ({
      id: row.id,
      category: row.category,
      status: row.status,
      displayName: row.displayName,
      path: row.path,
      version: row.version,
      message: row.message,
      sizeBytes: row.sizeBytes,
      metadata: parseJson(row.metadataJson, {}),
      updatedAt: row.updatedAt,
    }))
}

function getModelResourceRow(category: ModelResourceCategory): typeof chronicleModelResources.$inferSelect {
  seedModelResources()
  const row = db().select().from(chronicleModelResources).where(eq(chronicleModelResources.category, category)).get()
  if (!row) {
    throw new AppError({
      code: 'chronicle_model_resource_not_found',
      status: 404,
      message: 'Chronicle model resource not found',
    })
  }
  return row
}

function getModelResourceEntry(category: ModelResourceCategory): ModelResourceEntry {
  const row = getModelResourceRow(category)
  return {
    id: row.id,
    category: row.category,
    status: row.status,
    displayName: row.displayName,
    path: row.path,
    version: row.version,
    message: row.message,
    sizeBytes: row.sizeBytes,
    metadata: parseJson(row.metadataJson, {}),
    updatedAt: row.updatedAt,
  }
}

function getModelResourceManifest(category: ModelResourceCategory): ModelResourceManifest {
  return builtInModelManifests[category]
}

function getModelResourcesRoot(): string {
  const config = getServerConfig()
  const namespaceRoot = config.dataDir
    ? resolve(config.dataDir, 'chronicle')
    : resolve(homedir(), '.cradle', 'chronicle')
  return resolve(namespaceRoot, 'models')
}

function getModelResourceAbsolutePath(relativePath: string): string {
  const root = getModelResourcesRoot()
  const target = resolve(root, relativePath)
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new AppError({
      code: 'chronicle_model_resource_path_invalid',
      status: 400,
      message: 'Model resource path must stay under Chronicle models root',
    })
  }
  return target
}

function rootRelativeModelPath(absolutePath: string): string {
  const root = getModelResourcesRoot()
  const rel = relative(root, resolve(absolutePath))
  return rel.startsWith('..') || isAbsolute(rel) ? absolutePath : rel
}

function buildModelResourceMetadata(
  manifest: ModelResourceManifest,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...(manifest.metadata ?? {}),
    manifest: {
      category: manifest.category,
      version: manifest.version,
      runtime: manifest.runtime,
      required: manifest.required,
      files: manifest.files,
    },
    modelsRoot: getModelResourcesRoot(),
    ...extra,
  }
}

async function checkModelResourceFiles(manifest: ModelResourceManifest): Promise<ModelResourceFileCheck[]> {
  const checks: ModelResourceFileCheck[] = []
  for (const file of manifest.files) {
    const absolutePath = getModelResourceAbsolutePath(file.path)
    const stats = await stat(absolutePath).catch(() => null)
    const exists = !!stats?.isFile()
    const actualSha256 = exists && file.sha256 ? await sha256File(absolutePath) : undefined
    checks.push({
      relativePath: file.path,
      absolutePath,
      required: file.required !== false,
      exists,
      expectedSizeBytes: file.sizeBytes,
      actualSizeBytes: stats?.isFile() ? stats.size : undefined,
      sha256: file.sha256,
      actualSha256,
    })
  }
  return checks
}

function assertManifestInstallAllowed(manifest: ModelResourceManifest): void {
  const unsafeFiles = manifest.files.filter(file => !file.sourceUrl)
  if (unsafeFiles.length > 0) {
    throw new AppError({
      code: 'chronicle_model_resource_manifest_unverified',
      status: 400,
      message: 'Manifest install requires a source URL for every file',
    })
  }
}

async function resolveModelResourceLocalSource(
  files: ModelResourceLocalFileInput[],
  sourceRoot: string | null,
  manifestFile: ModelResourceFileManifest,
  manifestFileCount: number,
): Promise<string> {
  const direct = files.find(file => file.relativePath === manifestFile.path)
  const fallbackName = basename(manifestFile.path)
  const byName = fallbackName ? files.find(file => file.relativePath === fallbackName) : undefined
  const sourcePath = normalizeNullableString((direct ?? byName)?.sourcePath)
  if (sourcePath) {
    return assertLocalModelSourceFile(sourcePath, manifestFile.path)
  }

  if (sourceRoot) {
    const root = resolve(sourceRoot)
    const rootStats = await stat(root).catch(() => null)
    if (rootStats?.isFile() && manifestFileCount === 1) {
      return root
    }
    if (rootStats?.isDirectory()) {
      const relativeCandidate = resolve(root, manifestFile.path)
      if (await isFile(relativeCandidate)) {
        return relativeCandidate
      }
      const basenameCandidate = resolve(root, basename(manifestFile.path))
      if (await isFile(basenameCandidate)) {
        return basenameCandidate
      }
    }
  }

  throw new AppError({
    code: 'chronicle_model_resource_file_missing',
    status: 400,
    message: `Missing source file for ${manifestFile.path}`,
  })
}

async function assertLocalModelSourceFile(sourcePath: string, manifestPath: string): Promise<string> {
  const resolved = resolve(sourcePath)
  const stats = await stat(resolved).catch(() => null)
  if (!stats?.isFile()) {
    throw new AppError({
      code: 'chronicle_model_resource_source_invalid',
      status: 400,
      message: `Model source file does not exist: ${manifestPath}`,
    })
  }
  return resolved
}

async function isFile(path: string): Promise<boolean> {
  return !!(await stat(path).catch(() => null))?.isFile()
}

async function verifyStagedModelFile(file: ModelResourceFileManifest, path: string): Promise<void> {
  const stats = await stat(path)
  if (!stats.isFile()) {
    throw new Error(`Model resource is not a file: ${file.path}`)
  }
  if (file.sizeBytes !== undefined && stats.size !== file.sizeBytes) {
    throw new Error(`Size check failed for ${file.path}`)
  }
  if (file.sha256) {
    const actualSha256 = await sha256File(path)
    if (actualSha256 !== file.sha256) {
      throw new Error(`Checksum failed for ${file.path}`)
    }
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

async function downloadModelResourceFile(file: ModelResourceFileManifest, targetPath: string, category: string): Promise<void> {
  const urls = [file.sourceUrl, ...(file.fallbackUrls ?? [])].filter((url): url is string => !!url)
  let lastError: unknown = null
  const progressContext = { category, file: file.path }
  for (const url of urls) {
    // Retry each URL up to 3 times with exponential backoff
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await downloadToFile(url, targetPath, progressContext)
        return
      }
      catch (error) {
        lastError = error
        await rm(targetPath, { force: true }).catch(() => {})
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
        }
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : 'no source URL'
  emitDownloadProgress({ ...progressContext, totalBytes: null, downloadedBytes: 0, status: 'error', error: message, startedAt: Date.now() })
  throw new Error(`Model resource download failed for ${file.path}: ${message}`)
}

async function downloadToFile(sourceUrl: string, targetPath: string, progressContext?: { category: string, file: string }): Promise<void> {
  const parsed = new URL(sourceUrl)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError({
      code: 'chronicle_model_resource_url_invalid',
      status: 400,
      message: 'Model resource URL must use http or https',
    })
  }
  const response = await fetch(sourceUrl, {
    headers: { 'User-Agent': 'Cradle/1.0' },
    redirect: 'follow',
  })
  if (!response.ok) {
    throw new Error(`Model resource download failed: ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error('Model resource download returned no body')
  }

  const contentLength = response.headers.get('content-length')
  const totalBytes = contentLength ? Number.parseInt(contentLength, 10) : null

  if (progressContext) {
    emitDownloadProgress({
      category: progressContext.category,
      file: progressContext.file,
      totalBytes,
      downloadedBytes: 0,
      status: 'downloading',
      startedAt: Date.now(),
    })
  }

  const nodeStream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  const fileStream = createWriteStream(targetPath)

  let downloadedBytes = 0
  nodeStream.on('data', (chunk: Buffer) => {
    downloadedBytes += chunk.length
    if (progressContext) {
      emitDownloadProgress({
        category: progressContext.category,
        file: progressContext.file,
        totalBytes,
        downloadedBytes,
        status: 'downloading',
        startedAt: Date.now(),
      })
    }
  })

  await pipeline(nodeStream, fileStream)

  if (progressContext) {
    emitDownloadProgress({
      category: progressContext.category,
      file: progressContext.file,
      totalBytes,
      downloadedBytes,
      status: 'done',
      startedAt: Date.now(),
    })
  }
}

async function readFrameImage(relativeOrAbsolutePath: string): Promise<Response | null> {
  const config = await getConfig()
  const storageRoot = resolve(config.storageRoot)
  const resolvedPath = isAbsolute(relativeOrAbsolutePath)
    ? resolve(relativeOrAbsolutePath)
    : resolve(storageRoot, relativeOrAbsolutePath)
  const rel = relative(storageRoot, resolvedPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return null
  }

  try {
    const data = await readFile(resolvedPath)
    const ext = resolvedPath.split('.').pop()?.toLowerCase()
    const contentType = ext === 'png'
      ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : 'application/octet-stream'
    return new Response(data, { headers: { 'Content-Type': contentType } })
  }
  catch {
    return null
  }
}

function toMemoryEntry(
  row: typeof chronicleMemories.$inferSelect,
  match?: MemorySearchScore,
): MemoryEntry {
  const keywordScore = match?.keywordScore ?? 0
  const semanticScore = match?.semanticScore ?? 0
  const matchKind = keywordScore > 0 && semanticScore > 0
    ? 'hybrid'
    : semanticScore > 0
      ? 'semantic'
      : keywordScore > 0
        ? 'keyword'
        : null

  return {
    id: row.id,
    type: row.type,
    source: row.source,
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
    content: row.content,
    modelId: row.modelId,
    matchKind,
    keywordScore: matchKind ? Number(keywordScore.toFixed(4)) : null,
    semanticScore: matchKind ? Number(semanticScore.toFixed(4)) : null,
  }
}

function reconcileMemorySearchIndex(): void {
  const currentDbPath = getServerConfig().dbPath
  if (memorySearchIndexReconciledDbPath === currentDbPath) {
    return
  }
  const memories = db().select().from(chronicleMemories).all()
  db().transaction((tx) => {
    for (const memory of memories) {
      const contentHash = memory.contentHash ?? hashText(canonicalizeMemoryContent(memory.content))
      const chunkExists = tx
        .select({ id: chronicleMemoryChunks.id })
        .from(chronicleMemoryChunks)
        .where(eq(chronicleMemoryChunks.memoryId, memory.id))
        .limit(1)
        .get()
      const keywordExists = tx
        .select({ id: chronicleMemoryKeywords.id })
        .from(chronicleMemoryKeywords)
        .where(eq(chronicleMemoryKeywords.memoryId, memory.id))
        .limit(1)
        .get()
      const embeddingExists = tx
        .select({ id: chronicleMemoryEmbeddings.id })
        .from(chronicleMemoryEmbeddings)
        .where(eq(chronicleMemoryEmbeddings.memoryId, memory.id))
        .limit(1)
        .get()
      const nextMemory = memory.contentHash === contentHash
        ? memory
        : { ...memory, contentHash }

      if (memory.contentHash !== contentHash) {
        tx.update(chronicleMemories).set({
          contentHash,
          updatedAt: Math.max(memory.updatedAt, currentUnixSeconds()),
        }).where(eq(chronicleMemories.id, memory.id)).run()
      }
      if (!chunkExists || !keywordExists || !embeddingExists) {
        syncMemorySearchIndex(tx, nextMemory)
      }
    }
  })
  memorySearchIndexReconciledDbPath = currentDbPath
}

function findDuplicateMemory(
  contentHash: string,
  canonicalContent: string,
  excludeMemoryId?: string,
): typeof chronicleMemories.$inferSelect | null {
  return db()
    .select()
    .from(chronicleMemories)
    .where(eq(chronicleMemories.contentHash, contentHash))
    .all()
    .find(row => row.id !== excludeMemoryId && canonicalizeMemoryContent(row.content) === canonicalContent)
    ?? null
}

function mergeDuplicateMemory(
  tx: ChronicleTx,
  duplicate: typeof chronicleMemories.$inferSelect,
  input: {
    sourceId: string
    sourcePaths: string[]
    sourceSnapshotIds: string[]
    now: number
    contentHash: string
  },
): typeof chronicleMemories.$inferSelect {
  const mergedSourceIds = [...new Set([
    ...readStringArrayFromMetadata(duplicate.metadataJson, 'duplicateSourceIds'),
    input.sourceId,
  ])]
  const mergedSourcePaths = [...new Set([
    ...parseJson<string[]>(duplicate.sourcePathsJson, []),
    ...input.sourcePaths,
  ])]
  const mergedSourceSnapshotIds = [...new Set([
    ...parseJson<string[]>(duplicate.sourceSnapshotIdsJson, []),
    ...input.sourceSnapshotIds,
  ])]
  const metadata = {
    ...parseJson<Record<string, unknown>>(duplicate.metadataJson, {}),
    duplicateSourceIds: mergedSourceIds,
    duplicateLastSeenAt: input.now,
  }
  tx.update(chronicleMemories).set({
    contentHash: input.contentHash,
    sourceSnapshotIdsJson: JSON.stringify(mergedSourceSnapshotIds),
    sourcePathsJson: JSON.stringify(mergedSourcePaths),
    metadataJson: JSON.stringify(metadata),
    updatedAt: input.now,
  }).where(eq(chronicleMemories.id, duplicate.id)).run()
  const merged = tx.select().from(chronicleMemories).where(eq(chronicleMemories.id, duplicate.id)).get()!
  syncMemorySearchIndex(tx, merged)
  return merged
}

function syncMemorySearchIndex(tx: ChronicleTx, memory: typeof chronicleMemories.$inferSelect): void {
  const now = currentUnixSeconds()
  tx.delete(chronicleMemoryKeywords).where(eq(chronicleMemoryKeywords.memoryId, memory.id)).run()
  tx.delete(chronicleMemoryEmbeddings).where(eq(chronicleMemoryEmbeddings.memoryId, memory.id)).run()
  tx.delete(chronicleMemoryChunks).where(eq(chronicleMemoryChunks.memoryId, memory.id)).run()

  const chunks = splitMemoryContent(memory.content)
  for (const [chunkIndex, chunkContent] of chunks.entries()) {
    const chunkId = randomUUID()
    const contentTerms = countTerms(tokenizeMemoryText(chunkContent))
    const promptTerms = countTerms(tokenizeMemoryText(memory.prompt ?? ''))
    const metadataTerms = countTerms(tokenizeMemoryText(memory.metadataJson))
    const tokenCount = [...contentTerms.values()].reduce((sum, count) => sum + count, 0)

    tx.insert(chronicleMemoryChunks).values({
      id: chunkId,
      memoryId: memory.id,
      chunkIndex,
      content: chunkContent,
      contentHash: hashText(canonicalizeMemoryContent(chunkContent)),
      tokenCount,
      embeddingStatus: 'missing',
      embeddingModelId: null,
      metadataJson: JSON.stringify({
        source: 'chronicle-memory',
        contentHash: memory.contentHash,
      }),
      createdAt: now,
      updatedAt: now,
    }).run()

    insertMemoryKeywords(tx, memory.id, chunkId, 'content', contentTerms, 3, now)
    insertMemoryKeywords(tx, memory.id, chunkId, 'prompt', promptTerms, 2, now)
    insertMemoryKeywords(tx, memory.id, chunkId, 'metadata', metadataTerms, 1, now)
    insertMemoryEmbedding(tx, memory.id, chunkId, chunkContent, now)
  }
}

function insertMemoryEmbedding(
  tx: ChronicleTx,
  memoryId: string,
  chunkId: string,
  content: string,
  now: number,
): void {
  const embedding = buildTextEmbeddingVector(content)
  const vectorJson = JSON.stringify(embedding.vector)
  tx.insert(chronicleMemoryEmbeddings).values({
    id: randomUUID(),
    memoryId,
    chunkId,
    modelId: embedding.modelId,
    modelVersion: embedding.modelVersion,
    dimensions: embedding.vector.length,
    vectorJson,
    vectorHash: hashText(vectorJson),
    status: 'ready',
    metadataJson: JSON.stringify({
      provider: embedding.provider === 'onnx' ? 'chronicle-onnx' : 'chronicle-lexical',
      runtime: embedding.provider === 'onnx' ? 'local-onnx' : 'deterministic-local',
    }),
    createdAt: now,
    updatedAt: now,
  }).run()

  if (embedding.provider === 'onnx') {
    tx.update(chronicleMemoryChunks).set({
      embeddingStatus: 'ready',
      embeddingModelId: embedding.modelId,
      updatedAt: now,
    }).where(eq(chronicleMemoryChunks.id, chunkId)).run()
  }
}

function insertMemoryKeywords(
  tx: ChronicleTx,
  memoryId: string,
  chunkId: string,
  source: 'content' | 'prompt' | 'metadata',
  terms: Map<string, number>,
  weight: number,
  createdAt: number,
): void {
  for (const [term, occurrences] of terms) {
    tx.insert(chronicleMemoryKeywords).values({
      id: randomUUID(),
      memoryId,
      chunkId,
      term,
      source,
      occurrences,
      weight,
      createdAt,
    }).run()
  }
}

function splitMemoryContent(content: string): string[] {
  const trimmed = content.trim()
  if (!trimmed) {
    return ['']
  }
  const chunks: string[] = []
  for (let offset = 0; offset < trimmed.length; offset += MEMORY_CHUNK_MAX_CHARS) {
    chunks.push(trimmed.slice(offset, offset + MEMORY_CHUNK_MAX_CHARS))
  }
  return chunks
}

function canonicalizeMemoryContent(content: string): string {
  return content
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function tokenizeMemoryText(text: string): string[] {
  const normalized = canonicalizeMemoryContent(text)
  const matches = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? []
  return matches
    .map(term => term.replace(/^[-_]+|[-_]+$/g, ''))
    .filter(term => term.length >= MEMORY_TOKEN_MIN_LENGTH)
}

function countTerms(terms: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const term of terms) {
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }
  return counts
}

function buildCombinedMemorySearchScore(match: MemorySearchScore, phraseContained: boolean): number {
  const phraseBoost = phraseContained ? 100 : 0
  return phraseBoost + match.keywordScore + match.semanticScore * MEMORY_SEMANTIC_SCORE_WEIGHT
}

function currentTextEmbeddingVectorMode(): string {
  return onnxEmbeddingResourceAvailable()
    ? `${ONNX_TEXT_EMBEDDING_MODEL_ID}/${ONNX_TEXT_EMBEDDING_MODEL_VERSION}`
    : `${MEMORY_EMBEDDING_MODEL_ID}/${MEMORY_EMBEDDING_MODEL_VERSION}`
}

function buildTextEmbeddingVector(text: string): TextEmbeddingVector {
  if (onnxEmbeddingResourceAvailable()) {
    try {
      const response = DaemonManager.runEmbeddingBatch([text], getModelResourcesRoot())
      validateEmbeddingBatch(response.embeddings, 1, response.dimensions)
      return {
        vector: response.embeddings[0]!,
        modelId: response.modelId,
        modelVersion: response.modelVersion,
        provider: 'onnx',
      }
    }
    catch (error) {
      recordEvent({
        type: 'model-resource',
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        attrs: { category: 'embedding', runtime: 'local-onnx' },
      })
    }
  }

  return {
    vector: buildLexicalEmbeddingVector(text),
    modelId: MEMORY_EMBEDDING_MODEL_ID,
    modelVersion: MEMORY_EMBEDDING_MODEL_VERSION,
    provider: 'lexical',
  }
}

function onnxEmbeddingResourceAvailable(): boolean {
  const manifest = getModelResourceManifest('embedding')
  return manifest.files
    .filter(file => file.required !== false)
    .every(file => existsSync(getModelResourceAbsolutePath(file.path)))
}

function validateEmbeddingBatch(embeddings: number[][], expectedCount: number, dimensions: number): void {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('embedding response has invalid dimensions')
  }
  if (embeddings.length !== expectedCount) {
    throw new Error('embedding response has an invalid embedding count')
  }
  for (const embedding of embeddings) {
    if (embedding.length !== dimensions || embedding.some(value => !Number.isFinite(value))) {
      throw new Error('embedding response contains an invalid vector')
    }
  }
}

function buildLexicalEmbeddingVector(text: string): number[] {
  const vector = Array.from({ length: MEMORY_EMBEDDING_DIMENSIONS }, () => 0)
  for (const term of tokenizeMemoryText(text)) {
    vector[stableTermIndex(`term:${term}`)] += 1
    for (const trigram of termTrigrams(term)) {
      vector[stableTermIndex(`tri:${trigram}`)] += 0.35
    }
  }
  return normalizeVector(vector)
}

function termTrigrams(term: string): string[] {
  if (term.length <= 3) {
    return [term]
  }
  const trigrams: string[] = []
  for (let index = 0; index <= term.length - 3; index += 1) {
    trigrams.push(term.slice(index, index + 3))
  }
  return trigrams
}

function stableTermIndex(term: string): number {
  const digest = createHash('sha256').update(term).digest()
  return digest.readUInt32BE(0) % MEMORY_EMBEDDING_DIMENSIONS
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) {
    return vector
  }
  return vector.map(value => Number((value / norm).toFixed(6)))
}

function parseEmbeddingVector(vectorJson: string, dimensions: number): number[] | null {
  const parsed = parseJson<unknown>(vectorJson, null)
  if (!Array.isArray(parsed) || parsed.length !== dimensions) {
    return null
  }
  const vector = parsed.map(value => typeof value === 'number' && Number.isFinite(value) ? value : null)
  return vector.every(value => value !== null) ? vector as number[] : null
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0
  }
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function readStringArrayFromMetadata(metadataJson: string, key: string): string[] {
  const metadata = parseJson<Record<string, unknown>>(metadataJson, {})
  const value = metadata[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function findSnapshotIdsByPaths(paths: string[]): string[] {
  if (paths.length === 0) {
    return []
  }
  const config = syncConfig()
  const normalized = new Set(paths.map(path => toRootRelative(config.storageRoot, path)))
  const rows = db().select().from(chronicleSnapshots).all()
  return rows
    .filter(row => normalized.has(row.artifactPath ?? '') || normalized.has(row.framePath))
    .map(row => row.id)
}

function parseTimestamp(value: string): number | null {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }
  const asDate = Date.parse(normalized.replace(/(\d{2})-(\d{2})-(\d{2})Z$/, '$1:$2:$3Z'))
  if (!Number.isNaN(asDate)) {
    return Math.floor(asDate / 1000)
  }
  const asNumber = Number(normalized)
  return Number.isFinite(asNumber) ? Math.floor(asNumber) : null
}

function readRequiredAudioTimestamp(value: string, field: 'startedAt' | 'endedAt' | 'lastSeenAt'): number {
  const parsed = parseTimestamp(value)
  if (parsed !== null) {
    return parsed
  }
  throw new AppError({
    code: 'chronicle_audio_transcript_timestamp_invalid',
    status: 400,
    message: `Audio transcript ${field} must be a valid timestamp`,
  })
}

function readRequiredAudioRawSegmentTimestamp(value: string): number {
  const parsed = parseTimestamp(value)
  if (parsed !== null) {
    return parsed
  }
  throw new AppError({
    code: 'chronicle_audio_raw_segment_timestamp_invalid',
    status: 400,
    message: 'Audio raw segment recordedAt must be a valid timestamp',
  })
}

function estimateAudioDurationMs(sampleCount: number, sampleRate: number): number {
  if (!Number.isFinite(sampleCount) || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return 0
  }
  return Math.round((Math.max(0, sampleCount) / sampleRate) * 1000)
}

function ratioToBps(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000)
}

function bpsToRatio(value: number): number {
  return Number((value / 10_000).toFixed(4))
}

function validateAudioTranscriptSegments(segments: AudioTranscriptSegmentInput[]): void {
  for (const [index, segment] of segments.entries()) {
    if (segment.endMs !== undefined && segment.endMs !== null && segment.endMs < segment.startMs) {
      throw new AppError({
        code: 'chronicle_audio_transcript_segment_range_invalid',
        status: 400,
        message: `Audio transcript segment ${index} endMs must be greater than or equal to startMs`,
      })
    }
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function boundedString(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  }
  catch {
    return fallback
  }
}

function toRootRelative(storageRoot: string, path: string): string {
  const root = resolve(storageRoot)
  const resolved = isAbsolute(path) ? resolve(path) : resolve(root, path)
  const rel = relative(root, resolved)
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel
}

function resolveRelativeJoin(segment: string, frame: string): string {
  return `${segment.replace(/^\/+/, '')}/${frame.replace(/^\/+/, '')}`
}
