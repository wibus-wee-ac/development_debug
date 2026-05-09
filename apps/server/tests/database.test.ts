// Input: DbAccessor + migrations
// Output: database module integration test
// Position: apps/server/tests

import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'
import { DbAccessor } from '../src/database/db-accessor'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-data-'))
}

describe('database module', () => {
  it('runs migrations on startup', async () => {
    const dataDir = makeTempDataDir()
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const container = app.getContainer()

      const accessor = container.resolve(DbAccessor) as DbAccessor
      const db = accessor.get()
      const rows = db.select().from(sessions).limit(1).all()
      expect(rows).toEqual([])
    }
    finally {
      if (app) {
        await app.close()
      }
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
