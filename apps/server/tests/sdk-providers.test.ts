// Input: unified chat runtime endpoints with Claude Agent and Codex SDK-backed providers
// Output: integration tests for provider metadata and unified chat execution beyond openai-compatible
// Position: apps/server/tests

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

const sdkMocks = vi.hoisted(() => ({
  claudeQuery: vi.fn(),
  codexStartThread: vi.fn(),
  codexResumeThread: vi.fn(),
  codexRunStreamed: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: sdkMocks.claudeQuery,
}))

vi.mock('@openai/codex-sdk', () => ({
  Codex: class FakeCodex {
    startThread(options: unknown) {
      sdkMocks.codexStartThread(options)
      return { runStreamed: sdkMocks.codexRunStreamed }
    }

    resumeThread(threadId: string, options: unknown) {
      sdkMocks.codexResumeThread(threadId, options)
      return { runStreamed: sdkMocks.codexRunStreamed }
    }
  },
}))

interface ChatChunkGroup {
  messageId: string
  role: 'user' | 'assistant'
  userText?: string
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  chunks: Array<{ chunk: { type: string, delta?: string, [key: string]: unknown } }>
}

type ElysiaApp = ReturnType<typeof createServerApp>

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function makeAsyncSequence<T>(items: T[]) {
  let index = 0
  let done = false
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      if (done || index >= items.length) {
        return { done: true as const, value: undefined }
      }
      const value = items[index]
      index += 1
      return { done: false as const, value }
    },
    async return() {
      done = true
      return { done: true as const, value: undefined }
    },
  }
}

async function waitForMessageStatus(app: ElysiaApp, sessionId: string, expectedStatus: ChatChunkGroup['status']): Promise<ChatChunkGroup[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.handle(new Request(`http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/messages`))
    if (response.status === 200) {
      const groups = await response.json() as ChatChunkGroup[]
      const assistant = groups.find(group => group.role === 'assistant')
      if (assistant?.status === expectedStatus) {
        return groups
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  throw new Error(`Timed out waiting for assistant status ${expectedStatus}`)
}

async function createProfileAndSession(app: ElysiaApp, input: {
  workspaceId: string
  providerKind: 'claude-agent' | 'codex'
  profileId: string
  sessionId: string
  config: Record<string, unknown>
  secret: string
}) {
  const credentialRes = await app.handle(new Request('http://localhost/secrets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: input.providerKind,
      label: `${input.providerKind} key`,
      secret: input.secret,
    }),
  }))
  expect(credentialRes.status).toBe(200)
  const credential = await credentialRes.json() as { id: string }

  const profileRes = await app.handle(new Request(`http://localhost/profiles/${input.profileId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: input.profileId,
      providerKind: input.providerKind,
      enabled: true,
      config: input.config,
      credentialRef: credential.id,
    }),
  }))
  expect(profileRes.status).toBe(200)

  const sessionRes = await app.handle(new Request('http://localhost/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: input.sessionId,
      workspaceId: input.workspaceId,
      title: `${input.providerKind} session`,
      agentProfileId: input.profileId,
    }),
  }))
  expect(sessionRes.status).toBe(200)

  return { credentialRef: credential.id }
}

describe('sdk-backed providers in unified chat runtime', () => {
  beforeEach(() => {
    sdkMocks.claudeQuery.mockReset()
    sdkMocks.codexStartThread.mockReset()
    sdkMocks.codexResumeThread.mockReset()
    sdkMocks.codexRunStreamed.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('supports claude-agent profiles in metadata endpoints and unified chat runs', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'stream_event',
        session_id: 'claude-session-1',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking' },
        },
      },
      {
        type: 'stream_event',
        session_id: 'claude-session-1',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Reasoning...' },
        },
      },
      {
        type: 'assistant',
        session_id: 'claude-session-1',
        message: {
          content: [{ type: 'text', text: 'Claude says hi' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-1',
        usage: { input_tokens: 9, output_tokens: 4 },
      },
    ]))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'https://api.anthropic.com/v1/models') {
        return new Response(JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({ anthropic: { models: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      db().insert(workspaces).values({ id: 'workspace-sdk', name: 'Workspace SDK', path: workspaceRoot }).run()

      const { credentialRef } = await createProfileAndSession(app, {
        workspaceId: 'workspace-sdk',
        providerKind: 'claude-agent',
        profileId: 'profile-claude',
        sessionId: 'session-claude',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-123',
      })

      const healthCheckRes = await app.handle(new Request('http://localhost/providers/health-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-claude',
          providerKind: 'claude-agent',
          label: 'profile-claude',
          config: { model: 'claude-sonnet-4-20250514' },
          secretRef: credentialRef,
        }),
      }))
      expect(healthCheckRes.status).toBe(200)
      expect(await healthCheckRes.json()).toEqual(expect.objectContaining({ ok: true }))

      const modelsRes = await app.handle(new Request('http://localhost/providers/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-claude',
          providerKind: 'claude-agent',
          label: 'profile-claude',
          config: { model: 'claude-sonnet-4-20250514' },
          secretRef: credentialRef,
        }),
      }))
      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({ id: 'claude-sonnet-4-20250514', providerKind: 'claude-agent' }),
      ])

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello Claude' }),
      }))
      expect(runRes.status).toBe(200)

      const timeline = await waitForMessageStatus(app, 'session-claude', 'complete')
      const assistant = timeline.find(group => group.role === 'assistant')
      expect(assistant?.chunks.map((c: any) => c.chunk.type)).toEqual(expect.arrayContaining([
        'start',
        'reasoning-start',
        'reasoning-delta',
        'text-start',
        'text-delta',
        'text-end',
        'finish',
      ]))

      const usageRes = await app.handle(new Request('http://localhost/usage/sessions/session-claude'))
      expect(usageRes.status).toBe(200)
      expect(await usageRes.json()).toEqual(expect.objectContaining({
        promptTokens: 9,
        completionTokens: 4,
        totalTokens: 13,
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

  it('supports codex profiles in metadata endpoints and unified chat runs with workspace-aware thread options', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    sdkMocks.codexRunStreamed.mockImplementation(async () => ({
      events: makeAsyncSequence([
        { type: 'thread.started', thread_id: 'thread-codex-1' },
        { type: 'item.started', item: { type: 'reasoning', id: 'reason-1', text: 'Thinking' } },
        { type: 'item.completed', item: { type: 'agent_message', id: 'msg-1', text: 'Codex reply' } },
        { type: 'item.started', item: { type: 'command_execution', id: 'cmd-1', command: 'npm test' } },
        { type: 'item.completed', item: { type: 'command_execution', id: 'cmd-1', command: 'npm test', exit_code: 0, aggregated_output: 'pass' } },
        { type: 'item.completed', item: { type: 'file_change', id: 'file-1', status: 'completed', changes: [{ path: 'src/app.ts' }] } },
        { type: 'turn.completed', usage: { input_tokens: 11, output_tokens: 6 } },
      ]),
    }))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'https://api.openai.com/v1/models') {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-5-codex' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({ openai: { models: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      db().insert(workspaces).values({ id: 'workspace-sdk', name: 'Workspace SDK', path: workspaceRoot }).run()

      const { credentialRef } = await createProfileAndSession(app, {
        workspaceId: 'workspace-sdk',
        providerKind: 'codex',
        profileId: 'profile-codex',
        sessionId: 'session-codex',
        config: { model: 'gpt-5-codex' },
        secret: 'sk-openai-123',
      })

      const healthCheckRes = await app.handle(new Request('http://localhost/providers/health-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-codex',
          providerKind: 'codex',
          label: 'profile-codex',
          config: { model: 'gpt-5-codex' },
          secretRef: credentialRef,
        }),
      }))
      expect(healthCheckRes.status).toBe(200)
      expect(await healthCheckRes.json()).toEqual(expect.objectContaining({ ok: true }))

      const modelsRes = await app.handle(new Request('http://localhost/providers/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-codex',
          providerKind: 'codex',
          label: 'profile-codex',
          config: { model: 'gpt-5-codex' },
          secretRef: credentialRef,
        }),
      }))
      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({ id: 'gpt-5-codex', providerKind: 'codex' }),
      ])

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-codex/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello Codex' }),
      }))
      expect(runRes.status).toBe(200)

      const timeline = await waitForMessageStatus(app, 'session-codex', 'complete')
      const assistant = timeline.find(group => group.role === 'assistant')
      expect(assistant?.chunks.map((c: any) => c.chunk.type)).toEqual(expect.arrayContaining([
        'start',
        'reasoning-start',
        'reasoning-end',
        'text-start',
        'text-delta',
        'tool-input-start',
        'tool-output-available',
        'text-end',
        'finish',
      ]))

      expect(sdkMocks.codexStartThread).toHaveBeenCalledWith(expect.objectContaining({
        workingDirectory: workspaceRoot,
      }))

      const usageRes = await app.handle(new Request('http://localhost/usage/sessions/session-codex'))
      expect(usageRes.status).toBe(200)
      expect(await usageRes.json()).toEqual(expect.objectContaining({
        promptTokens: 11,
        completionTokens: 6,
        totalTokens: 17,
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

  it('emits tool_call.started and tool_call.completed for claude-agent tool use lifecycle', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    // Mock a tool call flow: assistant emits tool_use → user sends tool_result → final text
    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'assistant',
        session_id: 'claude-tool-session',
        message: {
          content: [
            { type: 'tool_use', id: 'toolu_abc123', name: 'bash', input: { command: 'echo hello' } },
          ],
        },
      },
      {
        type: 'user',
        session_id: 'claude-tool-session',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_abc123', content: 'hello\n', is_error: false },
          ],
        },
      },
      {
        type: 'assistant',
        session_id: 'claude-tool-session',
        message: {
          content: [{ type: 'text', text: 'Done running bash' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-tool-session',
        usage: { input_tokens: 20, output_tokens: 8 },
      },
    ]))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'https://api.anthropic.com/v1/models') {
        return new Response(JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({ anthropic: { models: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      db().insert(workspaces).values({ id: 'workspace-tool', name: 'Workspace Tool', path: workspaceRoot }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-tool',
        providerKind: 'claude-agent',
        profileId: 'profile-claude-tool',
        sessionId: 'session-claude-tool',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-tool-test',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude-tool/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run echo hello' }),
      }))
      expect(runRes.status).toBe(200)

      const timeline = await waitForMessageStatus(app, 'session-claude-tool', 'complete')
      const assistant = timeline.find(group => group.role === 'assistant')
      const eventTypes = assistant?.chunks.map((c: any) => c.chunk.type) ?? []

      // Regression: tool-input-start and tool-output-available must both be emitted
      expect(eventTypes).toContain('tool-input-start')
      expect(eventTypes).toContain('tool-output-available')

      // Verify ordering: started before completed
      const startedIdx = eventTypes.indexOf('tool-input-start')
      const completedIdx = eventTypes.indexOf('tool-output-available')
      expect(startedIdx).toBeLessThan(completedIdx)

      // Verify the full lifecycle events are present
      expect(eventTypes).toEqual(expect.arrayContaining([
        'start',
        'tool-input-start',
        'tool-output-available',
        'text-start',
        'text-delta',
        'text-end',
        'finish',
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

  it('emits tool_call.completed with error result for failed tool calls', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'assistant',
        session_id: 'claude-err-session',
        message: {
          content: [
            { type: 'tool_use', id: 'toolu_err456', name: 'bash', input: { command: 'false' } },
          ],
        },
      },
      {
        type: 'user',
        session_id: 'claude-err-session',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_err456', content: 'exit code 1', is_error: true },
          ],
        },
      },
      {
        type: 'assistant',
        session_id: 'claude-err-session',
        message: {
          content: [{ type: 'text', text: 'Command failed' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-err-session',
        usage: { input_tokens: 15, output_tokens: 5 },
      },
    ]))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'https://api.anthropic.com/v1/models') {
        return new Response(JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({ anthropic: { models: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      db().insert(workspaces).values({ id: 'workspace-tool-err', name: 'Workspace Tool Err', path: workspaceRoot }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-tool-err',
        providerKind: 'claude-agent',
        profileId: 'profile-claude-err',
        sessionId: 'session-claude-err',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-err-test',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude-err/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run false command' }),
      }))
      expect(runRes.status).toBe(200)

      const timeline = await waitForMessageStatus(app, 'session-claude-err', 'complete')
      const assistant = timeline.find(group => group.role === 'assistant')
      const eventTypes = assistant?.chunks.map((c: any) => c.chunk.type) ?? []

      // Regression: tool-output-error must be emitted for error results
      expect(eventTypes).toContain('tool-input-start')
      expect(eventTypes).toContain('tool-output-error')
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

describe('claude-agent mapper: input_json_delta streaming', () => {
  it('maps content_block_delta with input_json_delta to tool-input-delta chunks', async () => {
    const { mapClaudeAgentMessageToChunks } = await import('../src/modules/chat-runtime/providers/claude-agent/mapper')
    type MapperState = import('../src/modules/chat-runtime/providers/claude-agent/mapper').ClaudeAgentChunkMapperState

    const state: MapperState = {
      textItemId: 'text-1',
      assistantStarted: false,
      hadToolCallSinceLastText: false,
      activeToolBlockIds: new Map(),
    }

    // 1. content_block_start for tool_use — should record the tool block ID
    const startResult = mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'sess-1',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_input_delta', name: 'bash', input: '' },
      },
    } as any, state)

    expect(startResult.chunks).toEqual([
      expect.objectContaining({ type: 'tool-input-start', toolCallId: 'toolu_input_delta', toolName: 'bash' }),
    ])
    expect(state.activeToolBlockIds.get(0)).toBe('toolu_input_delta')

    // 2. content_block_delta with input_json_delta — should emit tool-input-delta
    const delta1 = mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'sess-1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"command"' },
      },
    } as any, state)

    expect(delta1.chunks).toEqual([{
      type: 'tool-input-delta',
      toolCallId: 'toolu_input_delta',
      inputTextDelta: '{"command"',
    }])

    // 3. Second delta
    const delta2 = mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'sess-1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: ':"echo hi"}' },
      },
    } as any, state)

    expect(delta2.chunks).toEqual([{
      type: 'tool-input-delta',
      toolCallId: 'toolu_input_delta',
      inputTextDelta: ':"echo hi"}',
    }])
  })

  it('ignores input_json_delta with empty partial_json', async () => {
    const { mapClaudeAgentMessageToChunks } = await import('../src/modules/chat-runtime/providers/claude-agent/mapper')
    type MapperState = import('../src/modules/chat-runtime/providers/claude-agent/mapper').ClaudeAgentChunkMapperState

    const state: MapperState = {
      textItemId: 'text-1',
      assistantStarted: false,
      hadToolCallSinceLastText: false,
      activeToolBlockIds: new Map([[0, 'toolu_empty']]),
    }

    const result = mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'sess-1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '' },
      },
    } as any, state)

    expect(result.chunks).toEqual([])
  })

  it('ignores input_json_delta for unknown block index', async () => {
    const { mapClaudeAgentMessageToChunks } = await import('../src/modules/chat-runtime/providers/claude-agent/mapper')
    type MapperState = import('../src/modules/chat-runtime/providers/claude-agent/mapper').ClaudeAgentChunkMapperState

    const state: MapperState = {
      textItemId: 'text-1',
      assistantStarted: false,
      hadToolCallSinceLastText: false,
      activeToolBlockIds: new Map(),
    }

    const result = mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'sess-1',
      event: {
        type: 'content_block_delta',
        index: 5,
        delta: { type: 'input_json_delta', partial_json: '{"data":"value"}' },
      },
    } as any, state)

    expect(result.chunks).toEqual([])
  })
})
