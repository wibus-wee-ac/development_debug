// Tests for session-await trigger dispatch
// Verifies that await completion is delivered through Chat Runtime's durable queue.

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { providerTargets, sessionAwaits, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '../src/errors/app-error'
import { db, shutdownInfra } from '../src/infra'
import { enqueueSessionQueueItem } from '../src/modules/chat-runtime/service'
import { registerSource, runOnce, unregisterSource } from '../src/modules/session-await/poller'
import {
  fetchAvailableChecks,
  getSessionSummary,
  listBySession,
  register,
  retryDelivery,
  trigger,
} from '../src/modules/session-await/service'
import { resetTokenCache } from '../src/modules/session-await/sources/github-ci'

vi.mock('../src/modules/chat-runtime/service', () => ({
  enqueueSessionQueueItem: vi.fn(),
}))

const mockedEnqueueSessionQueueItem = vi.mocked(enqueueSessionQueueItem)
const originalFetch = globalThis.fetch

describe('session-await trigger', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-await-test-'))
    process.env.CRADLE_DATA_DIR = dataDir
    mockedEnqueueSessionQueueItem.mockReset()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    unregisterSource('test-source')
    delete process.env.GITHUB_TOKEN
    resetTokenCache()
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
  })

  function seedSession(): { workspaceId: string, sessionId: string } {
    const d = db()
    const workspaceId = randomUUID()
    const providerTargetId = randomUUID()
    const sessionId = randomUUID()

    d.insert(workspaces).values({ id: workspaceId, name: 'ws', path: '/tmp/ws' }).run()
    d.insert(providerTargets).values({
      id: providerTargetId,
      kind: 'manual',
      providerKind: 'openai-compatible',
      displayName: 'p',
    }).run()
    d.insert(sessions).values({
      id: sessionId,
      workspaceId,
      providerTargetId,
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

  it('marks delivery failures as retryable and stores the resume message', async () => {
    const { awaitId } = seedAwait()

    mockedEnqueueSessionQueueItem.mockRejectedValueOnce(
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
    expect(result!.failureKind).toBe('delivery')
    expect(result!.resumeText).toBe('CI passed')
    expect(result!.lastErrorText).toContain('not found')
  })

  it('retries failed delivery without waiting for the external source again', async () => {
    const { awaitId, sessionId } = seedAwait()

    mockedEnqueueSessionQueueItem
      .mockRejectedValueOnce(new Error('Queue unavailable'))
      .mockResolvedValueOnce({} as never)

    const failed = await trigger({
      awaitId,
      resumeText: 'CI passed',
      resumePayloadJson: '{"state":"success"}',
    })

    expect(failed).toEqual(expect.objectContaining({
      status: 'failed',
      failureKind: 'delivery',
      resumeText: 'CI passed',
      resumePayloadJson: '{"state":"success"}',
    }))

    const retried = await retryDelivery({ awaitId })

    expect(retried).toEqual(expect.objectContaining({
      status: 'triggered',
      failureKind: null,
      lastErrorText: null,
      resumeText: 'CI passed',
      resumePayloadJson: '{"state":"success"}',
    }))
    expect(mockedEnqueueSessionQueueItem).toHaveBeenLastCalledWith({
      sessionId,
      text: 'CI passed',
    })
  })

  it('does not retry source failures through the delivery retry path', async () => {
    const { awaitId } = seedAwait()
    db()
      .update(sessionAwaits)
      .set({
        status: 'failed',
        failureKind: 'source',
        lastErrorText: 'GitHub CI target not found',
      })
      .where(eq(sessionAwaits.id, awaitId))
      .run()

    const retried = await retryDelivery({
      awaitId,
      resumeText: 'Proceed anyway',
    })

    expect(retried).toBeNull()
    expect(mockedEnqueueSessionQueueItem).not.toHaveBeenCalled()
  })

  it('marks as triggered and enqueues the resume message when dispatch succeeds', async () => {
    const { awaitId, sessionId } = seedAwait()

    mockedEnqueueSessionQueueItem.mockResolvedValueOnce({} as never)

    const result = await trigger({
      awaitId,
      resumeText: 'CI passed',
    })

    expect(result).not.toBeNull()
    expect(result!.status).toBe('triggered')
    expect(result!.failureKind).toBeNull()
    expect(result!.resumeText).toBe('CI passed')
    expect(mockedEnqueueSessionQueueItem).toHaveBeenCalledWith({
      sessionId,
      text: 'CI passed',
    })
  })

  it('rejects blank resume messages before dispatch', async () => {
    const { awaitId } = seedAwait()

    await expect(trigger({
      awaitId,
      resumeText: '   ',
    })).rejects.toThrow('resumeText must include non-whitespace content')

    expect(mockedEnqueueSessionQueueItem).not.toHaveBeenCalled()
  })

  it('does not deliver empty resume messages from a matched source adapter', async () => {
    const { workspaceId, sessionId } = seedSession()
    const awaitId = randomUUID()

    db().insert(sessionAwaits).values({
      id: awaitId,
      chatSessionId: sessionId,
      workspaceId,
      source: 'test-source',
      status: 'pending',
      filterJson: '{}',
    }).run()

    registerSource({
      source: 'test-source',
      async checkPending() {
        return [{ awaitId, matched: true, resumeText: '   ' }]
      },
    })

    await runOnce()

    const row = db().select().from(sessionAwaits).where(eq(sessionAwaits.id, awaitId)).get()
    expect(row).toEqual(expect.objectContaining({
      status: 'failed',
      failureKind: 'source',
      lastErrorText: 'Source adapter matched without a resume message',
    }))
    expect(mockedEnqueueSessionQueueItem).not.toHaveBeenCalled()
  })

  it('rejects unsupported await sources instead of creating pending records without a poller', async () => {
    const { workspaceId, sessionId } = seedSession()

    await expect(register({
      chatSessionId: sessionId,
      workspaceId,
      source: 'slack-thread',
      filterJson: '{}',
    })).rejects.toEqual(expect.objectContaining({
      code: 'session_await_source_unsupported',
      details: {
        supportedSources: ['github-ci', 'github-review', 'manual', 'timer'],
      },
    }))
    expect(db().select().from(sessionAwaits).all()).toHaveLength(0)
  })

  it('allows manual awaits as explicit trigger-only waits', async () => {
    const { workspaceId, sessionId } = seedSession()

    const result = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: 'manual',
      filterJson: '{}',
      reason: 'Waiting for a human to trigger this session',
    })

    expect(result).toEqual(expect.objectContaining({
      chatSessionId: sessionId,
      source: 'manual',
      status: 'pending',
    }))
  })

  it('rejects invalid timer and fireAt combinations', async () => {
    const { workspaceId, sessionId } = seedSession()

    await expect(register({
      chatSessionId: sessionId,
      workspaceId,
      source: 'timer',
      filterJson: '{}',
    })).rejects.toEqual(expect.objectContaining({
      code: 'session_await_timer_fire_at_required',
    }))

    await expect(register({
      chatSessionId: sessionId,
      workspaceId,
      source: 'manual',
      filterJson: '{}',
      fireAt: 200,
    })).rejects.toEqual(expect.objectContaining({
      code: 'session_await_fire_at_unsupported',
    }))
  })

  it('handles zero-valued timer timestamps as valid due times', async () => {
    const { workspaceId, sessionId } = seedSession()

    const result = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: 'timer',
      filterJson: '{}',
      fireAt: 0,
    })

    expect(result).toEqual(expect.objectContaining({
      source: 'timer',
      fireAt: 0,
      status: 'pending',
    }))
  })

  it('uses stable pending ordering for list and summary projections', () => {
    const { workspaceId, sessionId } = seedSession()

    db().insert(sessionAwaits).values([
      {
        id: 'await-newer',
        chatSessionId: sessionId,
        workspaceId,
        source: 'manual',
        status: 'pending',
        filterJson: '{}',
        reason: 'Second wait',
        createdAt: 200,
      },
      {
        id: 'await-older',
        chatSessionId: sessionId,
        workspaceId,
        source: 'manual',
        status: 'pending',
        filterJson: '{}',
        reason: 'First wait',
        createdAt: 100,
      },
    ]).run()

    expect(getSessionSummary(sessionId)).toEqual(expect.objectContaining({
      awaiting: true,
      pendingCount: 2,
      reason: 'First wait',
    }))
    expect(listBySession(sessionId).map(row => row.id)).toEqual(['await-newer', 'await-older'])
  })

  it('rejects GitHub CI registration when the commit target is not found', async () => {
    process.env.GITHUB_TOKEN = 'token'
    resetTokenCache()
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'Not Found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

    const { workspaceId, sessionId } = seedSession()

    await expect(register({
      chatSessionId: sessionId,
      workspaceId,
      source: 'github-ci',
      filterJson: JSON.stringify({ repo: 'acme/app', sha: 'missing-sha' }),
    })).rejects.toEqual(expect.objectContaining({
      code: 'github_await_target_invalid',
      message: 'GitHub CI target not found or inaccessible: acme/app commit missing-sha.',
    }))
    expect(db().select().from(sessionAwaits).all()).toHaveLength(0)
  })

  it('returns a product error when available checks cannot read the repo', async () => {
    process.env.GITHUB_TOKEN = 'token'
    resetTokenCache()
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'Not Found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

    await expect(fetchAvailableChecks('acme', 'missing')).rejects.toEqual(expect.objectContaining({
      code: 'github_repo_not_found',
      status: 404,
      message: 'Repository acme/missing not found or inaccessible',
    }))
  })
})
