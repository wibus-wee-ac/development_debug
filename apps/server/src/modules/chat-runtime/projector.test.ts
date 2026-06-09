import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  backendRuns,
  backendSessionBindings,
  chatSessionQueueItems,
  messages,
  sessions,
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../../app'
import { db, shutdownInfra } from '../../infra'
import type { ChatRuntimeEventRecord } from './events'
import { projectChatRuntimeReadModels } from './projector'

const previousDataDir = process.env.CRADLE_DATA_DIR
const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
let dataDir: string

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function event(
  seq: number,
  type: ChatRuntimeEventRecord['type'],
  overrides: Partial<ChatRuntimeEventRecord> = {},
): ChatRuntimeEventRecord {
  return {
    id: `event-${seq}`,
    streamId: 'session-projector',
    seq,
    type,
    commandId: null,
    actorKind: null,
    actorId: null,
    runId: null,
    messageId: null,
    queueItemId: null,
    occurredAt: 1700000000 + seq,
    payload: {},
    ...overrides,
  }
}

describe('chat runtime read-model projector', () => {
  beforeEach(async () => {
    dataDir = makeTempDir('cradle-chat-projector-')
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-projector-secret'
    await createServerApp()
    db().insert(sessions).values({
      id: 'session-projector',
      workspaceId: null,
      title: 'Projector Session',
      providerTargetId: null,
      runtimeKind: 'codex',
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

  it('projects runs, messages, and queue without mutating Provider Runtime bindings', () => {
    db().insert(backendSessionBindings).values({
      id: 'provider-runtime-binding-1',
      chatSessionId: 'session-projector',
      providerTargetId: null,
      runtimeKind: 'codex',
      backendSessionId: 'codex-thread-current',
      backendStateSnapshot: JSON.stringify({ models: { currentModelId: 'gpt-5-current' } }),
      requestedModelId: 'gpt-5-current',
      createdAt: 1700000000,
      updatedAt: 1700000100,
    }).run()
    const userMessage = {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
    }
    const assistantMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'done' }],
    }
    const events = [
      event(1, 'run.provider_context_recorded', {
        runId: 'run-1',
        payload: {
          providerTargetId: null,
          runtimeKind: 'codex',
          backendSessionId: 'codex-thread-stale',
          requestedModelId: 'gpt-5-codex',
          backendStateSnapshot: { models: { currentModelId: 'gpt-5-codex' } },
        },
      }),
      event(2, 'user_message.appended', {
        messageId: 'user-1',
        payload: { text: 'hello', message: userMessage },
      }),
      event(3, 'assistant_message.created', {
        messageId: 'assistant-1',
        runId: 'run-1',
        payload: { message: { id: 'assistant-1', role: 'assistant', parts: [] } },
      }),
      event(4, 'queue.item_enqueued', {
        queueItemId: 'queue-1',
        payload: {
          text: 'continue',
          position: 1,
          files: [],
          contextParts: [],
          modelId: 'gpt-5-codex',
          thinkingEffort: 'high',
          runtimeAccessMode: 'full-access',
          runtimeInteractionMode: 'default',
          createdAt: 1700000004,
          updatedAt: 1700000004,
        },
      }),
      event(5, 'queue.item_claimed', {
        queueItemId: 'queue-1',
        runId: 'run-1',
      }),
      event(6, 'run.started', {
        runId: 'run-1',
        messageId: 'assistant-1',
        queueItemId: 'queue-1',
        payload: { origin: 'user', runtimeKind: 'codex', modelId: 'gpt-5-codex' },
      }),
      event(7, 'assistant_message.snapshot_recorded', {
        runId: 'run-1',
        messageId: 'assistant-1',
        payload: { status: 'complete', text: 'done', snapshot: assistantMessage },
      }),
      event(8, 'run.completed', {
        runId: 'run-1',
        messageId: 'assistant-1',
        queueItemId: 'queue-1',
        payload: { stopReason: 'stop' },
      }),
    ]

    const first = projectChatRuntimeReadModels({ streamId: 'session-projector', events })
    const second = projectChatRuntimeReadModels({ streamId: 'session-projector', events })

    expect(first.counts).toEqual(second.counts)
    expect(first.counts.bindings).toBe(0)
    expect(first.state.status).toBe('idle')
    expect(db().select().from(messages).where(eq(messages.sessionId, 'session-projector')).all()).toHaveLength(2)
    expect(db().select().from(backendRuns).where(eq(backendRuns.chatSessionId, 'session-projector')).all()).toEqual([
      expect.objectContaining({
        id: 'run-1',
        bindingId: 'provider-runtime-binding-1',
        status: 'complete',
        messageId: 'assistant-1',
        finishedAt: 1700000008,
      }),
    ])
    expect(db().select().from(chatSessionQueueItems).where(eq(chatSessionQueueItems.sessionId, 'session-projector')).all()).toEqual([
      expect.objectContaining({
        id: 'queue-1',
        status: 'completed',
        startedRunId: 'run-1',
        text: 'continue',
      }),
    ])
    expect(db().select().from(backendSessionBindings).where(eq(backendSessionBindings.chatSessionId, 'session-projector')).get()).toEqual(
      expect.objectContaining({
        id: 'provider-runtime-binding-1',
        providerTargetId: null,
        runtimeKind: 'codex',
        backendSessionId: 'codex-thread-current',
        requestedModelId: 'gpt-5-current',
        updatedAt: 1700000100,
      }),
    )
  })

  it('does not project a durable binding before the provider has a backend session id', () => {
    const events = [
      event(1, 'run.provider_context_recorded', {
        runId: 'run-null-binding',
        payload: {
          providerTargetId: null,
          runtimeKind: 'codex',
          backendSessionId: null,
          requestedModelId: 'gpt-5-codex',
          backendStateSnapshot: { models: { currentModelId: 'gpt-5-codex' } },
        },
      }),
      event(2, 'assistant_message.created', {
        messageId: 'assistant-null-binding',
        runId: 'run-null-binding',
        payload: { message: { id: 'assistant-null-binding', role: 'assistant', parts: [] } },
      }),
      event(3, 'run.started', {
        runId: 'run-null-binding',
        messageId: 'assistant-null-binding',
        payload: { origin: 'user', runtimeKind: 'codex', modelId: 'gpt-5-codex' },
      }),
    ]

    const result = projectChatRuntimeReadModels({ streamId: 'session-projector', events })

    expect(result.counts.bindings).toBe(0)
    expect(db().select().from(backendSessionBindings).where(eq(backendSessionBindings.chatSessionId, 'session-projector')).get()).toBeUndefined()
    expect(db().select().from(backendRuns).where(eq(backendRuns.id, 'run-null-binding')).get()).toEqual(
      expect.objectContaining({
        bindingId: null,
        status: 'streaming',
      }),
    )
  })

  it('does not borrow fallback text from another assistant message during replay projection', () => {
    const events = [
      event(1, 'assistant_message.created', {
        messageId: 'assistant-empty',
        runId: 'run-empty',
        payload: {},
      }),
      event(2, 'run.started', {
        runId: 'run-empty',
        messageId: 'assistant-empty',
      }),
      event(3, 'assistant_message.created', {
        messageId: 'assistant-text',
        runId: 'run-text',
        payload: {},
      }),
      event(4, 'assistant_message.snapshot_recorded', {
        runId: 'run-text',
        messageId: 'assistant-text',
        payload: { status: 'complete', text: 'text for the second assistant only' },
      }),
      event(5, 'run.completed', {
        runId: 'run-text',
        messageId: 'assistant-text',
      }),
    ]

    projectChatRuntimeReadModels({ streamId: 'session-projector', events })

    expect(db().select().from(messages).where(eq(messages.id, 'assistant-empty')).get()).toEqual(
      expect.objectContaining({
        content: '',
        messageJson: JSON.stringify({
          id: 'assistant-empty',
          role: 'assistant',
          parts: [],
        }),
      }),
    )
    expect(db().select().from(messages).where(eq(messages.id, 'assistant-text')).get()).toEqual(
      expect.objectContaining({
        content: 'text for the second assistant only',
      }),
    )
  })
})
