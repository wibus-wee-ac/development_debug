// Input: DbProvider
// Output: migrations executed at module init
// Position: server migration runner

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { injectable } from 'tsyringe'

import { getMigrationsPath } from '@cradle/db'

import { Logger } from '../logging/logger'
import { DatabaseConfig } from './database.config'
import { DbProvider } from './database.provider'

@injectable()
export class MigrationRunner {
  constructor(
    private readonly provider: DbProvider,
    private readonly config: DatabaseConfig,
    private readonly logger: Logger
  ) {}

  onModuleInit(): void {
    const db = this.provider.getDb()
    const { dbPath } = this.config.getOptions()

    try {
      migrate(db, { migrationsFolder: getMigrationsPath() })
    }
    catch (error) {
      this.logger.error('Database migration failed', {
        dbPath,
        error,
      })
      throw error
    }
  }
}
