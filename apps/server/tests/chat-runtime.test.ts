import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendRuns, backendSessionBindings, chatSessionQueueItems, messages, providerTargets, sessions, workspaces } from '@cradle/db'
import type { UIMessageChunk } from 'ai'
import { eq } from 'drizzle-orm'
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

interface ChatQueueItemView {
  id: string
  sessionId: string
  mode: 'queue' | 'steer'
  status: 'pending' | 'running' | 'cancelled' | 'completed' | 'failed'
  text: string
  providerTargetId: string | null
  position: number
  startedRunId: string | null
}

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

interface ChatCompletionRequestBody {
  messages: Array<{ role: string, content: string }>
}

function parseChatCompletionRequestBody(raw: BodyInit | null | undefined): ChatCompletionRequestBody {
  const payload = JSON.parse(String(raw)) as ChatCompletionRequestBody
  if (!Array.isArray(payload.messages)) {
    throw new TypeError('Expected OpenAI-compatible chat completion messages')
  }
  return payload
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function createProfileAndSession(
  app: ElysiaApp,
  workspaceId: string,
  ids: { providerTargetId: string, sessionId: string, providerKind?: 'openai-compatible' | 'anthropic', runtimeKind?: 'standard' | 'claude-agent' | 'codex' | 'jar-core' | 'acp-chat' },
) {
  const credentialRes = await app.handle(new Request('http://localhost/secrets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: ids.providerKind ?? 'openai-compatible',
      label: 'Chat Runtime Key',
      secret: 'sk-chat-runtime-test',
    }),
  }))
  const credential = await credentialRes.json() as { id: string }

  const targetRes = await app.handle(new Request(`http://localhost/provider-targets/${ids.providerTargetId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Chat Runtime Provider',
      providerKind: ids.providerKind ?? 'openai-compatible',
      enabled: true,
      connectionConfig: (ids.providerKind ?? 'openai-compatible') === 'anthropic'
        ? { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514' }
        : { baseUrl: 'https://example.com/v1', model: 'gpt-4o-mini' },
      credentialRef: credential.id,
    }),
  }))
  expect(targetRes.status).toBe(200)

  const sessionRes = await app.handle(new Request('http://localhost/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: ids.sessionId,
      workspaceId,
      title: 'Chat Runtime Session',
      providerTargetId: ids.providerTargetId,
      runtimeKind: ids.runtimeKind,
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

async function waitForCondition(assertion: () => void | Promise<void>, label: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await assertion()
      return
    }
    catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function listChatQueue(app: ElysiaApp, sessionId: string): Promise<ChatQueueItemView[]> {
  const response = await app.handle(new Request(`http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/queue`))
  expect(response.status).toBe(200)
  const body = await response.json() as { items: ChatQueueItemView[] }
  return body.items
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

async function collectSseChunks(response: Response): Promise<UIMessageChunk[]> {
  const payload = await response.text()
  return payload
    .split('\n\n')
    .map(block => block.trim())
    .filter(block => block.startsWith('data: '))
    .flatMap((block) => {
      const data = block
        .split('\n')
        .filter(line => line.startsWith('data: '))
        .map(line => line.slice('data: '.length))
        .join('\n')
      if (data === '[DONE]') {
        return []
      }
      return [JSON.parse(data) as UIMessageChunk]
    })
}

describe('chat runtime capability', () => {
  it('rejects runtime-incompatible provider combinations during session creation', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-incompatible',
        name: 'Workspace Chat Incompatible',
        path: workspaceRoot,
      }).run()

      const credentialRes = await app.handle(new Request('http://localhost/secrets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          label: 'OpenAI Key',
          secret: 'sk-openai-test',
        }),
      }))
      const credential = await credentialRes.json() as { id: string }

      const targetRes = await app.handle(new Request('http://localhost/provider-targets/provider-target-openai', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: 'OpenAI Provider',
          providerKind: 'openai-compatible',
          enabled: true,
          connectionConfig: { baseUrl: 'https://example.com/v1', model: 'gpt-4o-mini' },
          credentialRef: credential.id,
        }),
      }))
      expect(targetRes.status).toBe(200)

      const sessionRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'session-incompatible',
          workspaceId: 'workspace-chat-incompatible',
          title: 'Claude Session',
          providerTargetId: 'provider-target-openai',
          runtimeKind: 'claude-agent',
        }),
      }))

      expect(sessionRes.status).toBe(400)
      expect(await sessionRes.json()).toEqual(expect.objectContaining({
        code: 'invalid_session_input',
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
        const payload = parseChatCompletionRequestBody(init?.body)
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
        providerTargetId: 'provider-target-chat',
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
      const userMessage = rows.find(row => row.role === 'user')
      const assistantMessage = rows.find(row => row.role === 'assistant')
      expect(userMessage).toEqual(expect.objectContaining({ content: 'Explain server runtime', status: 'complete' }))
      expect(assistantMessage).toEqual(expect.objectContaining({ content: 'Hello from chat runtime', status: 'complete' }))
      expect(assistantMessage?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: 'Hello from chat runtime' }),
      ]))

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

  it('allows switching chat sessions to another compatible provider profile', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const payload = parseChatCompletionRequestBody(init?.body)
        expect(payload.messages.at(-1)).toEqual({ role: 'user', content: 'Switch provider please' })
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"Switched provider"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":6,"completion_tokens":2,"total_tokens":8}}\n\n',
          'data: [DONE]\n\n',
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-switch',
        name: 'Workspace Chat Switch',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-switch', {
        providerTargetId: 'provider-target-chat-primary',
        sessionId: 'session-chat-switch',
        providerKind: 'openai-compatible',
        runtimeKind: 'standard',
      })

      const secondaryCredentialRes = await app.handle(new Request('http://localhost/secrets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          label: 'Secondary Key',
          secret: 'sk-secondary-test',
        }),
      }))
      const secondaryCredential = await secondaryCredentialRes.json() as { id: string }

      const secondaryTargetRes = await app.handle(new Request('http://localhost/provider-targets/provider-target-chat-secondary', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Secondary OpenAI Provider',
          providerKind: 'openai-compatible',
          enabled: true,
          connectionConfig: { baseUrl: 'https://example.com/v1', model: 'gpt-4.1-mini' },
          credentialRef: secondaryCredential.id,
        }),
      }))
      expect(secondaryTargetRes.status).toBe(200)

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-switch/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Switch provider please',
          providerTargetId: 'provider-target-chat-secondary',
          modelId: 'gpt-4.1-mini',
        }),
      }))
      expect(runRes.status).toBe(200)

      const rows = await waitForMessageStatus(app, 'session-chat-switch', 'complete')
      expect(rows.find(row => row.role === 'assistant')?.content).toBe('Switched provider')

      const binding = db().select().from(backendSessionBindings).where(eq(backendSessionBindings.chatSessionId, 'session-chat-switch')).get()
      expect(binding?.providerTargetId).toBe('provider-target-chat-secondary')
      expect(binding?.requestedModelId).toBe('gpt-4.1-mini')

      const sessionRes = await app.handle(new Request('http://localhost/sessions/session-chat-switch'))
      expect(sessionRes.status).toBe(200)
      expect(await sessionRes.json()).toEqual(expect.objectContaining({
        providerTargetId: 'provider-target-chat-primary',
        modelId: 'gpt-4.1-mini',
      }))

      const queueRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-switch/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'queue',
          text: 'Queued on secondary profile',
          providerTargetId: 'provider-target-chat-secondary',
          modelId: 'gpt-4.1-mini',
        }),
      }))
      expect(queueRes.status).toBe(200)
      const queued = await queueRes.json() as ChatQueueItemView
      expect(queued.providerTargetId).toBe('provider-target-chat-secondary')
      expect(fetchSpy).toHaveBeenCalled()
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
        const payload = parseChatCompletionRequestBody(init?.body)
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
        providerTargetId: 'provider-target-chat-memory',
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
        payload.messages.at(-1)?.content === 'What should I remember about Project Nebula checkout?')
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

  it('streams AI SDK UIMessageChunk frames and ends with finish plus done marker', async () => {
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
        providerTargetId: 'provider-target-chat-stream',
        sessionId: 'session-chat-stream',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-stream/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Stream protocol please', modelId: 'gpt-4o-mini' }),
      }))
      expect(runRes.status).toBe(200)

      const chunks = await collectSseChunks(runRes)
      const chunkTypes = chunks.map(chunk => chunk.type)

      expect(chunkTypes).toEqual([
        'start',
        'start-step',
        'text-start',
        'text-delta',
        'text-delta',
        'text-end',
        'finish-step',
        'finish',
      ])
      expect(chunks[0]).toEqual(expect.objectContaining({ type: 'start' }))
      expect(chunks.at(-1)).toEqual(expect.objectContaining({ type: 'finish', finishReason: 'stop' }))
      expect(chunkTypes).toContain('text-delta')
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

  it('replays buffered AI SDK chunks when joining an active session stream', async () => {
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
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"joined stream"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-3","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ], [0, 80, 0, 0])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-replay',
        name: 'Workspace Chat Replay',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-replay', {
        providerTargetId: 'provider-target-chat-replay',
        sessionId: 'session-chat-replay',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-replay/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Replay active stream', modelId: 'gpt-4o-mini' }),
      }))
      expect(runRes.status).toBe(200)
      const runChunksPromise = collectSseChunks(runRes)

      await waitForCondition(async () => {
        const rows = await getChatMessages(app!, 'session-chat-replay')
        expect(rows.find(row => row.role === 'assistant')?.status).toBe('streaming')
      }, 'active assistant stream row')

      const joinRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-replay/stream'))
      expect(joinRes.status).toBe(200)

      const chunks = await collectSseChunks(joinRes)
      const textDeltas = chunks
        .filter((chunk): chunk is UIMessageChunk & { type: 'text-delta', delta: string } => chunk.type === 'text-delta')
        .map(chunk => chunk.delta)

      expect(chunks[0]).toEqual(expect.objectContaining({ type: 'start' }))
      expect(textDeltas.join('')).toBe('Hello joined stream')
      expect(chunks.at(-1)).toEqual(expect.objectContaining({ type: 'finish' }))

      await runChunksPromise
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
      vi.restoreAllMocks()
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
        providerTargetId: 'provider-target-chat-abort',
        sessionId: 'session-chat-abort',
      })

      const missingText = await app.handle(new Request('http://localhost/chat/sessions/session-chat-abort/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(missingText.status).toBe(400)
      expect((await missingText.json()).code).toBe('chat_message_empty')

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
      const assistantRow = rows.find(row => row.role === 'assistant')
      expect(assistantRow).toEqual(expect.objectContaining({ role: 'assistant', status: 'aborted' }))
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

  it('repairs persisted streaming state when message snapshots find no active run', async () => {
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
      db().insert(providerTargets).values({
        id: 'provider-target-chat-orphan',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Chat Runtime Provider',
        enabled: true,
        iconSlug: null,
        connectionConfigJson: JSON.stringify({ baseUrl: 'https://example.com/v1' }),
        credentialRef: null,
        enabledModelsJson: JSON.stringify(['gpt-4o-mini']),
        customModelsJson: JSON.stringify([]),
        sourceKey: null,
        externalRecordId: null,
        sourceFingerprint: null,
        createdAt: 1700000000,
        updatedAt: 1700000000,
      }).run()

      db().insert(sessions).values({
        id: 'session-chat-orphan',
        workspaceId: 'workspace-chat-orphan',
        title: 'Chat Runtime Session',
        providerTargetId: 'provider-target-chat-orphan',
        runtimeKind: 'standard',
        agentId: null,
        configJson: '{}',
        linkedIssueId: null,
        pinned: 0,
        createdAt: 1700000000,
        updatedAt: 1700000000,
      }).run()

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
        providerTargetId: 'provider-target-chat-orphan',
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
      db().insert(chatSessionQueueItems).values({
        id: 'queue-chat-orphan',
        sessionId: 'session-chat-orphan',
        mode: 'queue',
        status: 'running',
        text: 'orphan queued follow-up',
        filesJson: '[]',
        modelId: 'gpt-4o-mini',
        thinkingEffort: null,
        position: 1,
        sourceRunId: null,
        startedRunId: 'run-chat-orphan',
        errorText: null,
        createdAt: 1700000000,
        updatedAt: 1700000000,
      }).run()

      const rows = await getChatMessages(app, 'session-chat-orphan')
      expect(rows[0]).toEqual(expect.objectContaining({ role: 'assistant', status: 'aborted' }))

      const run = db().select().from(backendRuns).where(eq(backendRuns.id, 'run-chat-orphan')).get()
      expect(run).toEqual(expect.objectContaining({
        status: 'aborted',
        stopReason: 'response.cancelled',
        errorText: null,
      }))
      expect(run?.finishedAt).toEqual(expect.any(Number))

      const queueItem = db().select().from(chatSessionQueueItems).where(eq(chatSessionQueueItems.id, 'queue-chat-orphan')).get()
      expect(queueItem).toEqual(expect.objectContaining({
        status: 'cancelled',
        errorText: null,
        startedRunId: 'run-chat-orphan',
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

  it('queues chat session continuations, supports reorder and cancel, and drains after the active run', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const encoder = new TextEncoder()
    const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = []
    const completionBodies: string[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const payload = parseChatCompletionRequestBody(init?.body)
        completionBodies.push(payload.messages.at(-1)?.content ?? '')
        const callIndex = completionBodies.length - 1
        return new Response(new ReadableStream({
          start(controller) {
            streamControllers[callIndex] = controller
            controller.enqueue(encoder.encode(`data: {"id":"queue-${callIndex}-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"run ${callIndex + 1}"},"finish_reason":null}]}\n\n`))
          },
        }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-queue',
        name: 'Workspace Chat Queue',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-queue', {
        providerTargetId: 'provider-target-chat-queue',
        sessionId: 'session-chat-queue',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-queue/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Start long task', modelId: 'gpt-4o-mini' }),
      }))
      expect(runRes.status).toBe(200)
      await waitForCondition(() => expect(completionBodies).toEqual(['Start long task']), 'initial chat run to start')

      const queueARes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-queue/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'queue', text: 'Queued follow-up A', modelId: 'gpt-4o-mini' }),
      }))
      expect(queueARes.status).toBe(200)
      const queueA = await queueARes.json() as ChatQueueItemView
      expect(queueA).toEqual(expect.objectContaining({ mode: 'queue', status: 'pending', text: 'Queued follow-up A' }))

      const queueBRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-queue/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'queue', text: 'Queued follow-up B', modelId: 'gpt-4o-mini' }),
      }))
      expect(queueBRes.status).toBe(200)
      const queueB = await queueBRes.json() as ChatQueueItemView

      const steerRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-queue/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'steer', text: 'Steer next run', modelId: 'gpt-4o-mini' }),
      }))
      expect(steerRes.status).toBe(200)
      const steer = await steerRes.json() as ChatQueueItemView

      let visibleQueue = await listChatQueue(app, 'session-chat-queue')
      expect(visibleQueue.filter(item => item.status === 'pending').map(item => item.id)).toEqual([queueA.id, queueB.id, steer.id])

      const reorderRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-queue/queue/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queueItemIds: [queueB.id, steer.id, queueA.id] }),
      }))
      expect(reorderRes.status).toBe(200)
      visibleQueue = await listChatQueue(app, 'session-chat-queue')
      expect(visibleQueue.filter(item => item.status === 'pending').map(item => item.id)).toEqual([queueB.id, steer.id, queueA.id])

      const cancelRes = await app.handle(new Request(`http://localhost/chat/sessions/session-chat-queue/queue/${encodeURIComponent(queueA.id)}`, {
        method: 'DELETE',
      }))
      expect(cancelRes.status).toBe(200)
      expect(await cancelRes.json()).toEqual(expect.objectContaining({ id: queueA.id, status: 'cancelled' }))

      streamControllers[0].enqueue(encoder.encode('data: {"id":"queue-0-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\n'))
      streamControllers[0].enqueue(encoder.encode('data: [DONE]\n\n'))
      streamControllers[0].close()

      await waitForCondition(() => expect(completionBodies).toEqual(['Start long task', 'Steer next run']), 'steer item to drain before queue items')
      streamControllers[1].enqueue(encoder.encode('data: {"id":"queue-1-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\n'))
      streamControllers[1].enqueue(encoder.encode('data: [DONE]\n\n'))
      streamControllers[1].close()

      await waitForCondition(() => expect(completionBodies).toEqual(['Start long task', 'Steer next run', 'Queued follow-up B']), 'queued item to drain after steer')
      streamControllers[2].enqueue(encoder.encode('data: {"id":"queue-2-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\n'))
      streamControllers[2].enqueue(encoder.encode('data: [DONE]\n\n'))
      streamControllers[2].close()

      await waitForCondition(async () => {
        const items = await listChatQueue(app!, 'session-chat-queue')
        expect(items.find(item => item.id === steer.id)).toEqual(expect.objectContaining({ status: 'completed' }))
        expect(items.find(item => item.id === queueB.id)).toEqual(expect.objectContaining({ status: 'completed' }))
        expect(items.find(item => item.id === queueA.id)).toEqual(expect.objectContaining({ status: 'cancelled' }))
      }, 'queue items to reach terminal states')

      const rows = await getChatMessages(app, 'session-chat-queue')
      expect(rows.filter(row => row.role === 'user').map(row => row.content)).toEqual(expect.arrayContaining([
        'Start long task',
        'Steer next run',
        'Queued follow-up B',
      ]))
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
        providerTargetId: 'provider-target-chat-invalid-snapshot',
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
          reason: expect.any(String),
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
