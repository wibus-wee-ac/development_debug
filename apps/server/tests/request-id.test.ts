// Input: RequestId middleware
// Output: request-id header integration test
// Position: apps/server/tests

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-data-'))
}

describe('request id middleware', () => {
  it('adds x-request-id header', async () => {
    const dataDir = makeTempDataDir()
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      const res = await app.handle(new Request('http://localhost/health'))
      expect(res.status).toBe(200)
      expect(res.headers.get('x-request-id')).toBeTruthy()
    }
    finally {
      shutdownInfra()
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
