// Focused coverage for chat stream trace filesystem persistence.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentProfiles, backendRuns, backendSessionBindings, messages, sessions, workspaces } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import {
  readChatRunTrace,
  recordChatStreamTrace,
  resolveChatStreamTracePath,
} from '../src/modules/chat-runtime/stream-trace'

describe('chat stream trace', () => {
  const previous = {
    dataDir: process.env.CRADLE_DATA_DIR,
    trace: process.env.CRADLE_CHAT_STREAM_TRACE,
    secret: process.env.CRADLE_CREDENTIAL_SECRET,
  }
  const tempDirs: string[] = []

  afterEach(() => {
    shutdownInfra()

    if (previous.dataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previous.dataDir
    }

    if (previous.trace === undefined) {
      delete process.env.CRADLE_CHAT_STREAM_TRACE
    }
    else {
      process.env.CRADLE_CHAT_STREAM_TRACE = previous.trace
    }

    if (previous.secret === undefined) {
      delete process.env.CRADLE_CREDENTIAL_SECRET
    }
    else {
      process.env.CRADLE_CREDENTIAL_SECRET = previous.secret
    }

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it('writes and reads ordered JSONL records by run id', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-trace-'))
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CHAT_STREAM_TRACE = '1'

    const context = {
      chatSessionId: 'session-1',
      runId: 'run-1',
      messageId: 'message-1',
      runtimeKind: 'claude-agent',
      providerSessionId: null,
    }

    recordChatStreamTrace({
      ...context,
      phase: 'provider_raw',
      payload: { type: 'stream_event' },
    })
    recordChatStreamTrace({
      ...context,
      phase: 'mapper_output',
      payload: { chunks: [{ type: 'tool-input-delta' }] },
    })

    const trace = readChatRunTrace('run-1')

    expect(trace.path).toBe(resolveChatStreamTracePath('run-1'))
    expect(trace.recordCount).toBe(2)
    expect(trace.records.map(record => record.seq)).toEqual([0, 1])
    expect(trace.records.map(record => record.phase)).toEqual(['provider_raw', 'mapper_output'])
  })

  it('does not write traces when explicitly disabled', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-trace-disabled-'))
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CHAT_STREAM_TRACE = '0'

    recordChatStreamTrace({
      chatSessionId: 'session-1',
      runId: 'run-disabled',
      messageId: 'message-1',
      runtimeKind: 'claude-agent',
      phase: 'provider_raw',
      payload: { type: 'stream_event' },
    })

    expect(existsSync(resolveChatStreamTracePath('run-disabled'))).toBe(false)
  })

  it('returns decoded trace records by run id and session id through chat routes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-trace-route-'))
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CHAT_STREAM_TRACE = '1'
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-stream-trace-secret'

    const app = await createServerApp({ startBackgroundTasks: false })
    const now = 1700000000

    db().insert(workspaces).values({
      id: 'workspace-trace-route',
      name: 'Trace Route Workspace',
      path: dataDir,
    }).run()
    db().insert(agentProfiles).values({
      id: 'profile-trace-route',
      name: 'Trace Route Profile',
      providerKind: 'anthropic',
      enabled: true,
      configJson: JSON.stringify({ model: 'claude-sonnet-4-20250514' }),
      credentialRef: null,
      customModels: '[]',
      iconSlug: null,
      createdAt: now,
      updatedAt: now,
    }).run()
    db().insert(sessions).values({
      id: 'session-trace-route',
      workspaceId: 'workspace-trace-route',
      title: 'Trace Route Session',
      agentProfileId: 'profile-trace-route',
      providerTargetKind: 'manual-profile',
      providerTargetId: 'profile-trace-route',
      runtimeKind: 'claude-agent',
      configJson: '{}',
      pinned: 0,
      createdAt: now,
      updatedAt: now,
    }).run()
    db().insert(messages).values({
      id: 'message-trace-route',
      sessionId: 'session-trace-route',
      parentMessageId: null,
      parentToolCallId: null,
      taskId: null,
      depth: 0,
      role: 'assistant',
      status: 'streaming',
      content: '',
      messageJson: JSON.stringify({ id: 'message-trace-route', role: 'assistant', parts: [] }),
      errorText: null,
      createdAt: now,
      updatedAt: now,
    }).run()
    db().insert(backendSessionBindings).values({
      id: 'binding-trace-route',
      chatSessionId: 'session-trace-route',
      agentProfileId: 'profile-trace-route',
      providerTargetKind: 'manual-profile',
      providerTargetId: 'profile-trace-route',
      runtimeKind: 'claude-agent',
      backendSessionId: null,
      backendStateSnapshot: null,
      requestedModelId: 'claude-sonnet-4-20250514',
      createdAt: now,
      updatedAt: now,
    }).run()
    db().insert(backendRuns).values({
      id: 'run-trace-route',
      bindingId: 'binding-trace-route',
      chatSessionId: 'session-trace-route',
      messageId: 'message-trace-route',
      origin: 'user',
      status: 'streaming',
      stopReason: null,
      errorText: null,
      startedAt: now,
      finishedAt: null,
    }).run()

    recordChatStreamTrace({
      chatSessionId: 'session-trace-route',
      runId: 'run-trace-route',
      messageId: 'message-trace-route',
      runtimeKind: 'claude-agent',
      providerSessionId: null,
      phase: 'provider_raw',
      payload: { type: 'stream_event', event: { type: 'content_block_delta' } },
    })

    const runResponse = await app.handle(new Request('http://localhost/chat/runs/run-trace-route/trace'))
    expect(runResponse.status).toBe(200)
    const runTrace = await runResponse.json() as { runId: string, recordCount: number, records: Array<{ phase: string }> }
    expect(runTrace.runId).toBe('run-trace-route')
    expect(runTrace.recordCount).toBe(1)
    expect(runTrace.records[0]?.phase).toBe('provider_raw')

    const sessionResponse = await app.handle(new Request('http://localhost/chat/sessions/session-trace-route/traces'))
    expect(sessionResponse.status).toBe(200)
    const sessionTrace = await sessionResponse.json() as { sessionId: string, traces: Array<{ runId: string, recordCount: number }> }
    expect(sessionTrace.sessionId).toBe('session-trace-route')
    expect(sessionTrace.traces).toEqual([
      expect.objectContaining({ runId: 'run-trace-route', recordCount: 1 }),
    ])
  })
})
