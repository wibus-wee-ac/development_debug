// Input: workflow-rules HTTP endpoints
// Output: integration tests for workflow-rules CRUD and filesystem ownership
// Position: apps/server/tests

import 'reflect-metadata'

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('workflow rules capability', () => {
  it('supports save, get, list, and delete under the server data directory', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()

      const saveGlobal = await hono.request('/workflow-rules/workspace-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'global rule' }),
      })
      expect(saveGlobal.status).toBe(200)
      expect(await saveGlobal.json()).toEqual({ ok: true })

      const saveAgent = await hono.request('/workflow-rules/workspace-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentProfileId: 'agent-1', content: 'agent rule' }),
      })
      expect(saveAgent.status).toBe(200)
      expect(await saveAgent.json()).toEqual({ ok: true })

      expect(readFileSync(join(dataDir, 'workflow-rules', 'workspace-1', 'rules.md'), 'utf8')).toBe('global rule')
      expect(readFileSync(join(dataDir, 'workflow-rules', 'workspace-1', 'agents', 'agent-1.md'), 'utf8')).toBe('agent rule')

      const getRes = await hono.request('/workflow-rules/workspace-1?agentProfileId=agent-1')
      expect(getRes.status).toBe(200)
      expect(await getRes.json()).toEqual({
        global: 'global rule',
        profileSpecific: 'agent rule',
      })

      const listRes = await hono.request('/workflow-rules/workspace-1/list')
      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual([
        { type: 'global', agentProfileId: null, content: 'global rule' },
        { type: 'agent', agentProfileId: 'agent-1', content: 'agent rule' },
      ])

      const deleteAgent = await hono.request('/workflow-rules/workspace-1?agentProfileId=agent-1', {
        method: 'DELETE',
      })
      expect(deleteAgent.status).toBe(200)
      expect(await deleteAgent.json()).toEqual({ ok: true })

      const deleteGlobal = await hono.request('/workflow-rules/workspace-1', {
        method: 'DELETE',
      })
      expect(deleteGlobal.status).toBe(200)
      expect(await deleteGlobal.json()).toEqual({ ok: true })

      const afterDelete = await hono.request('/workflow-rules/workspace-1?agentProfileId=agent-1')
      expect(afterDelete.status).toBe(200)
      expect(await afterDelete.json()).toEqual({
        global: null,
        profileSpecific: null,
      })

      const missingList = await hono.request('/workflow-rules/workspace-2/list')
      expect(missingList.status).toBe(200)
      expect(await missingList.json()).toEqual([])
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

  it('rejects invalid ids and missing content', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()

      const invalidWorkspace = await hono.request('/workflow-rules/..bad', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      })
      expect(invalidWorkspace.status).toBe(400)
      expect((await invalidWorkspace.json()).code).toBe('invalid_workflow_rule_id')

      const invalidAgent = await hono.request('/workflow-rules/workspace-1?agentProfileId=../bad')
      expect(invalidAgent.status).toBe(400)
      expect((await invalidAgent.json()).code).toBe('invalid_workflow_rule_id')

      const missingContent = await hono.request('/workflow-rules/workspace-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(missingContent.status).toBe(400)
      expect((await missingContent.json()).code).toBe('invalid_workflow_rule_input')
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
