import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendRuns, backendSessionBindings, messages, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

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

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

const ChatStreamEventJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    type: z.string(),
    data: z.record(z.string(), z.unknown()),
  }))

const ChatCompletionRequestBodyJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    messages: z.array(z.object({
      role: z.string(),
      content: z.string(),
    })),
  }))

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
  let latestGroups: ChatMessageRow[] = []
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.handle(new Request(`http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/messages`))
    if (response.status === 200) {
      const groups = await response.json() as ChatMessageRow[]
      latestGroups = groups
      const assistant = groups.find(group => group.role === 'assistant')
      if (assistant?.status === expectedStatus) {
        return groups
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  throw new Error(`Timed out waiting for assistant status ${expectedStatus}; latest=${JSON.stringify(latestGroups)}`)
}

async function getChatMessages(app: ElysiaApp, sessionId: string): Promise<ChatMessageRow[]> {
  const response = await app.handle(new Request(`http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/messages`))
  expect(response.status).toBe(200)
  return await response.json() as ChatMessageRow[]
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
      return ChatStreamEventJsonSchema.parse(data)
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
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        expect(init?.method).toBe('POST')
        const payload = ChatCompletionRequestBodyJsonSchema.parse(String(init?.body))
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

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
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

  it('injects relevant Chronicle long-term memory into chat runtime system context', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'
    const chatCompletionPayloads: Array<{
      messages: Array<{ role: string, content: string }>
    }> = []

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        expect(init?.method).toBe('POST')
        const payload = ChatCompletionRequestBodyJsonSchema.parse(String(init?.body))
        chatCompletionPayloads.push(payload)
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Use Stripe Checkout."},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":21,"completion_tokens":4,"total_tokens":25}}\n\n',
          'data: [DONE]\n\n',
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-memory',
        name: 'Workspace Chat Memory',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-memory', {
        profileId: 'profile-chat-memory',
        sessionId: 'session-chat-memory',
      })

      const memoryRes = await app.handle(new Request('http://localhost/chronicle/memories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'chat-memory-project-nebula',
          windowType: '10min',
          createdAt: '2026-05-21T10:04:00Z',
          content: 'Project Nebula checkout decision: Remember that Project Nebula uses Stripe Checkout and contact alice@example.com only through approved support channels.',
          summaryKind: 'imported',
          sourceSnapshotPaths: [],
          sourceFramePaths: [],
          metadata: { source: 'test' },
        }),
      }))
      expect(memoryRes.status).toBe(200)

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-memory/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'What should I remember about Project Nebula checkout?',
          modelId: 'gpt-4o-mini',
        }),
      }))
      expect(runRes.status).toBe(200)

      const rows = await waitForMessageStatus(app, 'session-chat-memory', 'complete')
      expect(rows.find(row => row.role === 'assistant')?.content).toBe('Use Stripe Checkout.')
      const turnPayload = chatCompletionPayloads.find(payload =>
        payload.messages.at(-1)?.content === 'What should I remember about Project Nebula checkout?',
      )
      expect(turnPayload).toBeTruthy()
      const systemMessage = turnPayload?.messages.find(message => message.role === 'system')
      expect(systemMessage?.content).toContain('Chronicle long-term memory context follows')
      expect(systemMessage?.content).toContain('Project Nebula checkout decision')
      expect(systemMessage?.content).toContain('Remember that Project Nebula uses Stripe Checkout')
      expect(systemMessage?.content).toContain('[EMAIL]')
      expect(systemMessage?.content).not.toContain('alice@example.com')
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions')).length).toBeGreaterThanOrEqual(1)
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
      fetchSpy.mockRestore()
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
      const url = new Request(input).url
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

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
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
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Starting "},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"long reply"},"finish_reason":null}]}\n\n',
          'data: [DONE]\n\n',
        ], [0, 60, 60])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
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

      const rows = await getChatMessages(app, 'session-chat-abort')
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

  it('cancels persisted streaming state when the in-memory active run is missing', async () => {
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

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-orphan',
        name: 'Workspace Chat Orphan',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-orphan', {
        profileId: 'profile-chat-orphan',
        sessionId: 'session-chat-orphan',
      })

      db().insert(messages).values({
        id: 'message-orphan-assistant',
        sessionId: 'session-chat-orphan',
        parentMessageId: null,
        parentToolCallId: null,
        taskId: null,
        depth: 0,
        role: 'assistant',
        status: 'streaming',
        content: 'partial response',
        messageJson: JSON.stringify({
          id: 'message-orphan-assistant',
          role: 'assistant',
          parts: [{ type: 'text', text: 'partial response' }],
        }),
        errorText: null,
        createdAt: 1700000000,
        updatedAt: 1700000000,
      }).run()
      db().insert(backendSessionBindings).values({
        id: 'binding-chat-orphan',
        chatSessionId: 'session-chat-orphan',
        agentProfileId: 'profile-chat-orphan',
        runtimeKind: 'standard',
        backendSessionId: null,
        backendStateSnapshot: null,
        requestedModelId: 'gpt-4o-mini',
        createdAt: 1700000000,
        updatedAt: 1700000000,
      }).run()
      db().insert(backendRuns).values({
        id: 'run-chat-orphan',
        bindingId: 'binding-chat-orphan',
        chatSessionId: 'session-chat-orphan',
        messageId: 'message-orphan-assistant',
        origin: 'user',
        status: 'streaming',
        stopReason: null,
        errorText: null,
        startedAt: 1700000000,
        finishedAt: null,
      }).run()

      const cancelRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-orphan/cancel', {
        method: 'POST',
      }))
      expect(cancelRes.status).toBe(200)
      expect(await cancelRes.json()).toEqual({ ok: true })

      const rows = await getChatMessages(app, 'session-chat-orphan')
      expect(rows[0]).toEqual(expect.objectContaining({ role: 'assistant', status: 'aborted' }))

      const run = db().select().from(backendRuns).where(eq(backendRuns.id, 'run-chat-orphan')).get()
      expect(run).toEqual(expect.objectContaining({
        status: 'aborted',
        stopReason: 'response.cancelled',
        errorText: null,
      }))
      expect(run?.finishedAt).toEqual(expect.any(Number))
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

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
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
