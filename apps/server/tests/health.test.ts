import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-data-'))
}

describe('health module', () => {
  it('should respond to GET /health', async () => {
    const dataDir = makeTempDataDir()
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const res = await app.handle(new Request('http://localhost/health'))
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.status).toBe('ok')
      expect(body.timestamp).toBeTypeOf('number')
      expect(body.cpu).toEqual(expect.objectContaining({
        userMicros: expect.any(Number),
        systemMicros: expect.any(Number),
      }))
      expect(body.cpu.percent === null || body.cpu.percent >= 0).toBe(true)

      const nextRes = await app.handle(new Request('http://localhost/health'))
      expect(nextRes.status).toBe(200)
      const nextBody = await nextRes.json()
      expect(nextBody.cpu.percent === null || nextBody.cpu.percent >= 0).toBe(true)
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
