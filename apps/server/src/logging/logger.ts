// Input: CRADLE_LOG_LEVEL env var
// Output: pino-based structured logger
// Position: server logging module

import pino from 'pino'

import type { LogLevel } from '../config/server-config'

export interface LoggerFields {
  [key: string]: unknown
}

const rootLogger = pino({
  level: (process.env.CRADLE_LOG_LEVEL as LogLevel) || 'info',
  formatters: {
    level(label) {
      return { level: label }
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})

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
