import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-data-'))
}

describe('health module', () => {
  it('should respond to GET /health', async () => {
    const dataDir = makeTempDataDir()
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()

      const res = await hono.request('/health')
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.status).toBe('ok')
      expect(body.timestamp).toBeTypeOf('number')
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
