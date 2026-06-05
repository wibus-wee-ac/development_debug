import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('preferences capability', () => {
  it('returns defaults when missing and persists chat preferences under the server data directory', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const initialRes = await app.handle(new Request('http://localhost/preferences/chat'))
      expect(initialRes.status).toBe(200)
      expect(await initialRes.json()).toEqual({
        modelId: null,
        configSelections: {},
        continuationBehavior: 'queue',
      })

      const filePath = join(dataDir, 'preferences', 'chat.json')
      expect(existsSync(filePath)).toBe(false)

      const saveRes = await app.handle(new Request('http://localhost/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: 'gpt-4o-mini',
          configSelections: {
            reasoningEffort: 'high',
            webSearch: true,
          },
          continuationBehavior: 'steer',
        }),
      }))
      expect(saveRes.status).toBe(200)
      expect(await saveRes.json()).toEqual({ ok: true })

      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
        modelId: 'gpt-4o-mini',
        configSelections: {
          reasoningEffort: 'high',
          webSearch: true,
        },
        continuationBehavior: 'steer',
      })

      const finalRes = await app.handle(new Request('http://localhost/preferences/chat'))
      expect(finalRes.status).toBe(200)
      expect(await finalRes.json()).toEqual({
        modelId: 'gpt-4o-mini',
        configSelections: {
          reasoningEffort: 'high',
          webSearch: true,
        },
        continuationBehavior: 'steer',
      })
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

  it('returns defaults when missing and persists Codex preferences under the server data directory', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const initialRes = await app.handle(new Request('http://localhost/preferences/codex'))
      expect(initialRes.status).toBe(200)
      expect(await initialRes.json()).toEqual({
        useCradleUserAgent: true,
      })

      const filePath = join(dataDir, 'preferences', 'codex.json')
      expect(existsSync(filePath)).toBe(false)

      const saveRes = await app.handle(new Request('http://localhost/preferences/codex', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          useCradleUserAgent: false,
        }),
      }))
      expect(saveRes.status).toBe(200)
      expect(await saveRes.json()).toEqual({ ok: true })

      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
        useCradleUserAgent: false,
      })

      const finalRes = await app.handle(new Request('http://localhost/preferences/codex'))
      expect(finalRes.status).toBe(200)
      expect(await finalRes.json()).toEqual({
        useCradleUserAgent: false,
      })
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

  it('returns structured errors for invalid payloads', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const invalidModel = await app.handle(new Request('http://localhost/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: 123,
          configSelections: {},
          continuationBehavior: 'queue',
        }),
      }))
      expect(invalidModel.status).toBe(400)
      expect((await invalidModel.json()).code).toBe('validation_error')

      const invalidSelections = await app.handle(new Request('http://localhost/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: null,
          configSelections: {
            bad: { nested: true },
          },
          continuationBehavior: 'queue',
        }),
      }))
      expect(invalidSelections.status).toBe(400)
      expect((await invalidSelections.json()).code).toBe('validation_error')

      const invalidContinuationBehavior = await app.handle(new Request('http://localhost/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: null,
          configSelections: {},
          continuationBehavior: 'interrupt',
        }),
      }))
      expect(invalidContinuationBehavior.status).toBe(400)
      expect((await invalidContinuationBehavior.json()).code).toBe('validation_error')

      const invalidCodexPreferences = await app.handle(new Request('http://localhost/preferences/codex', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          useCradleUserAgent: 'false',
        }),
      }))
      expect(invalidCodexPreferences.status).toBe(400)
      expect((await invalidCodexPreferences.json()).code).toBe('validation_error')
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
