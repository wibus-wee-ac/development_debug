// Input: chat runtime HTTP endpoints
// Output: integration tests for chat runs, message hydration, usage writes, search hits, and abort behavior
// Position: apps/server/tests

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { messages, workspaces } from '@cradle/db'
import { describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

interface ChatMessageRow {
  messageId: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText?: string
  content: string
  parentToolCallId?: string | null
  message: { parts: Array<{ type: string, text?: string, [key: string]: unknown }> }
}

interface ChatStreamEvent {
  type: string
  data: Record<string, unknown>
}

type ElysiaApp = ReturnType<typeof createServerApp>

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function createProfileAndSession(
  app: ElysiaApp,
  workspaceId: string,
  ids: { profileId: string, sessionId: string },
) {
  const credentialRes = await app.handle(new Request('http://localhost/secrets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'openai-compatible',
      label: 'Chat Runtime Key',
      secret: 'sk-chat-runtime-test',
    }),
  }))
  const credential = await credentialRes.json() as { id: string }

  const profileRes = await app.handle(new Request(`http://localhost/profiles/${ids.profileId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Chat Runtime Profile',
      providerKind: 'openai-compatible',
      enabled: true,
      config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o-mini' },
      credentialRef: credential.id,
    }),
  }))
  expect(profileRes.status).toBe(200)

  const sessionRes = await app.handle(new Request('http://localhost/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: ids.sessionId,
      workspaceId,
      title: 'Chat Runtime Session',
      agentProfileId: ids.profileId,
    }),
  }))
  expect(sessionRes.status).toBe(200)
}

async function waitForMessageStatus(app: ElysiaApp, sessionId: string, expectedStatus: ChatMessageRow['status']): Promise<ChatMessageRow[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.handle(new Request(`http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/messages`))
    if (response.status === 200) {
      const groups = await response.json() as ChatMessageRow[]
      const assistant = groups.find(group => group.role === 'assistant')
      if (assistant?.status === expectedStatus) {
        return groups
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  throw new Error(`Timed out waiting for assistant status ${expectedStatus}`)
}

function buildSseResponse(chunks: string[], delaysMs?: number[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      let index = 0
      const push = () => {
        if (index >= chunks.length) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(chunks[index]))
        const delay = delaysMs?.[index] ?? 0
        index += 1
        setTimeout(push, delay)
      }
      push()
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

async function collectSseEvents(response: Response): Promise<ChatStreamEvent[]> {
  const payload = await response.text()
  return payload
    .split('\n\n')
    .map(block => block.trim())
    .filter(block => block.startsWith('data: '))
    .map((block) => {
      const data = block
        .split('\n')
        .filter(line => line.startsWith('data: '))
        .map(line => line.slice('data: '.length))
        .join('\n')
      return JSON.parse(data) as ChatStreamEvent
    })
}

describe('chat runtime capability', () => {
  it('runs an openai-compatible turn, writes message snapshots and usage, and makes assistant text searchable', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/chat/completions')) {
        expect(init?.method).toBe('POST')
        const payload = JSON.parse(String(init?.body)) as { messages: Array<{ role: string, content: string }> }
        expect(payload.messages.at(-1)).toEqual({ role: 'user', content: 'Explain server runtime' })
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"from chat runtime"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-3","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}\n\n',
          'data: [DONE]\n\n',
        ])
      }
      // models.dev or other external calls — return empty JSON so registry caches it
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat',
        name: 'Workspace Chat',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat', {
        profileId: 'profile-chat',
        sessionId: 'session-chat',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Explain server runtime', modelId: 'gpt-4o-mini' }),
      }))
      expect(runRes.status).toBe(200)

      const rows = await waitForMessageStatus(app, 'session-chat', 'complete')
      expect(rows).toHaveLength(2)
      expect(rows[0]).toEqual(expect.objectContaining({ role: 'user', content: 'Explain server runtime', status: 'complete' }))
      expect(rows[1]).toEqual(expect.objectContaining({ role: 'assistant', content: 'Hello from chat runtime', status: 'complete' }))
      expect(rows[1].message.parts).toEqual([
        expect.objectContaining({ type: 'text', text: 'Hello from chat runtime' }),
      ])

      const usageRes = await app.handle(new Request('http://localhost/usage/sessions/session-chat'))
      expect(usageRes.status).toBe(200)
      expect(await usageRes.json()).toEqual(expect.objectContaining({
        promptTokens: 10,
        completionTokens: 3,
        totalTokens: 13,
      }))

      const searchRes = await app.handle(new Request('http://localhost/search/threads?query=Hello%20from%20chat%20runtime'))
      expect(searchRes.status).toBe(200)
      const hits = await searchRes.json() as Array<{ sessionId: string }>
      expect(hits).toEqual([expect.objectContaining({ sessionId: 'session-chat' })])
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))).toHaveLength(1)
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
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
    }
  })

  it('streams sequenced message_delta events and ends with run_completed', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/chat/completions')) {
        expect(init?.method).toBe('POST')
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"stream protocol"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-3","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":4,"total_tokens":12}}\n\n',
          'data: [DONE]\n\n',
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-stream',
        name: 'Workspace Chat Stream',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-stream', {
        profileId: 'profile-chat-stream',
        sessionId: 'session-chat-stream',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-stream/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Stream protocol please', modelId: 'gpt-4o-mini' }),
      }))
      expect(runRes.status).toBe(200)

      const events = await collectSseEvents(runRes)
      const deltaEvents = events.filter(event => event.type === 'message_delta')

      expect(deltaEvents.length).toBeGreaterThan(0)
      expect(events.at(-1)?.type).toBe('run_completed')

      const seqs = deltaEvents.flatMap((event) => {
        const data = event.data as { deltas?: Array<{ seq: number }> }
        return (data.deltas ?? []).map(delta => delta.seq)
      })
      expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, index) => index))

      const messageIds = new Set(deltaEvents.map(event => (event.data as { messageId: string }).messageId))
      expect(messageIds.size).toBe(1)
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
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
    }
  })

  it('supports abort and returns structured input errors', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/chat/completions')) {
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Starting "},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"long reply"},"finish_reason":null}]}\n\n',
          'data: [DONE]\n\n',
        ], [0, 60, 60])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat',
        name: 'Workspace Chat',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat', {
        profileId: 'profile-chat-abort',
        sessionId: 'session-chat-abort',
      })

      const missingText = await app.handle(new Request('http://localhost/chat/sessions/session-chat-abort/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(missingText.status).toBe(400)
      expect((await missingText.json()).code).toBe('validation_error')

      const missingSession = await app.handle(new Request('http://localhost/chat/sessions/missing/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      }))
      expect(missingSession.status).toBe(404)
      expect((await missingSession.json()).code).toBe('chat_session_not_found')

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-abort/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Abort this run', modelId: 'gpt-4o-mini' }),
      }))
      expect(runRes.status).toBe(200)

      const abortRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-abort/cancel', {
        method: 'POST',
      }))
      expect(abortRes.status).toBe(200)
      expect(await abortRes.json()).toEqual({ ok: true })

      const rows = await waitForMessageStatus(app, 'session-chat-abort', 'aborted')
      expect(rows[1]).toEqual(expect.objectContaining({ role: 'assistant', status: 'aborted' }))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
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
    }
  })

  it('fails fast when a stored message snapshot is invalid instead of rebuilding from content', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-invalid-snapshot',
        name: 'Workspace Chat Invalid Snapshot',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-invalid-snapshot', {
        profileId: 'profile-chat-invalid-snapshot',
        sessionId: 'session-chat-invalid-snapshot',
      })

      db().insert(messages).values({
        id: 'message-invalid-snapshot',
        sessionId: 'session-chat-invalid-snapshot',
        parentMessageId: null,
        parentToolCallId: null,
        taskId: null,
        depth: 0,
        role: 'assistant',
        status: 'complete',
        content: 'fallback text must never hydrate UIMessage',
        messageJson: '{}',
        errorText: null,
        createdAt: 1700000000,
        updatedAt: 1700000000,
      }).run()

      const response = await app.handle(new Request('http://localhost/chat/sessions/session-chat-invalid-snapshot/messages'))
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual(expect.objectContaining({
        code: 'chat_message_snapshot_invalid',
        message: 'Stored chat message snapshot is invalid',
        details: expect.objectContaining({
          messageId: 'message-invalid-snapshot',
          reason: expect.stringContaining('UIMessage'),
        }),
      }))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
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
    }
  })
})
