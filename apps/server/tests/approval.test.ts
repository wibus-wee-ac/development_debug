// Input: approval HTTP endpoints
// Output: integration tests for pending approval registry lifecycle and input validation
// Position: apps/server/tests

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'
import {
  clearSessionPolicies,
  generatePolicyKeys,
  isPreviouslyAllowed,
  markAllowed,
} from '../src/modules/approval/service'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('approval capability', () => {
  it('creates pending approvals, lists them with session filtering, and removes them after response', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      const createRes = await app.handle(new Request('http://localhost/approvals', {
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
      }))
      expect(createRes.status).toBe(200)
      const approval = await createRes.json() as { id: string, chatSessionId: string | null, options: Array<{ optionId: string }> }
      expect(approval).toEqual(expect.objectContaining({
        chatSessionId: 'session-approval',
      }))

      const listAllRes = await app.handle(new Request('http://localhost/approvals'))
      expect(listAllRes.status).toBe(200)
      expect(await listAllRes.json()).toEqual([expect.objectContaining({ id: approval.id })])

      const listSessionRes = await app.handle(new Request('http://localhost/approvals?chatSessionId=session-approval'))
      expect(listSessionRes.status).toBe(200)
      expect(await listSessionRes.json()).toEqual([expect.objectContaining({ id: approval.id })])

      const respondRes = await app.handle(new Request(`http://localhost/approvals/${encodeURIComponent(approval.id)}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision: 'approved',
          selectedOptionId: 'allow_once',
        }),
      }))
      expect(respondRes.status).toBe(200)
      expect(await respondRes.json()).toEqual({ ok: true })

      const afterRespondRes = await app.handle(new Request('http://localhost/approvals'))
      expect(afterRespondRes.status).toBe(200)
      expect(await afterRespondRes.json()).toEqual([])
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

  it('returns structured errors for invalid payloads, missing approvals, and invalid options', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      const invalidCreate = await app.handle(new Request('http://localhost/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-1',
          prompt: 'Missing options',
        }),
      }))
      expect(invalidCreate.status).toBe(400)
      expect((await invalidCreate.json()).code).toBe('validation_error')

      const missingApproval = await app.handle(new Request('http://localhost/approvals/missing/respond', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision: 'approved',
          selectedOptionId: 'allow_once',
        }),
      }))
      expect(missingApproval.status).toBe(404)
      expect((await missingApproval.json()).code).toBe('approval_not_found')

      const createRes = await app.handle(new Request('http://localhost/approvals', {
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
      }))
      const approval = await createRes.json() as { id: string }

      const invalidOption = await app.handle(new Request(`http://localhost/approvals/${encodeURIComponent(approval.id)}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision: 'approved',
          selectedOptionId: 'reject_once',
        }),
      }))
      expect(invalidOption.status).toBe(400)
      expect((await invalidOption.json()).code).toBe('invalid_approval_input')
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

describe('approval policy keys', () => {
  it('generates correct policy key format', () => {
    const keys = generatePolicyKeys({
      runtimeKind: 'claude-agent',
      chatSessionId: 'sess-1',
      toolName: 'file_write',
    })
    expect(keys).toEqual([
      'claude-agent:session:sess-1:tool:file_write',
    ])
  })

  it('returns false for isPreviouslyAllowed when no keys are set', () => {
    const keys = generatePolicyKeys({
      runtimeKind: 'claude-agent',
      chatSessionId: 'sess-fresh',
      toolName: 'bash',
    })
    expect(isPreviouslyAllowed('sess-fresh', keys)).toBe(false)
  })

  it('returns true for isPreviouslyAllowed after markAllowed', () => {
    const keys = generatePolicyKeys({
      runtimeKind: 'claude-agent',
      chatSessionId: 'sess-mark',
      toolName: 'bash',
    })
    markAllowed('sess-mark', keys)
    expect(isPreviouslyAllowed('sess-mark', keys)).toBe(true)
  })

  it('clearSessionPolicies removes all keys for a session', () => {
    const keys = generatePolicyKeys({
      runtimeKind: 'claude-agent',
      chatSessionId: 'sess-clear',
      toolName: 'file_read',
    })
    markAllowed('sess-clear', keys)
    expect(isPreviouslyAllowed('sess-clear', keys)).toBe(true)

    clearSessionPolicies('sess-clear')
    expect(isPreviouslyAllowed('sess-clear', keys)).toBe(false)
  })

  it('different sessions do not share policy keys', () => {
    const keysA = generatePolicyKeys({
      runtimeKind: 'claude-agent',
      chatSessionId: 'sess-a',
      toolName: 'bash',
    })
    const keysB = generatePolicyKeys({
      runtimeKind: 'claude-agent',
      chatSessionId: 'sess-b',
      toolName: 'bash',
    })
    markAllowed('sess-a', keysA)
    expect(isPreviouslyAllowed('sess-a', keysA)).toBe(true)
    expect(isPreviouslyAllowed('sess-b', keysB)).toBe(false)

    clearSessionPolicies('sess-a')
  })
})
