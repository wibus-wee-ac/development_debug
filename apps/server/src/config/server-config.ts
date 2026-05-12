// Input: process.env
// Output: validated server config
// Position: server config module

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from 'zod'

const logLevels = ['debug', 'info', 'warn', 'error'] as const

const trimOptionalString = (value: unknown) => {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

const serverConfigSchema = z.object({
  CRADLE_HOST: z.string().default('127.0.0.1'),
  CRADLE_PORT: z.coerce.number().int().positive().default(21423),
  CRADLE_LOG_LEVEL: z.enum(logLevels).default('info'),
  CRADLE_DATA_DIR: z.preprocess(trimOptionalString, z.string().optional()),
  CRADLE_DB_PATH: z.preprocess(trimOptionalString, z.string().optional()),
})

export type LogLevel = (typeof logLevels)[number]

export interface ServerConfigValues {
  host: string
  port: number
  logLevel: LogLevel
  dataDir?: string
  dbPath: string
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfigValues {
  const parsed = serverConfigSchema.parse(env)
  const dbPath
    = parsed.CRADLE_DB_PATH
      ?? (parsed.CRADLE_DATA_DIR ? join(parsed.CRADLE_DATA_DIR, 'cradle.db') : undefined)

  if (!dbPath) {
    throw new Error('CRADLE_DATA_DIR or CRADLE_DB_PATH is required')
  }

  mkdirSync(dirname(dbPath), { recursive: true })

  return {
    host: parsed.CRADLE_HOST,
    port: parsed.CRADLE_PORT,
    logLevel: parsed.CRADLE_LOG_LEVEL,
    dataDir: parsed.CRADLE_DATA_DIR,
    dbPath,
  }
}

export class ServerConfig {
  private readonly config = loadServerConfig()

  get(): ServerConfigValues {
    return this.config
  }
}
