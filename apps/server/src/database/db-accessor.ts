// Input: DbProvider
// Output: db accessor
// Position: server database accessor

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { injectable } from 'tsyringe'

import { dbSchema } from '@cradle/db'

import { DbProvider } from './database.provider'

@injectable()
export class DbAccessor {
  constructor(private readonly provider: DbProvider) {}

  get(): BetterSQLite3Database<typeof dbSchema> {
    return this.provider.getDb()
  }
}
