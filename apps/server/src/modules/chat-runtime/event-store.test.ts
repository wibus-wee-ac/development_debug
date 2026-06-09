import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../../app'
import { AppError } from '../../errors/app-error'
import { db, shutdownInfra } from '../../infra'
import { appendChatRuntimeEvents, readChatRuntimeEvents } from './event-store'

const previousDataDir = process.env.CRADLE_DATA_DIR
const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
let dataDir: string

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('chat runtime event store', () => {
  beforeEach(async () => {
    dataDir = makeTempDir('cradle-chat-events-')
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-events-secret'
    await createServerApp()
    db().insert(sessions).values({
      id: 'session-events',
      workspaceId: null,
      title: 'Event Store Session',
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

  it('appends events with monotonic session sequence and reads them in order', () => {
    const appended = appendChatRuntimeEvents({
      streamId: 'session-events',
      expectedSeq: 0,
      commandId: 'cmd-1',
      events: [
        { type: 'user_message.appended', messageId: 'user-1', payload: { text: 'hello' } },
        { type: 'assistant_message.created', messageId: 'assistant-1', runId: 'run-1' },
        {
          type: 'run.provider_context_recorded',
          runId: 'run-1',
          payload: { runtimeKind: 'standard', backendSessionId: null },
        },
        { type: 'run.started', messageId: 'assistant-1', runId: 'run-1' },
      ],
    })

    expect(appended.map(event => event.seq)).toEqual([1, 2, 3, 4])
    expect(readChatRuntimeEvents('session-events').map(event => event.type)).toEqual([
      'user_message.appended',
      'assistant_message.created',
      'run.provider_context_recorded',
      'run.started',
    ])
  })

  it('returns existing command events when the same command id is retried', () => {
    const first = appendChatRuntimeEvents({
      streamId: 'session-events',
      expectedSeq: 0,
      commandId: 'cmd-idempotent',
      events: [{ type: 'run.started', runId: 'run-1' }],
    })
    const second = appendChatRuntimeEvents({
      streamId: 'session-events',
      expectedSeq: 1,
      commandId: 'cmd-idempotent',
      events: [{ type: 'run.started', runId: 'run-duplicate' }],
    })

    expect(second).toEqual(first)
    expect(readChatRuntimeEvents('session-events')).toHaveLength(1)
  })

  it('rejects append when expected sequence is stale', () => {
    appendChatRuntimeEvents({
      streamId: 'session-events',
      expectedSeq: 0,
      events: [{ type: 'run.started', runId: 'run-1' }],
    })

    expect(() => appendChatRuntimeEvents({
      streamId: 'session-events',
      expectedSeq: 0,
      events: [{ type: 'run.started', runId: 'run-2' }],
    })).toThrow(AppError)
  })

  it('rejects semantically invalid events before appending rows', () => {
    expect(() => appendChatRuntimeEvents({
      streamId: 'session-events',
      expectedSeq: 0,
      events: [{ type: 'run.started', messageId: 'assistant-1' }],
    })).toThrow(AppError)

    expect(readChatRuntimeEvents('session-events')).toHaveLength(0)
  })

  it('validates run provider context event payload shape', () => {
    expect(() => appendChatRuntimeEvents({
      streamId: 'session-events',
      expectedSeq: 0,
      events: [{
        type: 'run.provider_context_recorded',
        runId: 'run-1',
        payload: {
          backendSessionId: 'provider-session-1',
        },
      }],
    })).toThrow(AppError)

    expect(readChatRuntimeEvents('session-events')).toHaveLength(0)
  })
})
