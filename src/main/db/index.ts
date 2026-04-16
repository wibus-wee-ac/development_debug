import { join } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

let db: BetterSQLite3Database<typeof schema> | null = null

export function initDb(dbPath: string): void {
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  db = drizzle(sqlite, { schema })

  const migrationsFolder = is.dev
    ? join(app.getAppPath(), 'drizzle')
    : join(process.resourcesPath, 'drizzle')

  migrate(db, { migrationsFolder })
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!db) throw new Error('Database is not initialised — call initDb() first.')
  return db
}
