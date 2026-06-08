import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import * as schema from './schema'
import { runMigrations } from './migrate'

export type BridgeDatabase = ReturnType<typeof createBridgeDatabase>

export function createBridgeDatabase(path: string) {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  runMigrations(sqlite)
  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  }
}
