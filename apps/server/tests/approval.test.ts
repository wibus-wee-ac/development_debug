// Input: approval HTTP endpoints
// Output: integration tests for pending approval registry lifecycle and input validation
// Position: apps/server/tests

import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('approval capability', () => {
  it('creates pending approvals, lists them with session filtering, and removes them after response', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()

      const createRes = await hono.request('/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chatSessionId: 'session-approval',
          agentId: 'agent-1',
          prompt: 'Allow tool execution?',
          options: [
            { optionId: 'allow_once', label: 'Allow once', description: 'allow_once' },
            { optionId: 'reject_once', label: 'Reject once', description: 'reject_once' },
          ],
        }),
      })
      expect(createRes.status).toBe(200)
      const approval = await createRes.json() as { id: string, chatSessionId: string | null, options: Array<{ optionId: string }> }
      expect(approval).toEqual(expect.objectContaining({
        chatSessionId: 'session-approval',
      }))

      const listAllRes = await hono.request('/approvals')
      expect(listAllRes.status).toBe(200)
      expect(await listAllRes.json()).toEqual([expect.objectContaining({ id: approval.id })])

      const listSessionRes = await hono.request('/approvals?chatSessionId=session-approval')
      expect(listSessionRes.status).toBe(200)
      expect(await listSessionRes.json()).toEqual([expect.objectContaining({ id: approval.id })])

      const respondRes = await hono.request(`/approvals/${encodeURIComponent(approval.id)}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision: 'approved',
          selectedOptionId: 'allow_once',
        }),
      })
      expect(respondRes.status).toBe(200)
      expect(await respondRes.json()).toEqual({ ok: true })

      const afterRespondRes = await hono.request('/approvals')
      expect(afterRespondRes.status).toBe(200)
      expect(await afterRespondRes.json()).toEqual([])
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

  it('returns structured errors for invalid payloads, missing approvals, and invalid options', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()

      const invalidCreate = await hono.request('/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-1',
          prompt: 'Missing options',
        }),
      })
      expect(invalidCreate.status).toBe(400)
      expect((await invalidCreate.json()).code).toBe('invalid_approval_input')

      const missingApproval = await hono.request('/approvals/missing/respond', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision: 'approved',
          selectedOptionId: 'allow_once',
        }),
      })
      expect(missingApproval.status).toBe(404)
      expect((await missingApproval.json()).code).toBe('approval_not_found')

      const createRes = await hono.request('/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chatSessionId: 'session-approval',
          agentId: 'agent-1',
          prompt: 'Allow tool execution?',
          options: [
            { optionId: 'allow_once', label: 'Allow once', description: 'allow_once' },
          ],
        }),
      })
      const approval = await createRes.json() as { id: string }

      const invalidOption = await hono.request(`/approvals/${encodeURIComponent(approval.id)}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision: 'approved',
          selectedOptionId: 'reject_once',
        }),
      })
      expect(invalidOption.status).toBe(400)
      expect((await invalidOption.json()).code).toBe('invalid_approval_input')
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