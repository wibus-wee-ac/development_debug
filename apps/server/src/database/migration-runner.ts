import { getMigrationsPath } from '@cradle/db/paths'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import type { Logger } from '../logging/logger'
import type { DatabaseConfig } from './database.config'
import type { DbProvider } from './database.provider'

export class MigrationRunner {
  constructor(
    private readonly provider: DbProvider,
    private readonly config: DatabaseConfig,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    const db = this.provider.getDb()
    const { dbPath } = this.config.getOptions()

    try {
      migrate(db, { migrationsFolder: getMigrationsPath() })
    }
    catch (error) {
      const cause = error instanceof Error && 'cause' in error ? (error as any).cause : undefined
      this.logger.error('Database migration failed', {
        dbPath,
        errorMessage: error instanceof Error ? error.message : String(error),
        causeMessage: cause instanceof Error ? cause.message : cause?.message ?? cause?.code,
        error,
      })
      throw error
    }
  }
}
