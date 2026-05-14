// Tests for session-await trigger 409 handling
// Verifies that createRun returning 409 (session busy) rolls back await to 'pending'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions, sessionAwaits, workspaces, agentProfiles } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '../src/errors/app-error'
import { db, shutdownInfra } from '../src/infra'

// Mock createRun to simulate 409 without needing full chat runtime setup
vi.mock('../src/modules/chat-runtime/service', () => ({
  createRun: vi.fn(),
}))

import { createRun } from '../src/modules/chat-runtime/service'
import { trigger } from '../src/modules/session-await/service'

const mockedCreateRun = vi.mocked(createRun)

describe('session-await trigger', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-await-test-'))
    process.env.CRADLE_DATA_DIR = dataDir
  })

  afterEach(() => {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
  })

  function seedAwait(): { awaitId: string, sessionId: string } {
    const d = db()
    const workspaceId = randomUUID()
    const profileId = randomUUID()
    const sessionId = randomUUID()
    const awaitId = randomUUID()

    d.insert(workspaces).values({ id: workspaceId, name: 'ws', path: '/tmp/ws' }).run()
    d.insert(agentProfiles).values({ id: profileId, name: 'p', providerKind: 'openai-compatible' }).run()
    d.insert(sessions).values({
      id: sessionId,
      workspaceId,
      agentProfileId: profileId,
      title: 'test',
    }).run()
    d.insert(sessionAwaits).values({
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
})
