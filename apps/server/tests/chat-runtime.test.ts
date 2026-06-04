import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendRuns, backendSessionBindings, chatSessionQueueItems, messages, providerTargets, sessions, workspaces } from '@cradle/db'
import type { UIMessage, UIMessageChunk } from 'ai'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { getRuntimeRegistry, registerRuntime } from '../src/modules/chat-runtime/chat-runtime-provider-registry'
import { getActiveRunReplayBufferSummary } from '../src/modules/chat-runtime/service'
import type { ChatRuntime, ResumeChatSessionInput, RuntimeSession, StartChatSessionInput, StreamTurnInput } from '../src/modules/chat-runtime/runtime-provider-types'

interface ChatMessageRow {
  messageId: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText?: string
  content: string
  parentToolCallId?: string | null
  message: { parts: Array<{ type: string, text?: string, [key: string]: unknown }>, metadata?: Record<string, unknown> }
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

async function waitForCondition<T>(assertion: () => T | Promise<T>, label: string): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return await assertion()
    }
    catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function waitForBackendRunStatus(
  sessionId: string,
  expectedStatus: 'streaming' | 'complete' | 'aborted' | 'failed',
): Promise<typeof backendRuns.$inferSelect> {
  return await waitForCondition(() => {
    const run = db()
      .select()
      .from(backendRuns)
      .where(eq(backendRuns.chatSessionId, sessionId))
      .get()
    expect(run?.status).toBe(expectedStatus)
    return run!
  }, `${sessionId} backend run ${expectedStatus}`)
}

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
  }
  else {
    process.env[name] = previousValue
  }
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

class TestCodexGoalContinuationRuntime implements ChatRuntime {
  readonly runtimeKind = 'codex' as const
  readonly streamInputs: StreamTurnInput[] = []

  constructor(private readonly options: { failFirstRun?: boolean } = {}) {}

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: 'profile-codex-goal-auto',
      runtimeKind: 'codex',
      providerSessionId: 'codex-thread-goal-auto',
      providerStateSnapshot: input.previousProviderStateSnapshot ?? JSON.stringify({
        models: { currentModelId: null },
        codex: {
          goal: {
            threadId: 'codex-thread-goal-auto',
            objective: 'Keep going',
            status: 'active',
            tokenBudget: null,
            tokensUsed: 0,
            timeUsedSeconds: 0,
            createdAt: 1,
            updatedAt: 2,
          },
        },
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    this.streamInputs.push(input)
    if (this.options.failFirstRun && this.streamInputs.length === 1) {
      throw new Error('exceeded retry limit, last status: 429 Too Many Requests')
    }

    input.runtimeSession.providerStateSnapshot = JSON.stringify({
      models: { currentModelId: null },
      codex: {
        goal: {
          threadId: 'codex-thread-goal-auto',
          objective: 'Keep going',
          status: 'complete',
          tokenBudget: null,
          tokensUsed: 1,
          timeUsedSeconds: 1,
          createdAt: 1,
          updatedAt: 3,
        },
      },
    })
    yield { type: 'text-start', id: 'continuation-text' }
    yield { type: 'text-delta', id: 'continuation-text', delta: 'Goal continued' }
    yield { type: 'text-end', id: 'continuation-text' }
    yield { type: 'finish', finishReason: 'stop' }
  }

  async cancelTurn(): Promise<void> {}
}

describe('chat runtime capability', () => {
  it('serves provider-owned draft runtime capabilities before a session exists', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const response = await app.handle(new Request('http://localhost/chat/draft-runtime-capabilities?runtimeKind=codex'))
      expect(response.status).toBe(200)

      const body = await response.json() as {
        runtimeKind: string
        slashCommands: unknown[]
        skills: unknown[]
        uiSlots: Array<{ id: string, name: string, surfaces: string[] }>
      }
      expect(body.runtimeKind).toBe('codex')
      expect(body.slashCommands).toEqual([])
      expect(body.skills).toEqual([])
      expect(body.uiSlots).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'codex:goal', name: 'goal', surfaces: ['slashCommand', 'composerState', 'runtimePanel'] }),
        expect.objectContaining({ id: 'codex:compact', name: 'compact', surfaces: ['slashCommand', 'runtimePanel'] }),
        expect.objectContaining({ id: 'codex:review', name: 'review', surfaces: ['slashCommand'] }),
      ]))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

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

  it('keeps chat history and queue readable after deleting the provider target', async () => {
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
        id: 'workspace-chat-provider-deleted',
        name: 'Workspace Chat Provider Deleted',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-provider-deleted', {
        providerTargetId: 'provider-target-chat-deleted',
        sessionId: 'session-chat-provider-deleted',
      })

      const now = Math.floor(Date.now() / 1000)
      const userMessage: UIMessage = {
        id: 'message-provider-deleted-user',
        role: 'user',
        parts: [{ type: 'text', text: 'Keep this history readable.' }],
      }
      const assistantMessage: UIMessage = {
        id: 'message-provider-deleted-assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: 'History remains available.' }],
      }

      db().insert(messages).values([
        {
          id: userMessage.id,
          sessionId: 'session-chat-provider-deleted',
          role: 'user',
          status: 'complete',
          content: 'Keep this history readable.',
          messageJson: JSON.stringify(userMessage),
          createdAt: now,
          updatedAt: now,
        },
        {
          id: assistantMessage.id,
          sessionId: 'session-chat-provider-deleted',
          role: 'assistant',
          status: 'complete',
          content: 'History remains available.',
          messageJson: JSON.stringify(assistantMessage),
          createdAt: now + 1,
          updatedAt: now + 1,
        },
      ]).run()
      db().insert(chatSessionQueueItems).values({
        id: 'queue-provider-deleted',
        sessionId: 'session-chat-provider-deleted',
        mode: 'queue',
        status: 'pending',
        text: 'Queued before provider deletion.',
        providerTargetId: 'provider-target-chat-deleted',
        position: 1,
        createdAt: now,
        updatedAt: now,
      }).run()

      const deleteRes = await app.handle(new Request('http://localhost/provider-targets/provider-target-chat-deleted', {
        method: 'DELETE',
      }))
      expect(deleteRes.status).toBe(200)

      const session = db().select().from(sessions).where(eq(sessions.id, 'session-chat-provider-deleted')).get()
      expect(session?.providerTargetId).toBeNull()

      const messagesRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-provider-deleted/messages'))
      expect(messagesRes.status).toBe(200)
      const messageRows = await messagesRes.json() as ChatMessageRow[]
      expect(messageRows).toEqual([
        expect.objectContaining({ messageId: userMessage.id, content: 'Keep this history readable.' }),
        expect.objectContaining({ messageId: assistantMessage.id, content: 'History remains available.' }),
      ])

      const queueRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-provider-deleted/queue'))
      expect(queueRes.status).toBe(200)
      expect(await queueRes.json()).toEqual({
        items: [
          expect.objectContaining({
            id: 'queue-provider-deleted',
            providerTargetId: null,
            text: 'Queued before provider deletion.',
          }),
        ],
      })

      const capabilitiesRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-provider-deleted/capabilities'))
      expect(capabilitiesRes.status).toBe(200)
      expect(await capabilitiesRes.json()).toEqual({
        runtimeKind: 'standard',
        slashCommands: [],
        uiSlots: [],
        skills: [],
      })
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

  it('builds provider turn history from bounded content instead of parsing large stored snapshots', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousMaxMessages = process.env.CRADLE_CHAT_TURN_CONTEXT_MAX_MESSAGES
    const previousMaxChars = process.env.CRADLE_CHAT_TURN_CONTEXT_MAX_CHARS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'
    process.env.CRADLE_CHAT_TURN_CONTEXT_MAX_MESSAGES = '2'
    process.env.CRADLE_CHAT_TURN_CONTEXT_MAX_CHARS = '80'
    const completionPayloads: ChatCompletionRequestBody[] = []

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const payload = parseChatCompletionRequestBody(init?.body)
        completionPayloads.push(payload)
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"bounded"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":1,"total_tokens":8}}\n\n',
          'data: [DONE]\n\n',
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-bounded-history',
        name: 'Workspace Chat Bounded History',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-bounded-history', {
        providerTargetId: 'provider-target-chat-bounded-history',
        sessionId: 'session-chat-bounded-history',
      })

      const hugeSnapshot = JSON.stringify({
        id: 'message-bounded-history-old',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'x'.repeat(250_000) },
          { type: 'text', text: 'Old large snapshot text should not be parsed.' },
        ],
      })
      db().insert(messages).values([
        {
          id: 'message-bounded-history-old',
          sessionId: 'session-chat-bounded-history',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'complete',
          content: 'Old content outside the bounded message window.',
          messageJson: hugeSnapshot,
          errorText: null,
          createdAt: 1700000000,
          updatedAt: 1700000000,
        },
        {
          id: 'message-bounded-history-user',
          sessionId: 'session-chat-bounded-history',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: 'Recent user content from row cache.',
          messageJson: '{',
          errorText: null,
          createdAt: 1700000001,
          updatedAt: 1700000001,
        },
        {
          id: 'message-bounded-history-assistant',
          sessionId: 'session-chat-bounded-history',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'complete',
          content: 'Recent assistant content from row cache.',
          messageJson: '{',
          errorText: null,
          createdAt: 1700000002,
          updatedAt: 1700000002,
        },
      ]).run()

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-bounded-history/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Use bounded history now.', modelId: 'gpt-4o-mini' }),
      }))
      expect(runRes.status).toBe(200)
      await waitForBackendRunStatus('session-chat-bounded-history', 'complete')

      const payload = completionPayloads[0]
      expect(payload?.messages.slice(-3)).toEqual([
        { role: 'user', content: 'Recent user content from row cache.' },
        { role: 'assistant', content: 'Recent assistant content from row cache.' },
        { role: 'user', content: 'Use bounded history now.' },
      ])
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
      restoreEnv('CRADLE_CHAT_TURN_CONTEXT_MAX_MESSAGES', previousMaxMessages)
      restoreEnv('CRADLE_CHAT_TURN_CONTEXT_MAX_CHARS', previousMaxChars)
      fetchSpy.mockRestore()
    }
  })

  it('repairs oversized stored snapshots after message hydration', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousRepairMin = process.env.CRADLE_CHAT_STORED_MESSAGE_REPAIR_MIN_CHARS
    const previousTextLimit = process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'
    process.env.CRADLE_CHAT_STORED_MESSAGE_REPAIR_MIN_CHARS = '1'
    process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS = '24'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-repair-snapshot',
        name: 'Workspace Chat Repair Snapshot',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-repair-snapshot', {
        providerTargetId: 'provider-target-chat-repair-snapshot',
        sessionId: 'session-chat-repair-snapshot',
      })

      const originalSnapshot = JSON.stringify({
        id: 'message-repair-snapshot-assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: `oversized assistant text ${'x'.repeat(2_000)}` }],
      })
      db().insert(messages).values({
        id: 'message-repair-snapshot-assistant',
        sessionId: 'session-chat-repair-snapshot',
        parentMessageId: null,
        parentToolCallId: null,
        taskId: null,
        depth: 0,
        role: 'assistant',
        status: 'complete',
        content: `oversized assistant text ${'x'.repeat(2_000)}`,
        messageJson: originalSnapshot,
        errorText: null,
        createdAt: 1700000000,
        updatedAt: 1700000000,
      }).run()

      const messageRows = await getChatMessages(app, 'session-chat-repair-snapshot')
      expect(messageRows[0]?.message.parts.find(part => part.type === 'text')?.text).toBe('oversized assistant text')

      const repairedRow = db()
        .select()
        .from(messages)
        .where(eq(messages.id, 'message-repair-snapshot-assistant'))
        .get()
      expect(repairedRow?.messageJson.length).toBeLessThan(originalSnapshot.length)
      expect(repairedRow?.content).toBe('oversized assistant text')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
      restoreEnv('CRADLE_CHAT_STORED_MESSAGE_REPAIR_MIN_CHARS', previousRepairMin)
      restoreEnv('CRADLE_CHAT_STORED_TEXT_MAX_CHARS', previousTextLimit)
      vi.restoreAllMocks()
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

      expect(chunkTypes).toEqual(expect.arrayContaining([
        'start',
        'start-step',
        'text-start',
        'text-delta',
        'text-end',
        'finish-step',
        'finish',
      ]))
      expect(chunks[0]).toEqual(expect.objectContaining({ type: 'start' }))
      expect(chunks.at(-1)).toEqual(expect.objectContaining({ type: 'finish', finishReason: 'stop' }))
      expect(chunks
        .filter((chunk): chunk is UIMessageChunk & { type: 'text-delta', delta: string } => chunk.type === 'text-delta')
        .map(chunk => chunk.delta)
        .join('')).toBe('Hello stream protocol')
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

  it('preserves UIMessage metadata when hydrating stored message snapshots', async () => {
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
        id: 'workspace-chat-message-metadata',
        name: 'Workspace Chat Message Metadata',
        path: workspaceRoot,
      }).run()
      db().insert(sessions).values({
        id: 'session-chat-message-metadata',
        workspaceId: 'workspace-chat-message-metadata',
        title: 'Chat Message Metadata',
        providerTargetId: null,
        runtimeKind: 'codex',
        agentId: null,
        configJson: '{}',
        linkedIssueId: null,
      }).run()

      db().insert(messages).values({
        id: 'message-bang-command-metadata',
        sessionId: 'session-chat-message-metadata',
        parentMessageId: null,
        parentToolCallId: null,
        taskId: null,
        depth: 0,
        role: 'user',
        status: 'complete',
        content: '!echo hello',
        messageJson: JSON.stringify({
          id: 'message-bang-command-metadata',
          role: 'user',
          parts: [{ type: 'text', text: '!echo hello' }],
          metadata: {
            cradle: {
              bangCommand: { command: 'echo hello' },
            },
          },
        } satisfies UIMessage),
        errorText: null,
        createdAt: 1700000000,
        updatedAt: 1700000000,
      }).run()

      const response = await app.handle(new Request('http://localhost/chat/sessions/session-chat-message-metadata/messages'))
      expect(response.status).toBe(200)
      const rows = await response.json() as ChatMessageRow[]
      expect(rows).toHaveLength(1)
      expect(rows[0].message.metadata).toEqual({
        cradle: {
          bangCommand: { command: 'echo hello' },
        },
      })
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

  it('coalesces high-frequency replay deltas for active session stream joins', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const chunks = Array.from({ length: 80 }, (_, index) =>
          `data: {"id":"chunk-${index}","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"${index} "},"finish_reason":null}]}\n\n`,
        )
        return buildSseResponse([
          ...chunks,
          'data: {"id":"chunk-final","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ], [0, ...Array.from({ length: 80 }, () => 1), 0])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-coalesced-replay',
        name: 'Workspace Chat Coalesced Replay',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-coalesced-replay', {
        providerTargetId: 'provider-target-chat-coalesced-replay',
        sessionId: 'session-chat-coalesced-replay',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-coalesced-replay/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Replay many deltas', modelId: 'gpt-4o-mini' }),
      }))
      expect(runRes.status).toBe(200)
      const runChunksPromise = collectSseChunks(runRes)

      await waitForCondition(async () => {
        const rows = await getChatMessages(app!, 'session-chat-coalesced-replay')
        expect(rows.find(row => row.role === 'assistant')?.status).toBe('streaming')
      }, 'active assistant stream row')

      const activeRun = await waitForCondition(async () => {
        const run = db().select().from(backendRuns).where(eq(backendRuns.chatSessionId, 'session-chat-coalesced-replay')).get()
        const summary = run ? getActiveRunReplayBufferSummary(run.id) : null
        expect(summary?.textDeltaCount).toBe(1)
        return summary
      }, 'coalesced replay buffer')

      expect(activeRun?.chunkCount).toBeLessThan(10)
      expect(activeRun?.textDeltaCount).toBe(1)

      const runChunks = await runChunksPromise
      const runTextDeltas = runChunks.filter(chunk => chunk.type === 'text-delta')
      expect(runTextDeltas.length).toBeLessThan(20)
      const rows = await waitForMessageStatus(app, 'session-chat-coalesced-replay', 'complete')
      const expectedText = Array.from({ length: 80 }, (_, index) => `${index} `).join('')
      expect(runTextDeltas.map((chunk) => {
        if (chunk.type === 'text-delta') {
          return chunk.delta
        }
        return ''
      }).join('')).toBe(expectedText)
      expect(rows.find(row => row.role === 'assistant')?.content).toBe(expectedText)
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

  it('segments replay delta coalescing before strings grow too large', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousFlushChars = process.env.CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'
    process.env.CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS = '16'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const chunks = Array.from({ length: 80 }, (_, index) =>
          `data: {"id":"chunk-${index}","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"abcd"},"finish_reason":null}]}\n\n`,
        )
        return buildSseResponse([
          ...chunks,
          'data: {"id":"chunk-final","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ], [0, ...Array.from({ length: 80 }, () => 5), 0])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-segmented-replay',
        name: 'Workspace Chat Segmented Replay',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-segmented-replay', {
        providerTargetId: 'provider-target-chat-segmented-replay',
        sessionId: 'session-chat-segmented-replay',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-segmented-replay/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Segment replay deltas', modelId: 'gpt-4o-mini' }),
      }))
      expect(runRes.status).toBe(200)
      const runChunksPromise = collectSseChunks(runRes)

      await waitForCondition(async () => {
        const rows = await getChatMessages(app!, 'session-chat-segmented-replay')
        expect(rows.find(row => row.role === 'assistant')?.status).toBe('streaming')
      }, 'active segmented replay row')

      const activeRun = await waitForCondition(async () => {
        const run = db().select().from(backendRuns).where(eq(backendRuns.chatSessionId, 'session-chat-segmented-replay')).get()
        const summary = run ? getActiveRunReplayBufferSummary(run.id) : null
        expect(summary?.textDeltaCount).toBeGreaterThan(1)
        expect(summary?.maxDeltaChars).toBeLessThanOrEqual(16)
        return summary
      }, 'segmented replay buffer')

      expect(activeRun?.textDeltaCount).toBeLessThanOrEqual(80)
      expect(activeRun?.maxDeltaChars).toBeLessThanOrEqual(16)

      const runChunks = await runChunksPromise
      const textDeltas = runChunks.filter((chunk): chunk is UIMessageChunk & { type: 'text-delta', delta: string } => chunk.type === 'text-delta')
      expect(textDeltas.every(chunk => chunk.delta.length <= 16)).toBe(true)
      expect(textDeltas.map(chunk => chunk.delta).join('')).toBe('abcd'.repeat(80))
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
      restoreEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS', previousFlushChars)
      vi.restoreAllMocks()
    }
  })

  it('keeps replay buffers bounded across concurrent active session streams', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const chunks = Array.from({ length: 120 }, (_, index) =>
          `data: {"id":"chunk-${index}","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"${index} "},"finish_reason":null}]}\n\n`,
        )
        return buildSseResponse([
          ...chunks,
          'data: {"id":"chunk-final","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ], [0, ...Array.from({ length: 120 }, () => 1), 0])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-concurrent-replay',
        name: 'Workspace Chat Concurrent Replay',
        path: workspaceRoot,
      }).run()

      const sessionIds = ['session-chat-concurrent-1', 'session-chat-concurrent-2', 'session-chat-concurrent-3']
      for (const sessionId of sessionIds) {
        await createProfileAndSession(app, 'workspace-chat-concurrent-replay', {
          providerTargetId: `provider-target-${sessionId}`,
          sessionId,
        })
      }

      const responses = await Promise.all(sessionIds.map(sessionId =>
        app!.handle(new Request(`http://localhost/chat/sessions/${sessionId}/response`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Concurrent replay pressure', modelId: 'gpt-4o-mini' }),
        })),
      ))
      for (const response of responses) {
        expect(response.status).toBe(200)
      }
      const responseChunkPromises = responses.map(response => collectSseChunks(response))

      await waitForCondition(async () => {
        const runs = db().select().from(backendRuns).all()
        expect(runs.filter(run => sessionIds.includes(run.chatSessionId)).length).toBe(3)

        for (const run of runs.filter(run => sessionIds.includes(run.chatSessionId))) {
          const summary = getActiveRunReplayBufferSummary(run.id)
          expect(summary?.textDeltaCount).toBe(1)
          expect(summary?.chunkCount).toBeLessThan(10)
        }
      }, 'bounded concurrent replay buffers')

      const responseChunks = await Promise.all(responseChunkPromises)
      for (const chunks of responseChunks) {
        expect(chunks.filter(chunk => chunk.type === 'text-delta').length).toBeLessThan(30)
      }
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

  it('compacts oversized assistant snapshots before persistence', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousTextLimit = process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'
    process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS = '20'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        return buildSseResponse([
          'data: {"id":"chunk-text","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"assistant text that should be compacted"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-final","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":4,"total_tokens":8}}\n\n',
          'data: [DONE]\n\n',
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-chat-compact-snapshot',
        name: 'Workspace Chat Compact Snapshot',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-chat-compact-snapshot', {
        providerTargetId: 'provider-target-chat-compact-snapshot',
        sessionId: 'session-chat-compact-snapshot',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-chat-compact-snapshot/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Compact final snapshot.', modelId: 'gpt-4o-mini' }),
      }))
      expect(runRes.status).toBe(200)
      await waitForMessageStatus(app, 'session-chat-compact-snapshot', 'complete')

      const assistantRow = db()
        .select()
        .from(messages)
        .where(eq(messages.sessionId, 'session-chat-compact-snapshot'))
        .all()
        .find(row => row.role === 'assistant')
      const storedMessage = JSON.parse(assistantRow?.messageJson ?? '{}') as {
        parts: Array<{ type: string, text?: string }>
      }
      expect(storedMessage.parts.find(part => part.type === 'text')?.text).toHaveLength(20)
      expect(assistantRow?.content).toBe('assistant text that ')
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
      restoreEnv('CRADLE_CHAT_STORED_TEXT_MAX_CHARS', previousTextLimit)
      vi.restoreAllMocks()
    }
  })

  it('starts a new system run and assistant message when an active Codex goal fails without user cancellation', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexGoalContinuationRuntime({ failFirstRun: true })
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db().insert(workspaces).values({
        id: 'workspace-codex-goal-auto',
        name: 'Workspace Codex Goal Auto',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-codex-goal-auto', {
        providerTargetId: 'provider-target-codex-goal-auto',
        sessionId: 'session-codex-goal-auto',
        runtimeKind: 'codex',
      })

      const response = await app.handle(new Request('http://localhost/chat/sessions/session-codex-goal-auto/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Start the active goal.' }),
      }))
      expect(response.status).toBe(200)
      await collectSseChunks(response)

      const continuationRun = await waitForCondition(() => {
        const runs = db()
          .select()
          .from(backendRuns)
          .where(eq(backendRuns.chatSessionId, 'session-codex-goal-auto'))
          .all()
          .sort((left, right) => left.startedAt - right.startedAt)
        expect(runs).toHaveLength(2)
        expect(runs[0]).toEqual(expect.objectContaining({ origin: 'user', status: 'failed' }))
        expect(runs[1]).toEqual(expect.objectContaining({ origin: 'system', status: 'complete' }))
        return runs[1]
      }, 'Codex goal continuation system run')

      expect(runtime.streamInputs).toHaveLength(2)
      expect(runtime.streamInputs[0]?.message).toEqual(expect.objectContaining({
        role: 'user',
        parts: expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Start the active goal.' })]),
      }))
      expect(runtime.streamInputs[1]?.runId).toBe(continuationRun.id)
      expect(runtime.streamInputs[1]?.responseMessageId).toBe(continuationRun.messageId)
      expect(runtime.streamInputs[1]?.message).toEqual(expect.objectContaining({
        role: 'user',
        metadata: {
          cradle: {
            codex: { goalContinuation: true },
          },
        },
      }))

      const messageRows = db()
        .select()
        .from(messages)
        .where(eq(messages.sessionId, 'session-codex-goal-auto'))
        .all()
      const visibleUserRows = messageRows.filter(row => row.role === 'user')
      const assistantRows = messageRows.filter(row => row.role === 'assistant')
      expect(visibleUserRows).toHaveLength(1)
      expect(assistantRows).toHaveLength(2)
      expect(assistantRows.find(row => row.id === continuationRun.messageId)).toEqual(expect.objectContaining({
        status: 'complete',
        content: 'Goal continued',
      }))

      const statusResponse = await app.handle(new Request('http://localhost/chat/sessions/session-codex-goal-auto/runtime-status'))
      expect(statusResponse.status).toBe(200)
      expect(await statusResponse.json()).toEqual(expect.objectContaining({
        status: 'idle',
        hasActiveGoal: false,
        latestRun: expect.objectContaining({
          runId: continuationRun.id,
          messageId: continuationRun.messageId,
          status: 'complete',
        }),
      }))
    }
    finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
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

  it('wakes an idle failed Codex goal from runtime status polling without a new user message', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexGoalContinuationRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db().insert(workspaces).values({
        id: 'workspace-codex-goal-status-wake',
        name: 'Workspace Codex Goal Status Wake',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, 'workspace-codex-goal-status-wake', {
        providerTargetId: 'provider-target-codex-goal-status-wake',
        sessionId: 'session-codex-goal-status-wake',
        runtimeKind: 'codex',
      })

      const now = 1_700_000_000
      db().insert(messages).values([
        {
          id: 'message-codex-goal-status-user',
          sessionId: 'session-codex-goal-status-wake',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: 'Previous failed goal run.',
          messageJson: JSON.stringify({
            id: 'message-codex-goal-status-user',
            role: 'user',
            parts: [{ type: 'text', text: 'Previous failed goal run.' }],
          } satisfies UIMessage),
          errorText: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'message-codex-goal-status-assistant-failed',
          sessionId: 'session-codex-goal-status-wake',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'failed',
          content: '',
          messageJson: JSON.stringify({
            id: 'message-codex-goal-status-assistant-failed',
            role: 'assistant',
            parts: [],
          } satisfies UIMessage),
          errorText: 'exceeded retry limit, last status: 429 Too Many Requests',
          createdAt: now + 1,
          updatedAt: now + 1,
        },
      ]).run()
      db().insert(backendSessionBindings).values({
        id: 'binding-codex-goal-status-wake',
        chatSessionId: 'session-codex-goal-status-wake',
        providerTargetId: 'provider-target-codex-goal-status-wake',
        runtimeKind: 'codex',
        backendSessionId: 'codex-thread-goal-auto',
        backendStateSnapshot: JSON.stringify({
          models: { currentModelId: null },
          codex: {
            goal: {
              threadId: 'codex-thread-goal-auto',
              objective: 'Keep going',
              status: 'active',
              tokenBudget: null,
              tokensUsed: 0,
              timeUsedSeconds: 0,
              createdAt: 1,
              updatedAt: 2,
            },
          },
        }),
        requestedModelId: null,
        createdAt: now,
        updatedAt: now,
      }).run()
      db().insert(backendRuns).values({
        id: 'run-codex-goal-status-failed',
        bindingId: 'binding-codex-goal-status-wake',
        chatSessionId: 'session-codex-goal-status-wake',
        messageId: 'message-codex-goal-status-assistant-failed',
        origin: 'user',
        status: 'failed',
        stopReason: 'response.failed',
        errorText: 'exceeded retry limit, last status: 429 Too Many Requests',
        startedAt: now + 1,
        finishedAt: now + 1,
      }).run()

      const statusResponse = await app.handle(new Request('http://localhost/chat/sessions/session-codex-goal-status-wake/runtime-status'))
      expect(statusResponse.status).toBe(200)
      expect(await statusResponse.json()).toEqual(expect.objectContaining({
        status: 'idle',
        hasActiveGoal: true,
      }))

      const continuationRun = await waitForCondition(() => {
        const runs = db()
          .select()
          .from(backendRuns)
          .where(eq(backendRuns.chatSessionId, 'session-codex-goal-status-wake'))
          .all()
        expect(runs).toHaveLength(2)
        const run = runs.find(row => row.origin === 'system')
        expect(run).toEqual(expect.objectContaining({ status: 'complete' }))
        return run!
      }, 'runtime-status awakened Codex goal continuation')

      expect(runtime.streamInputs).toHaveLength(1)
      expect(runtime.streamInputs[0]?.runId).toBe(continuationRun.id)
      expect(runtime.streamInputs[0]?.message).toEqual(expect.objectContaining({
        metadata: {
          cradle: {
            codex: { goalContinuation: true },
          },
        },
      }))
      expect(db()
        .select()
        .from(messages)
        .where(eq(messages.sessionId, 'session-codex-goal-status-wake'))
        .all()
        .filter(row => row.role === 'user')).toHaveLength(1)
    }
    finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
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
