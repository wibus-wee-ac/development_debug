// Input: pack-codebase HTTP endpoint
// Output: integration tests for server-side repomix packing
// Position: apps/server/tests

import 'reflect-metadata'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'
import { DbAccessor } from '../src/database/db-accessor'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('pack-codebase capability', () => {
  it('packs a workspace through HTTP and returns the generated content', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pack-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    writeFileSync(join(workspaceRoot, 'app.ts'), 'export const greeting = "hello from cradle"\n')
    writeFileSync(join(workspaceRoot, 'secret.txt'), 'hidden token should not appear\n')

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const accessor = app.getContainer().resolve(DbAccessor) as DbAccessor
      accessor.get().insert(workspaces).values({
        id: 'workspace-pack',
        name: 'Workspace Pack',
        path: workspaceRoot,
      }).run()

      const packRes = await hono.request('/workspaces/workspace-pack/pack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          style: 'plain',
          compress: false,
          ignore: 'secret.txt',
        }),
      })

      expect(packRes.status).toBe(200)
      const body = await packRes.json() as { content: string, totalFiles: number, totalTokens: number }
      expect(body.content).toContain('hello from cradle')
      expect(body.content).not.toContain('hidden token should not appear')
      expect(body.totalFiles).toBeGreaterThan(0)
      expect(body.totalTokens).toBeGreaterThan(0)
    }
    finally {
      if (app) {
        await app.close()
      }
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('returns structured errors for invalid payload and missing workspace', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()

      const invalidRes = await hono.request('/workspaces/workspace-pack/pack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ style: 'yaml', compress: 'nope' }),
      })
      expect(invalidRes.status).toBe(400)
      expect((await invalidRes.json()).code).toBe('invalid_pack_codebase_input')

      const missingWorkspaceRes = await hono.request('/workspaces/missing-workspace/pack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ style: 'plain', compress: false }),
      })
      expect(missingWorkspaceRes.status).toBe(404)
      expect((await missingWorkspaceRes.json()).code).toBe('workspace_not_found')
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
