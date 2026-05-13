// Input: environment variables
// Output: lazily-initialized app-level infrastructure singletons
// Position: apps/server/src — the single composition root for shared infra

import type { dbSchema } from '@cradle/db'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type { ServerConfigValues } from './config/server-config'
import { ServerConfig } from './config/server-config'
import { DatabaseConfig } from './database/database.config'
import { DbProvider } from './database/database.provider'
import { MigrationRunner } from './database/migration-runner'
import { getLogger as getLoggerFromModule, Logger } from './logging/logger'

let _serverConfig: ServerConfig | undefined
let _logger: Logger | undefined
let _dbProvider: DbProvider | undefined

export function getServerConfig(): ServerConfigValues {
  _serverConfig ??= new ServerConfig()
  return _serverConfig.get()
}

export function getLogger(): Logger {
  _logger ??= getLoggerFromModule()
  return _logger
}

function ensureDbProvider(): DbProvider {
  if (!_dbProvider) {
    const sc = _serverConfig ?? (_serverConfig = new ServerConfig())
    const dbConfig = new DatabaseConfig(sc)
    _dbProvider = new DbProvider(dbConfig)
    new MigrationRunner(_dbProvider, dbConfig, getLogger()).onModuleInit()
  }
  return _dbProvider
}

/** Return the raw drizzle database instance — the one thing services actually need. */
export function db(): BetterSQLite3Database<typeof dbSchema> {
  return ensureDbProvider().getDb()
}

/** Gracefully close the database and clear all cached singletons. */
export function shutdownInfra(): void {
  _dbProvider?.onApplicationShutdown()
  _dbProvider = undefined
  _serverConfig = undefined
  _logger = undefined
}
