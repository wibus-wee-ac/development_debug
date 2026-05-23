// Tests for session-await trigger 409 handling
// Verifies that createRun returning 409 (session busy) rolls back await to 'pending'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentProfiles, sessionAwaits, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '../src/errors/app-error'
import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { createRun } from '../src/modules/chat-runtime/service'
import { resetTokenCache } from '../src/modules/session-await/sources/github-ci'
import { trigger } from '../src/modules/session-await/service'

// Mock createRun to simulate 409 without needing full chat runtime setup
vi.mock('../src/modules/chat-runtime/service', () => ({
  createRun: vi.fn(),
}))

const mockedCreateRun = vi.mocked(createRun)
const originalFetch = globalThis.fetch

describe('session-await trigger', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-await-test-'))
    process.env.CRADLE_DATA_DIR = dataDir
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.GITHUB_TOKEN
    resetTokenCache()
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
  })

  function seedSession(): { workspaceId: string, sessionId: string } {
    const d = db()
    const workspaceId = randomUUID()
    const profileId = randomUUID()
    const sessionId = randomUUID()

    d.insert(workspaces).values({ id: workspaceId, name: 'ws', path: '/tmp/ws' }).run()
    d.insert(agentProfiles).values({ id: profileId, name: 'p', providerKind: 'openai-compatible' }).run()
    d.insert(sessions).values({
      id: sessionId,
      workspaceId,
      agentProfileId: profileId,
      title: 'test',
    }).run()

    return { workspaceId, sessionId }
  }

  function seedAwait(): { awaitId: string, sessionId: string } {
    const { workspaceId, sessionId } = seedSession()
    const awaitId = randomUUID()

    db().insert(sessionAwaits).values({
      id: awaitId,
      chatSessionId: sessionId,
      workspaceId,
      source: 'github-ci',
      status: 'pending',
      filterJson: '{}',
    }).run()

    return { awaitId, sessionId }
  }

  it('rolls back to pending when createRun throws 409 AppError', async () => {
    const { awaitId } = seedAwait()

    // Simulate the exact error thrown by createRun when session is busy
    mockedCreateRun.mockRejectedValueOnce(
      new AppError({
        code: 'chat_run_in_progress',
        status: 409,
        message: 'Chat session already has an active run',
      }),
    )

    const result = await trigger({
      awaitId,
      resumeText: 'CI passed',
    })

    expect(result).not.toBeNull()
    expect(result!.status).toBe('pending')
    expect(result!.lastErrorText).toContain('active run')
    // triggeredAt should be cleared
    expect(result!.triggeredAt).toBeNull()
  })

  it('marks as failed for non-retryable errors', async () => {
    const { awaitId } = seedAwait()

    mockedCreateRun.mockRejectedValueOnce(
      new AppError({
        code: 'chat_session_not_found',
        status: 404,
        message: 'Chat session not found',
      }),
    )

    const result = await trigger({
      awaitId,
      resumeText: 'CI passed',
    })

    expect(result).not.toBeNull()
    expect(result!.status).toBe('failed')
    expect(result!.lastErrorText).toContain('not found')
  })

  it('marks as triggered when createRun succeeds', async () => {
    const { awaitId } = seedAwait()

    mockedCreateRun.mockResolvedValueOnce(undefined as never)

    const result = await trigger({
      awaitId,
      resumeText: 'CI passed',
    })

    expect(result).not.toBeNull()
    expect(result!.status).toBe('triggered')
  })

  it('rejects GitHub CI registration when the commit target is not found', async () => {
    process.env.GITHUB_TOKEN = 'token'
    resetTokenCache()
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'Not Found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

    const app = await createServerApp({ startBackgroundTasks: false })
    const { workspaceId, sessionId } = seedSession()

    const res = await app.handle(new Request('http://localhost/session-awaits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chatSessionId: sessionId,
        workspaceId,
        source: 'github-ci',
        filterJson: JSON.stringify({ repo: 'acme/app', sha: 'missing-sha' }),
      }),
    }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual(expect.objectContaining({
      code: 'github_await_target_invalid',
      message: 'GitHub CI target not found or inaccessible: acme/app commit missing-sha.',
    }))
    expect(db().select().from(sessionAwaits).all()).toHaveLength(0)
  })

  it('marks an existing GitHub CI await failed when live status finds a missing commit', async () => {
    process.env.GITHUB_TOKEN = 'token'
    resetTokenCache()
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'No commit found for SHA: missing-sha' }), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

    const app = await createServerApp({ startBackgroundTasks: false })
    const { workspaceId, sessionId } = seedSession()
    const awaitId = randomUUID()
    db().insert(sessionAwaits).values({
      id: awaitId,
      chatSessionId: sessionId,
      workspaceId,
      source: 'github-ci',
      status: 'pending',
      filterJson: JSON.stringify({ repo: 'acme/app', sha: 'missing-sha' }),
      reason: 'Waiting for GitHub checks on acme/app@missing-sha',
    }).run()

    const res = await app.handle(new Request(`http://localhost/session-awaits/${awaitId}/live-status`))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      supported: false,
      error: {
        code: 'github_await_target_invalid',
        message: 'GitHub CI target not found or inaccessible: acme/app commit missing-sha.',
      },
    })
    expect(db().select().from(sessionAwaits).where(eq(sessionAwaits.id, awaitId)).get()).toEqual(expect.objectContaining({
      status: 'failed',
      lastErrorText: 'GitHub CI target not found or inaccessible: acme/app commit missing-sha.',
    }))
  })
})
