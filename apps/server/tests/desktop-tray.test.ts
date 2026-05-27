import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessionAwaits, sessions, workspaces } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('desktop tray projection', () => {
  it('returns resident sessions, quick actions, and pending awaits', async () => {
    const dataDir = createTempDir('cradle-data-')
    const workspaceRoot = createTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const store = db()
      const workspaceId = randomUUID()
      const sessionId = randomUUID()
      const awaitId = randomUUID()

      store.insert(workspaces).values({
        id: workspaceId,
        name: 'Desktop Workspace',
        path: workspaceRoot,
      }).run()
      store.insert(sessions).values({
        id: sessionId,
        workspaceId,
        title: 'Pinned Chat',
        runtimeKind: 'codex',
        pinned: 1,
      }).run()
      store.insert(sessionAwaits).values({
        id: awaitId,
        chatSessionId: sessionId,
        workspaceId,
        source: 'github-ci',
        filterJson: JSON.stringify({ repo: 'owner/repo', pr: 42 }),
        status: 'pending',
        reason: 'Waiting for checks',
      }).run()

      const trayResponse = await app.handle(new Request('http://localhost/desktop/tray'))
      expect(trayResponse.status).toBe(200)
      const tray = await trayResponse.json() as {
        resident: Array<{ sessionId: string, title: string, workspaceName: string }>
        quickActions: Array<{ id: string }>
        metrics: Array<{ id: string, value: string }>
      }
      expect(tray.resident).toEqual([
        expect.objectContaining({
          sessionId,
          title: 'Pinned Chat',
          workspaceName: 'Desktop Workspace',
        }),
      ])
      expect(tray.quickActions.length).toBeGreaterThanOrEqual(10)
      expect(tray.quickActions.map(action => action.id)).toEqual(expect.arrayContaining([
        'new-chat',
        'open-awaits',
        'open-automation',
        'open-agents',
        'open-providers',
        'open-desktop-settings',
      ]))
      expect(tray.metrics).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'resident', value: '1' }),
        expect.objectContaining({ id: 'awaits', value: '1' }),
      ]))

      const awaitsResponse = await app.handle(new Request('http://localhost/desktop/tray/awaits'))
      expect(awaitsResponse.status).toBe(200)
      expect(await awaitsResponse.json()).toEqual([
        expect.objectContaining({
          id: awaitId,
          sessionId,
          title: 'Pinned Chat',
          workspaceName: 'Desktop Workspace',
          source: 'github-ci',
          reason: 'Waiting for checks',
        }),
      ])
    }
    finally {
      shutdownInfra()
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
})
