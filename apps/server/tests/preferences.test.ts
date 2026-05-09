// Input: preferences HTTP endpoints
// Output: integration tests for server-owned chat preference defaults and persistence
// Position: apps/server/tests

import 'reflect-metadata'

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('preferences capability', () => {
  it('returns defaults when missing and persists chat preferences under the server data directory', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()

      const initialRes = await hono.request('/preferences/chat')
      expect(initialRes.status).toBe(200)
      expect(await initialRes.json()).toEqual({
        modelId: null,
        configSelections: {},
      })

      const filePath = join(dataDir, 'preferences', 'chat.json')
      expect(existsSync(filePath)).toBe(false)

      const saveRes = await hono.request('/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: 'gpt-4o-mini',
          configSelections: {
            reasoningEffort: 'high',
            webSearch: true,
          },
        }),
      })
      expect(saveRes.status).toBe(200)
      expect(await saveRes.json()).toEqual({ ok: true })

      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
        modelId: 'gpt-4o-mini',
        configSelections: {
          reasoningEffort: 'high',
          webSearch: true,
        },
      })

      const finalRes = await hono.request('/preferences/chat')
      expect(finalRes.status).toBe(200)
      expect(await finalRes.json()).toEqual({
        modelId: 'gpt-4o-mini',
        configSelections: {
          reasoningEffort: 'high',
          webSearch: true,
        },
      })
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

  it('returns structured errors for invalid payloads', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()

      const invalidModel = await hono.request('/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: 123,
          configSelections: {},
        }),
      })
      expect(invalidModel.status).toBe(400)
      expect((await invalidModel.json()).code).toBe('invalid_preferences_input')

      const invalidSelections = await hono.request('/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: null,
          configSelections: {
            bad: { nested: true },
          },
        }),
      })
      expect(invalidSelections.status).toBe(400)
      expect((await invalidSelections.json()).code).toBe('invalid_preferences_input')
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