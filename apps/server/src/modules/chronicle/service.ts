import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import { generateText } from 'ai'
import {
  chronicleEvents,
  chronicleMemories,
  chronicleMessages,
  chronicleMessageSources,
  chronicleModelResources,
  chronicleSnapshots,
} from '@cradle/db'
import { desc, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db, getServerConfig } from '../../infra'
import { createLanguageModel, detectApiFormat } from '../chat-runtime/engine/providers'
import * as Profiles from '../profiles/service'
import { parseConfigWith } from '../providers/provider-base'
import { readSecret } from '../secrets/service'
import * as DaemonManager from './daemon-manager'

interface ChronicleConfig {
  profileId: string
  modelId: string
  workspaceId: string
  enabled: boolean
  storageRoot: string
}

const defaultConfig: ChronicleConfig = {
  profileId: '',
  modelId: '',
  workspaceId: '',
  enabled: false,
  storageRoot: resolve(homedir(), '.cradle', 'chronicle'),
}

const ProfileConfigSchema = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  modelId: z.string().optional(),
  apiKey: z.string().optional(),
  apiMode: z.enum(['responses', 'chat-completions']).optional(),
})

const SLACK_SYNC_INTERVAL_MS = 60_000

type ModelResourceCategory = 'ocr' | 'audio-vad' | 'audio-asr' | 'speaker' | 'embedding'
type ModelResourceStatus = 'available' | 'missing' | 'installing' | 'installed' | 'error'
type SlackSyncTrigger = 'manual' | 'background'

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
  files?: ModelResourceLocalFileInput[]
}

let slackSyncTimer: ReturnType<typeof setInterval> | null = null
let slackSyncRunning = false
const activeSlackSyncs = new Set<string>()

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
    displayName: 'Speaker Embedding',
    version: 'sherpa-speaker',
    runtime: 'sherpa-onnx',
    required: false,
    message: 'Place a Sherpa speaker embedding model manifest to enable speaker labeling.',
    files: [{ path: 'speaker/model.onnx', required: true }],
    metadata: { requiredFor: ['speaker-labeling'] },
  },
  'embedding': {
    category: 'embedding',
    displayName: 'Text Embedding',
    version: 'local-onnx',
    runtime: 'onnx',
    required: false,
    message: 'Place a text embedding ONNX model and tokenizer files to enable semantic search and deduplication.',
    files: [
      { path: 'embedding/model.onnx', required: true },
      { path: 'embedding/tokenizer.json', required: true },
    ],
    metadata: { requiredFor: ['semantic-search', 'deduplication'], distance: 'cosine' },
  },
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
  platform?: 'slack' | null
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

export interface MessageSourceEntry {
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
}

export interface MessageSourcePatchInput {
  label?: string
  enabled?: boolean
  workspaceId?: string | null
  teamId?: string | null
  botTokenRef?: string | null
  channelIds?: string[]
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
    const parsed = JSON.parse(content)
    return {
      profileId: readString(parsed.profileId) ?? defaultConfig.profileId,
      modelId: readString(parsed.modelId) ?? defaultConfig.modelId,
      workspaceId: readString(parsed.workspaceId) ?? defaultConfig.workspaceId,
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : defaultConfig.enabled,
      storageRoot: readString(parsed.storageRoot) ?? defaultConfig.storageRoot,
    }
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

export async function updateConfig(config: ChronicleConfig): Promise<ChronicleConfig> {
  const previous = await getConfig()
  const next = {
    ...config,
    storageRoot: resolve(config.storageRoot || defaultConfig.storageRoot),
  }
  await saveConfig(next)
  recordEvent({
    type: 'config',
    status: 'success',
    message: next.enabled ? 'Chronicle enabled' : 'Chronicle disabled',
    attrs: { storageRoot: next.storageRoot, profileId: next.profileId, modelId: next.modelId },
  })

  if (next.enabled && !previous.enabled) {
    const started = DaemonManager.startDaemon(next.storageRoot)
    recordEvent({
      type: 'daemon',
      status: started ? 'success' : 'error',
      message: started ? 'Chronicle daemon start requested' : 'Chronicle daemon failed to start',
    })
  }
  else if (!next.enabled && previous.enabled) {
    DaemonManager.stopDaemon()
    recordEvent({ type: 'daemon', status: 'success', message: 'Chronicle daemon stop requested' })
  }

  return next
}

export async function summarize(body: {
  prompt: string
  windowType: '10min' | '6h'
  sourceSnapshotIds?: string[]
  sourceArtifactPaths?: string[]
}): Promise<{ summary: string, memoryId: string | null, status: 'success' | 'error' }> {
  const config = await getConfig()
  const failure = validateSummaryConfig(config)
  if (failure) {
    recordEvent({ type: 'summarize', status: 'error', message: failure })
    return { summary: `[Chronicle error - ${failure}]`, memoryId: null, status: 'error' }
  }

  const profile = Profiles.getProfile(config.profileId)!
  const parsedConfig = parseConfigWith(profile.configJson, ProfileConfigSchema)
  const apiKey = resolveProfileApiKey(profile.credentialRef, parsedConfig.apiKey)
  if (!apiKey) {
    const message = 'no API key available for profile'
    recordEvent({ type: 'summarize', status: 'error', message, attrs: { profileId: config.profileId } })
    return { summary: `[Chronicle error - ${message}]`, memoryId: null, status: 'error' }
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

  try {
    const result = await generateText({
      model,
      prompt: body.prompt,
      maxRetries: 1,
      timeout: 120_000,
    })
    const usage = {
      promptTokens: result.usage.inputTokens ?? 0,
      completionTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
    }
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
      modelId,
      profileId: config.profileId,
      usage,
      sourceSnapshotIds: body.sourceSnapshotIds ?? [],
    })
    recordEvent({
      type: 'summarize',
      status: 'success',
      message: 'Chronicle summary generated',
      memoryId: memory.id,
      attrs: { modelId, profileId: config.profileId, usage },
    })
    return { summary: result.text, memoryId: memory.id, status: 'success' }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    recordEvent({
      type: 'summarize',
      status: 'error',
      message,
      attrs: { modelId, profileId: config.profileId },
    })
    return { summary: `[Chronicle error - ${message}]`, memoryId: null, status: 'error' }
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
    configuredModel: await getConfiguredModel(config),
  }
}

export function getDaemonResources() {
  return DaemonManager.getDaemonResources()
}

export async function initDaemon(): Promise<void> {
  const config = await getConfig()
  if (config.enabled) {
    DaemonManager.startDaemon(config.storageRoot)
  }
}

export function startSlackBackgroundSync(): void {
  if (slackSyncTimer) {
    return
  }

  void runSlackSyncTick()
  slackSyncTimer = setInterval(() => {
    void runSlackSyncTick()
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

  return [...snapshots, ...messages]
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
    .map(toMemoryEntry)
}

export function searchMemories(query: string, limit = 20): MemoryEntry[] {
  const needle = query.trim()
  if (!needle) {
    return getMemories(limit)
  }
  return db()
    .select()
    .from(chronicleMemories)
    .where(or(
      sql`instr(lower(${chronicleMemories.content}), lower(${needle})) > 0`,
      sql`instr(lower(coalesce(${chronicleMemories.prompt}, '')), lower(${needle})) > 0`,
      sql`instr(lower(${chronicleMemories.metadataJson}), lower(${needle})) > 0`,
    ))
    .orderBy(desc(chronicleMemories.createdAt))
    .limit(limit)
    .all()
    .map(toMemoryEntry)
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
      path: rootRelativeModelPath(firstModelPath),
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
  if (source === 'local-files' && localFiles.length === 0) {
    throw new AppError({
      code: 'chronicle_model_resource_source_missing',
      status: 400,
      message: 'Local model resource install requires files',
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
        const resolvedSource = await resolveModelResourceLocalSource(localFiles, file)
        await copyFile(resolvedSource, tempPath)
      }
      else {
        await downloadToFile(file.sourceUrl!, tempPath)
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
  db().insert(chronicleMessageSources).values({
    id,
    platform: input.platform,
    label: input.label,
    enabled: input.enabled,
    workspaceId: normalizeNullableString(input.workspaceId),
    teamId: normalizeNullableString(input.teamId),
    botTokenRef: normalizeNullableString(input.botTokenRef),
    channelIdsJson: JSON.stringify(normalizeChannelIds(input.channelIds)),
    configJson: '{}',
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
  db().update(chronicleMessageSources).set({
    label: input.label ?? existing.label,
    enabled: nextEnabled,
    workspaceId: input.workspaceId === undefined ? existing.workspaceId : normalizeNullableString(input.workspaceId),
    teamId: input.teamId === undefined ? existing.teamId : normalizeNullableString(input.teamId),
    botTokenRef: input.botTokenRef === undefined ? existing.botTokenRef : normalizeNullableString(input.botTokenRef),
    channelIdsJson: input.channelIds === undefined ? existing.channelIdsJson : JSON.stringify(normalizeChannelIds(input.channelIds)),
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
    return db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.id, existing.id)).get()!
  }

  const id = randomUUID()
  db().insert(chronicleSnapshots).values({ id, ...values, createdAt: now }).run()
  recordEvent({
    type: 'snapshot',
    status: 'success',
    message: 'Chronicle snapshot ingested',
    snapshotId: id,
    attrs: { sourceId: input.sourceId, framePath: values.framePath },
  })
  return db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.id, id)).get()!
}

export function recordMemory(
  input: ChronicleMemoryReportInput,
  options: {
    prompt?: string
    modelId?: string
    profileId?: string
    usage?: { promptTokens: number, completionTokens: number, totalTokens: number }
    sourceSnapshotIds?: string[]
  } = {},
) {
  const config = syncConfig()
  const now = currentUnixSeconds()
  const createdAt = parseTimestamp(input.createdAt) ?? now
  const existing = db().select().from(chronicleMemories).where(eq(chronicleMemories.sourceId, input.sourceId)).get()
  const sourceSnapshotIds = options.sourceSnapshotIds ?? findSnapshotIdsByPaths(input.sourceSnapshotPaths ?? [])
  const sourcePaths = [...new Set([
    ...(input.memoryPath ? [toRootRelative(config.storageRoot, input.memoryPath)] : []),
    ...(input.sourceSnapshotPaths ?? []).map(path => toRootRelative(config.storageRoot, path)),
    ...(input.sourceFramePaths ?? []).map(path => toRootRelative(config.storageRoot, path)),
  ])]
  const values = {
    sourceId: input.sourceId,
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
    db().update(chronicleMemories).set(values).where(eq(chronicleMemories.id, existing.id)).run()
    return db().select().from(chronicleMemories).where(eq(chronicleMemories.id, existing.id)).get()!
  }

  const id = randomUUID()
  db().insert(chronicleMemories).values({ id, ...values }).run()
  recordEvent({
    type: 'memory',
    status: 'success',
    message: 'Chronicle memory ingested',
    memoryId: id,
    attrs: { sourceId: input.sourceId, source: input.summaryKind },
  })
  return db().select().from(chronicleMemories).where(eq(chronicleMemories.id, id)).get()!
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
  const config = getServerConfig()
  const filePath = resolve(config.dataDir ?? dirname(config.dbPath), 'preferences', 'chronicle.json')
  try {
    const content = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(content)
    return {
      profileId: readString(parsed.profileId) ?? defaultConfig.profileId,
      modelId: readString(parsed.modelId) ?? defaultConfig.modelId,
      workspaceId: readString(parsed.workspaceId) ?? defaultConfig.workspaceId,
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : defaultConfig.enabled,
      storageRoot: readString(parsed.storageRoot) ?? defaultConfig.storageRoot,
    }
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
  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    enabled: row.enabled,
    workspaceId: row.workspaceId,
    teamId: row.teamId,
    botTokenRef: row.botTokenRef,
    channelIds: parseJson<string[]>(row.channelIdsJson, []),
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
  recordMemory({
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
  const parsedConfig = parseConfigWith(profile.configJson, ProfileConfigSchema)
  return config.modelId || parsedConfig.modelId || parsedConfig.model || null
}

function recordEvent(input: {
  type: 'config' | 'daemon' | 'snapshot' | 'memory' | 'summarize' | 'model-resource' | 'message'
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
      continue
    }
    const status = manifest.files.length === 0 ? 'available' : 'missing'
    d.insert(chronicleModelResources).values({
      id: randomUUID(),
      category: manifest.category,
      status,
      displayName: manifest.displayName,
      path: manifest.files[0]?.path ?? null,
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
  const unsafeFiles = manifest.files.filter(file => !file.sourceUrl || !file.sha256 || file.sizeBytes === undefined)
  if (unsafeFiles.length > 0) {
    throw new AppError({
      code: 'chronicle_model_resource_manifest_unverified',
      status: 400,
      message: 'Manifest install requires source URL, SHA256, and size for every file',
    })
  }
}

async function resolveModelResourceLocalSource(
  files: ModelResourceLocalFileInput[],
  manifestFile: ModelResourceFileManifest,
): Promise<string> {
  const direct = files.find(file => file.relativePath === manifestFile.path)
  const fallbackName = manifestFile.path.split('/').at(-1)
  const byName = fallbackName ? files.find(file => file.relativePath === fallbackName) : undefined
  const sourcePath = normalizeNullableString((direct ?? byName)?.sourcePath)
  if (!sourcePath) {
    throw new AppError({
      code: 'chronicle_model_resource_file_missing',
      status: 400,
      message: `Missing source file for ${manifestFile.path}`,
    })
  }
  const resolved = resolve(sourcePath)
  const stats = await stat(resolved).catch(() => null)
  if (!stats?.isFile()) {
    throw new AppError({
      code: 'chronicle_model_resource_source_invalid',
      status: 400,
      message: `Model source file does not exist: ${manifestFile.path}`,
    })
  }
  return resolved
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

async function downloadToFile(sourceUrl: string, targetPath: string): Promise<void> {
  const parsed = new URL(sourceUrl)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError({
      code: 'chronicle_model_resource_url_invalid',
      status: 400,
      message: 'Model resource URL must use http or https',
    })
  }
  const response = await fetch(sourceUrl)
  if (!response.ok || !response.body) {
    throw new Error(`Model resource download failed: ${response.status}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  await writeFile(targetPath, bytes)
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

function toMemoryEntry(row: typeof chronicleMemories.$inferSelect): MemoryEntry {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
    content: row.content,
    modelId: row.modelId,
  }
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
  const asDate = Date.parse(value.replace(/(\d{2})-(\d{2})-(\d{2})Z$/, '$1:$2:$3Z'))
  if (!Number.isNaN(asDate)) {
    return Math.floor(asDate / 1000)
  }
  const asNumber = Number(value)
  return Number.isFinite(asNumber) ? Math.floor(asNumber) : null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
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
