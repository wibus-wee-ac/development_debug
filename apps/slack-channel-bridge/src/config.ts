import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_APP_TOKEN: z.string().min(1),
  SLACK_SIGNING_SECRET: z.string().min(1),
  CRADLE_API_BASE_URL: z.string().url().default('http://127.0.0.1:21423'),
  CRADLE_SLACK_AGENT_ID: z.string().min(1).optional(),
  CRADLE_SLACK_PROVIDER_TARGET_ID: z.string().min(1).optional(),
  CRADLE_SLACK_RUNTIME_KIND: z.string().min(1).optional(),
  CRADLE_SLACK_MODEL_ID: z.string().min(1).optional(),
  SLACK_CHANNEL_BRIDGE_DB_PATH: z.string().optional(),
  SLACK_CHANNEL_BRIDGE_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
}).refine(env => Boolean(env.CRADLE_SLACK_AGENT_ID || env.CRADLE_SLACK_PROVIDER_TARGET_ID), {
  message: 'Set CRADLE_SLACK_AGENT_ID or CRADLE_SLACK_PROVIDER_TARGET_ID so the bridge can create Cradle sessions.',
})

export interface BridgeConfig {
  slackBotToken: string
  slackAppToken: string
  slackSigningSecret: string
  cradleApiBaseUrl: string
  cradleAgentId: string | null
  cradleProviderTargetId: string | null
  cradleRuntimeKind: string | null
  cradleModelId: string | null
  dbPath: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/')
    ? join(homedir(), path.slice(2))
    : path
}

export function defaultDbPath(): string {
  return join(homedir(), '.cradle', 'slack-channel-bridge', 'bridge.sqlite')
}

export function resolveDbPath(path: string | undefined): string {
  const raw = expandHome(path?.trim() || defaultDbPath())
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const parsed = envSchema.parse(env)
  const dbPath = resolveDbPath(parsed.SLACK_CHANNEL_BRIDGE_DB_PATH)
  mkdirSync(dirname(dbPath), { recursive: true })
  return {
    slackBotToken: parsed.SLACK_BOT_TOKEN,
    slackAppToken: parsed.SLACK_APP_TOKEN,
    slackSigningSecret: parsed.SLACK_SIGNING_SECRET,
    cradleApiBaseUrl: parsed.CRADLE_API_BASE_URL.replace(/\/+$/, ''),
    cradleAgentId: parsed.CRADLE_SLACK_AGENT_ID ?? null,
    cradleProviderTargetId: parsed.CRADLE_SLACK_PROVIDER_TARGET_ID ?? null,
    cradleRuntimeKind: parsed.CRADLE_SLACK_RUNTIME_KIND ?? null,
    cradleModelId: parsed.CRADLE_SLACK_MODEL_ID ?? null,
    dbPath,
    logLevel: parsed.SLACK_CHANNEL_BRIDGE_LOG_LEVEL,
  }
}
