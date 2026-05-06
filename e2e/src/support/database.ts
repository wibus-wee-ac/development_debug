// Input: CradleWorld main-process bridge plus readonly SQL statements and positional params
// Output: Shared SQLite query helpers for E2E persistence assertions
// Position: E2E support utility reused by step definitions that need database verification

import type { CradleWorld } from './world'

type SqliteParam = string | number | null

interface QueryInput {
  sql: string
  params: SqliteParam[]
}

export async function queryDatabaseRow<T>(
  world: CradleWorld,
  sql: string,
  params: SqliteParam[] = [],
): Promise<T | null> {
  return world.mainProcess<T | null, QueryInput>(
    async (electron, { sql, params }) => {
      const getBuiltinModule = process.getBuiltinModule?.bind(process)

      if (!getBuiltinModule) {
        throw new Error('process.getBuiltinModule unavailable in Electron evaluate context')
      }

      const path = getBuiltinModule('node:path')
      const moduleApi = getBuiltinModule('node:module')
      const requireFromApp = moduleApi.createRequire(path.join(electron.app.getAppPath(), 'package.json'))
      const Database = requireFromApp('better-sqlite3')

      if (!Database) {
        throw new Error('better-sqlite3 default export unavailable in Electron main process')
      }

      const dbPath = path.join(electron.app.getPath('userData'), 'cradle.db')
      const db = new Database(dbPath, { readonly: true })

      try {
        return (db.prepare(sql).get(...params) as T | undefined) ?? null
      }
      finally {
        db.close()
      }
    },
    { sql, params },
  )
}

export async function queryDatabaseRows<T>(
  world: CradleWorld,
  sql: string,
  params: SqliteParam[] = [],
): Promise<T[]> {
  return world.mainProcess<T[], QueryInput>(
    async (electron, { sql, params }) => {
      const getBuiltinModule = process.getBuiltinModule?.bind(process)

      if (!getBuiltinModule) {
        throw new Error('process.getBuiltinModule unavailable in Electron evaluate context')
      }

      const path = getBuiltinModule('node:path')
      const moduleApi = getBuiltinModule('node:module')
      const requireFromApp = moduleApi.createRequire(path.join(electron.app.getAppPath(), 'package.json'))
      const Database = requireFromApp('better-sqlite3')

      if (!Database) {
        throw new Error('better-sqlite3 default export unavailable in Electron main process')
      }

      const dbPath = path.join(electron.app.getPath('userData'), 'cradle.db')
      const db = new Database(dbPath, { readonly: true })

      try {
        return db.prepare(sql).all(...params) as T[]
      }
      finally {
        db.close()
      }
    },
    { sql, params },
  )
}
