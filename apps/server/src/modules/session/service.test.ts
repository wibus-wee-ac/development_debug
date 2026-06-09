import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendRuns, chatRuntimeEvents, sessions } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../../app'
import { db, shutdownInfra } from '../../infra'
import { stringifyChatRuntimeEventPayload } from '../chat-runtime/events'
import { get, list } from './service'

const previousDataDir = process.env.CRADLE_DATA_DIR
const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
let dataDir: string

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('session event-derived status', () => {
  beforeEach(async () => {
    dataDir = makeTempDir('cradle-session-status-')
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'session-status-secret'
    await createServerApp()
    db().insert(sessions).values({
      id: 'session-event-status',
      workspaceId: null,
      title: 'Event Status Session',
      providerTargetId: null,
      runtimeKind: 'standard',
      agentId: null,
      configJson: '{}',
      linkedIssueId: null,
      pinned: 0,
      createdAt: 1700000000,
      updatedAt: 1700000000,
    }).run()
  })

  afterEach(() => {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    if (previousDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previousDataDir
    }
    if (previousSecret === undefined) {
      delete process.env.CRADLE_CREDENTIAL_SECRET
    }
    else {
      process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
    }
  })

  it('uses Chat Runtime event state instead of stale backend run status', () => {
    db().insert(backendRuns).values({
      id: 'run-stale',
      bindingId: null,
      chatSessionId: 'session-event-status',
      messageId: null,
      origin: 'user',
      status: 'streaming',
      stopReason: null,
      errorText: null,
      startedAt: 1700000001,
      finishedAt: null,
    }).run()
    db().insert(chatRuntimeEvents).values([
      {
        id: 'event-1',
        streamId: 'session-event-status',
        seq: 1,
        type: 'run.started',
        commandId: null,
        actorKind: null,
        actorId: null,
        runId: 'run-stale',
        messageId: null,
        queueItemId: null,
        occurredAt: 1700000001,
        payloadJson: stringifyChatRuntimeEventPayload({}),
      },
      {
        id: 'event-2',
        streamId: 'session-event-status',
        seq: 2,
        type: 'run.completed',
        commandId: null,
        actorKind: null,
        actorId: null,
        runId: 'run-stale',
        messageId: null,
        queueItemId: null,
        occurredAt: 1700000002,
        payloadJson: stringifyChatRuntimeEventPayload({}),
      },
    ]).run()

    expect(get('session-event-status')?.status).toBe('idle')
    expect(list().find(session => session.id === 'session-event-status')?.status).toBe('idle')
  })
})
