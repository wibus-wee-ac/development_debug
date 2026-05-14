// Input: CRADLE_LOG_LEVEL env var, CRADLE_LOG_FILE env var
// Output: pino-based structured logger with optional file persistence
// Position: server logging module

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import pino from 'pino'

import type { LogLevel } from '../config/server-config'

export interface LoggerFields {
  [key: string]: unknown
}

function resolveLogFile(): string | null {
  const file = process.env.CRADLE_LOG_FILE?.trim()
  if (file) return file
  const dataDir = process.env.CRADLE_DATA_DIR?.trim()
  if (dataDir) return `${dataDir}/server.log`
  return null
}

function createStreams() {
  const level = ((process.env.CRADLE_LOG_LEVEL as string) || 'info') as pino.Level
  const streams: pino.StreamEntry[] = [
    { level, stream: process.stdout },
  ]
  const logFile = resolveLogFile()
  if (logFile) {
    try {
      mkdirSync(dirname(logFile), { recursive: true })
    }
    catch { /* ignore */ }
    const dest = pino.destination({ dest: logFile, sync: false })
    streams.push({ level, stream: dest })
    process.stderr.write(`[logger] file logging enabled: ${logFile}\n`)
  }
  return streams
}

const rootLogger = pino({
  level: (process.env.CRADLE_LOG_LEVEL as LogLevel) || 'info',
  serializers: {
    err: pino.stdSerializers.err,
  },
  formatters: {
    level(label) {
      return { level: label }
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.multistream(createStreams()))

/**
 * Logger wraps pino with a stable interface compatible with the existing codebase.
 * Supports both class-based usage (MigrationRunner) and direct function calls.
 */
export class Logger {
  private readonly instance: pino.Logger

  constructor(instance?: pino.Logger) {
    this.instance = instance ?? rootLogger
  }

  debug(message: string, fields?: LoggerFields): void {
    if (fields) {
      this.instance.debug(fields, message)
    }
    else {
      this.instance.debug(message)
    }
  }

  info(message: string, fields?: LoggerFields): void {
    if (fields) {
      this.instance.info(fields, message)
    }
    else {
      this.instance.info(message)
    }
  }

  warn(message: string, fields?: LoggerFields): void {
    if (fields) {
      this.instance.warn(fields, message)
    }
    else {
      this.instance.warn(message)
    }
  }

  error(message: string, fields?: LoggerFields): void {
    if (fields) {
      this.instance.error(fields, message)
    }
    else {
      this.instance.error(message)
    }
  }

  child(bindings: LoggerFields): Logger {
    return new Logger(this.instance.child(bindings))
  }

  /** Access the underlying pino instance for advanced usage. */
  get pino(): pino.Logger {
    return this.instance
  }
}

/** Return the root pino-based Logger instance. */
export function getLogger(): Logger {
  return new Logger(rootLogger)
}

/** Create a child logger with bound context (e.g. requestId, module). */
export function createChildLogger(bindings: LoggerFields): Logger {
  return new Logger(rootLogger.child(bindings))
}
