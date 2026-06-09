import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendRuns, chatRuntimeEvents, sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../../app'
import { db, shutdownInfra } from '../../infra'
import { stringifyChatRuntimeEventPayload } from './events'
import { readEventDerivedRuntimeState } from './runtime-state'
import { getRuntimeSessionStatus } from './service'

const previousDataDir = process.env.CRADLE_DATA_DIR
const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
let dataDir: string

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('event-derived runtime state', () => {
  beforeEach(async () => {
    dataDir = makeTempDir('cradle-runtime-state-')
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-state-secret'
    await createServerApp()
    db().insert(sessions).values({
      id: 'session-runtime-state',
      workspaceId: null,
      title: 'Runtime State Session',
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

  it('uses terminal events over stale streaming run read models', () => {
    db().insert(backendRuns).values({
      id: 'run-stale',
      bindingId: null,
      chatSessionId: 'session-runtime-state',
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
        streamId: 'session-runtime-state',
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
        streamId: 'session-runtime-state',
        seq: 2,
        type: 'run.failed',
        commandId: null,
        actorKind: null,
        actorId: null,
        runId: 'run-stale',
        messageId: null,
        queueItemId: null,
        occurredAt: 1700000002,
        payloadJson: stringifyChatRuntimeEventPayload({ errorText: 'failed in event log' }),
      },
    ]).run()

    expect(readEventDerivedRuntimeState('session-runtime-state')).toEqual({
      hasEvents: true,
      status: 'error',
      activeRunId: null,
      latestRunId: 'run-stale',
      latestRunStatus: 'failed',
      queue: { pending: 0, running: 0 },
    })
  })

  it('interrupts orphaned event-backed streaming runs from runtime status reads', () => {
    db().insert(chatRuntimeEvents).values([
      {
        id: 'event-orphan-1',
        streamId: 'session-runtime-state',
        seq: 1,
        type: 'assistant_message.created',
        commandId: null,
        actorKind: null,
        actorId: null,
        runId: 'run-orphan',
        messageId: 'assistant-orphan',
        queueItemId: null,
        occurredAt: 1700000001,
        payloadJson: stringifyChatRuntimeEventPayload({}),
      },
      {
        id: 'event-orphan-2',
        streamId: 'session-runtime-state',
        seq: 2,
        type: 'run.started',
        commandId: null,
        actorKind: null,
        actorId: null,
        runId: 'run-orphan',
        messageId: 'assistant-orphan',
        queueItemId: null,
        occurredAt: 1700000002,
        payloadJson: stringifyChatRuntimeEventPayload({}),
      },
    ]).run()

    expect(getRuntimeSessionStatus('session-runtime-state').status).toBe('idle')
    const events = db()
      .select()
      .from(chatRuntimeEvents)
      .where(eq(chatRuntimeEvents.streamId, 'session-runtime-state'))
      .all()

    expect(events.map(event => event.type)).toContain('run.interrupted')
    expect(readEventDerivedRuntimeState('session-runtime-state')).toEqual(expect.objectContaining({
      hasEvents: true,
      status: 'error',
      activeRunId: null,
      latestRunId: 'run-orphan',
      latestRunStatus: 'failed',
    }))
  })
})
