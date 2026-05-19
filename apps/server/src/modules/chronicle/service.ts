// Input: Chronicle configuration from preferences, profile/secrets for AI calls
// Output: Chronicle config, AI-generated summaries, daemon status
// Position: apps/server/src/modules/chronicle/service.ts

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { generateText } from 'ai'
import { z } from 'zod'

import { getServerConfig } from '../../infra'
import { createLanguageModel, detectApiFormat } from '../chat-runtime/engine/providers'
import * as Profiles from '../profiles/service'
import { parseConfigWith } from '../providers/provider-base'
import { readSecret } from '../secrets/service'
import * as DaemonManager from './daemon-manager'

// Regex to convert filesystem timestamps (2026-05-19T06-52-40Z) to ISO format
const FILESYSTEM_TIMESTAMP_RE = /(\d{2})-(\d{2})-(\d{2})Z$/

// ── config persistence ──

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
  storageRoot: join(homedir(), '.cradle', 'chronicle'),
}

function getConfigPath(): string {
  const config = getServerConfig()
  const baseDir = config.dataDir ?? dirname(config.dbPath)
  return join(baseDir, 'preferences', 'chronicle.json')
}

export async function getConfig(): Promise<ChronicleConfig> {
  const filePath = getConfigPath()
  try {
    const content = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(content)
    return {
      profileId: parsed.profileId ?? defaultConfig.profileId,
      modelId: parsed.modelId ?? defaultConfig.modelId,
      workspaceId: parsed.workspaceId ?? defaultConfig.workspaceId,
      enabled: parsed.enabled ?? defaultConfig.enabled,
      storageRoot: parsed.storageRoot ?? defaultConfig.storageRoot,
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
  await saveConfig(config)

  if (config.enabled && !previous.enabled) {
    DaemonManager.startDaemon(config.storageRoot)
  }
  else if (!config.enabled && previous.enabled) {
    DaemonManager.stopDaemon()
  }

  return config
}

// ── summarize ──

const ProfileConfigSchema = z.object({
  baseUrl: z.string().optional(),
  modelId: z.string().optional(),
  apiKey: z.string().optional(),
})

export async function summarize(body: { prompt: string; windowType: '10min' | '6h' }): Promise<{ summary: string }> {
  const config = await getConfig()

  if (!config.enabled || !config.profileId) {
    return { summary: '[Chronicle not configured — no profile set]' }
  }

  const profile = Profiles.getProfile(config.profileId)
  if (!profile) {
    return { summary: '[Chronicle error — configured profile not found]' }
  }

  // Resolve API key
  const parsedConfig = parseConfigWith(profile.configJson, ProfileConfigSchema)
  let apiKey: string | null = null
  if (profile.credentialRef) {
    apiKey = readSecret(profile.credentialRef)
  }
  else if (parsedConfig.apiKey) {
    apiKey = parsedConfig.apiKey
  }

  if (!apiKey) {
    return { summary: '[Chronicle error — no API key available for profile]' }
  }

  const modelId = config.modelId || parsedConfig.modelId || 'gpt-4o-mini'
  const baseUrl = parsedConfig.baseUrl
  const apiFormat = detectApiFormat(baseUrl)

  const model = createLanguageModel({
    apiFormat,
    apiKey,
    baseUrl,
    modelId,
  })

  const result = await generateText({
    model,
    prompt: body.prompt,
  })

  return { summary: result.text }
}

// ── status ──

let summaryCount = 0
let lastSummaryAt: number | null = null

export async function getStatus(): Promise<{
  available: boolean
  running: boolean
  pid: number | null
  lastSummaryAt: number | null
  lastExitCode: number | null
  lastExitAt: number | null
  totalSummaries: number
  configuredModel: string | null
}> {
  const config = await getConfig()
  const daemonInfo = DaemonManager.getDaemonInfo()
  const available = config.enabled && !!config.profileId

  let configuredModel: string | null = null
  if (config.profileId) {
    const profile = Profiles.getProfile(config.profileId)
    if (profile) {
      const parsedConfig = parseConfigWith(profile.configJson, ProfileConfigSchema)
      configuredModel = config.modelId || parsedConfig.modelId || null
    }
  }

  return {
    available,
    running: daemonInfo.running,
    pid: daemonInfo.pid,
    lastSummaryAt,
    lastExitCode: daemonInfo.lastExitCode,
    lastExitAt: daemonInfo.lastExitAt,
    totalSummaries: summaryCount,
    configuredModel,
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

// ── timeline ──

const MEMORY_FILE_RE = /^(\d+)-(10min|6h)\.md$/

export interface TimelineEntry {
  id: string
  capturedAt: string
  displayId: number
  segmentDir: string
  framePath: string
  ocrText: string | null
}

export async function getTimeline(limit: number = 50): Promise<TimelineEntry[]> {
  const config = await getConfig()
  const storageRoot = config.storageRoot

  const entries: TimelineEntry[] = []

  let displayDirs: string[]
  try {
    displayDirs = await readdir(storageRoot)
  }
  catch {
    return []
  }

  for (const displayDir of displayDirs) {
    if (displayDir === 'memories') {
      continue
    }
    const displayPath = join(storageRoot, displayDir)
    const displayStat = await stat(displayPath).catch(() => null)
    if (!displayStat?.isDirectory()) {
      continue
    }

    let segmentDirs: string[]
    try {
      segmentDirs = await readdir(displayPath)
    }
    catch {
      continue
    }

    for (const segmentDir of segmentDirs) {
      const segmentPath = join(displayPath, segmentDir)
      const segmentStat = await stat(segmentPath).catch(() => null)
      if (!segmentStat?.isDirectory()) {
        continue
      }

      let files: string[]
      try {
        files = await readdir(segmentPath)
      }
      catch {
        continue
      }

      const captureFiles = files.filter(f => f.startsWith('capture-') && f.endsWith('.json'))
      for (const captureFile of captureFiles) {
        try {
          const content = await readFile(join(segmentPath, captureFile), 'utf8')
          const capture = JSON.parse(content)

          // Try to find matching OCR file
          const frameNum = captureFile.replace('capture-', '').replace('.json', '')
          const ocrFile = `ocr-${frameNum}.json`
          let ocrText: string | null = null
          if (files.includes(ocrFile)) {
            try {
              const ocrContent = await readFile(join(segmentPath, ocrFile), 'utf8')
              const ocr = JSON.parse(ocrContent)
              ocrText = ocr.normalized_text ?? ocr.text ?? null
            }
            catch { /* ignore */ }
          }

          // Convert filesystem timestamp (2026-05-19T06-52-40Z) to ISO format
          const rawTimestamp = capture.captured_at ?? segmentDir
          const isoTimestamp = rawTimestamp.replace(FILESYSTEM_TIMESTAMP_RE, '$1:$2:$3Z')

          entries.push({
            id: `${displayDir}-${segmentDir}-${frameNum}`,
            capturedAt: isoTimestamp,
            displayId: capture.display_id ?? (Number(displayDir) || 0),
            segmentDir: `${displayDir}/${segmentDir}`,
            framePath: capture.persisted_frame_path ?? capture.frame ?? `frame-${frameNum}.png`,
            ocrText,
          })
        }
        catch { /* skip malformed captures */ }
      }
    }
  }

  entries.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
  return entries.slice(0, limit)
}

// ── frame image ──

export async function getFrameImage(segment: string, frame: string): Promise<Response | null> {
  const config = await getConfig()
  const storageRoot = resolve(config.storageRoot)

  const resolvedPath = resolve(storageRoot, segment, frame)

  // Security: prevent path traversal
  if (!resolvedPath.startsWith(storageRoot)) {
    return null
  }

  try {
    const data = await readFile(resolvedPath)
    const ext = frame.split('.').pop()?.toLowerCase()
    const contentType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream'
    return new Response(data, {
      headers: { 'Content-Type': contentType },
    })
  }
  catch {
    console.warn(`Frame image not found: ${resolvedPath}`)
    return null
  }
}

// ── memories ──

export interface MemoryEntry {
  id: string
  type: '10min' | '6h'
  createdAt: string
  content: string
}

export async function getMemories(limit: number = 20): Promise<MemoryEntry[]> {
  const config = await getConfig()
  const memoriesDir = join(config.storageRoot, 'memories')

  let files: string[]
  try {
    files = await readdir(memoriesDir)
  }
  catch {
    return []
  }

  const entries: MemoryEntry[] = []

  for (const file of files) {
    if (!file.endsWith('.md')) {
      continue
    }

    const match = MEMORY_FILE_RE.exec(file)
    if (!match) {
      continue
    }

    const [, timestamp, type] = match
    try {
      const content = await readFile(join(memoriesDir, file), 'utf8')
      entries.push({
        id: file,
        type: type as '10min' | '6h',
        createdAt: new Date(Number(timestamp)).toISOString(),
        content,
      })
    }
    catch { /* skip unreadable */ }
  }

  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return entries.slice(0, limit)
}
