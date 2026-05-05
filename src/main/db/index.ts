// Input: better-sqlite3, Drizzle schema/migrator, Electron runtime path helpers
// Output: initDb and getDb helpers for the main-process SQLite database singleton
// Position: Persistence bootstrap and database accessor for the Electron main process

import { join } from 'node:path'

import { is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import * as schema from './schema'

let db: BetterSQLite3Database<typeof schema> | null = null

export function initDb(dbPath: string): void {
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  db = drizzle(sqlite, { schema })

  const migrationsFolder = is.dev
    ? join(__dirname, '../../drizzle')
    : join(process.resourcesPath, 'drizzle')

  migrate(db, { migrationsFolder })
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!db) {
    throw new Error('Database is not initialised — call initDb() first.')
  }
  return db
}
