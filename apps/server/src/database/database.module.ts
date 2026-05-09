// Input: Database providers
// Output: DatabaseModule registration
// Position: server database module

import { Module } from '@tsuki-hono/common'

import { DatabaseConfig } from './database.config'
import { DbAccessor } from './db-accessor'
import { DbProvider } from './database.provider'
import { MigrationRunner } from './migration-runner'

@Module({
  providers: [DatabaseConfig, DbProvider, MigrationRunner, DbAccessor],
})
export class DatabaseModule {}
