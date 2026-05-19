// Input: Chronicle configuration from preferences, profile/secrets for AI calls
// Output: Chronicle config, AI-generated summaries, daemon status
// Position: apps/server/src/modules/chronicle/service.ts

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { generateText } from 'ai'

import { getServerConfig } from '../../infra'
import * as Profiles from '../profiles/service'
import { readSecret } from '../secrets/service'
import { createLanguageModel, detectApiFormat } from '../chat-runtime/engine/providers'
import { parseConfigWith } from '../providers/provider-base'
import { z } from 'zod'

// ── config persistence ──

interface ChronicleConfig {
  profileId: string
  modelId: string
  workspaceId: string
  enabled: boolean
}

const defaultConfig: ChronicleConfig = {
  profileId: '',
  modelId: '',
  workspaceId: '',
  enabled: false,
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
  lastSummaryAt: number | null
  totalSummaries: number
  configuredModel: string | null
}> {
  const config = await getConfig()
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
    lastSummaryAt,
    totalSummaries: summaryCount,
    configuredModel,
  }
}
