// Input: ServerConfig log level
// Output: structured logger interface
// Position: server logging module

/* eslint-disable no-console -- Logger is the console output boundary. */

import { inject, injectable } from 'tsyringe'

import type { LogLevel, ServerConfigValues } from '../config/server-config'
import { ServerConfig } from '../config/server-config'

export interface LoggerFields {
  [key: string]: unknown
}

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

@injectable()
export class Logger {
  private readonly config: ServerConfigValues

  constructor(@inject(ServerConfig) serverConfig: ServerConfig) {
    this.config = serverConfig.get()
  }

  private shouldLog(level: LogLevel): boolean {
    return levelRank[level] >= levelRank[this.config.logLevel]
  }

  debug(message: string, fields?: LoggerFields): void {
    if (this.shouldLog('debug')) {
      console.debug(message, fields ?? {})
    }
  }

  info(message: string, fields?: LoggerFields): void {
    if (this.shouldLog('info')) {
      console.info(message, fields ?? {})
    }
  }

  warn(message: string, fields?: LoggerFields): void {
    if (this.shouldLog('warn')) {
      console.warn(message, fields ?? {})
    }
  }

  error(message: string, fields?: LoggerFields): void {
    if (this.shouldLog('error')) {
      console.error(message, fields ?? {})
    }
  }
}
