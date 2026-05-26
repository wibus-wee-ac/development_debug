import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { addHostMcpServer, removeHostMcpServer } from '../src/plugins/mcp-registry'

const sdkMocks = vi.hoisted(() => ({
  claudeQuery: vi.fn(),
  codexConstructor: vi.fn(),
  codexStartThread: vi.fn(),
  codexResumeThread: vi.fn(),
  codexRunStreamed: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: sdkMocks.claudeQuery,
}))

vi.mock('@openai/codex-sdk', () => ({
  Codex: class FakeCodex {
    constructor(options: unknown) {
      sdkMocks.codexConstructor(options)
    }

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

interface ChatMessageSnapshot {
  messageId: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  content: string
  parentToolCallId?: string | null
  message: {
    parts: Array<{ type: string, text?: string, state?: string, toolCallId?: string, output?: unknown, errorText?: string }>
  }
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

async function waitForMessageStatus(app: ElysiaApp, sessionId: string, expectedStatus: ChatMessageSnapshot['status']): Promise<ChatMessageSnapshot[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.handle(new Request(`http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/messages`))
    if (response.status === 200) {
      const groups = await response.json() as ChatMessageSnapshot[]
      const assistant = groups.find(group => group.role === 'assistant')
      if (assistant?.status === expectedStatus) {
        return groups
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  throw new Error(`Timed out waiting for assistant status ${expectedStatus}`)
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
      providerKind: input.providerKind === 'claude-agent' ? 'anthropic' : 'openai-compatible',
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
      providerTargetId: input.profileId,
      runtimeKind: input.providerKind,
    }),
  }))
  expect(sessionRes.status).toBe(200)

  return { credentialRef: credential.id }
}

describe('sdk-backed providers in unified chat runtime', () => {
  beforeEach(() => {
    sdkMocks.claudeQuery.mockReset()
    sdkMocks.codexConstructor.mockReset()
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
    removeHostMcpServer('browser-use')
    addHostMcpServer({
      name: 'browser-use',
      command: 'node',
      args: ['/tmp/browser-use-mcp-server.mjs'],
      env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
    })

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
      const url = new Request(input).url
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

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({ id: 'workspace-sdk', name: 'Workspace SDK', path: workspaceRoot }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-sdk',
        providerKind: 'claude-agent',
        profileId: 'profile-claude',
        sessionId: 'session-claude',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-123',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello Claude' }),
      }))
      expect(runRes.status).toBe(200)

      const timeline = await waitForMessageStatus(app, 'session-claude', 'complete')
      const assistant = timeline.find(group => group.role === 'assistant')
      expect(assistant?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'reasoning', text: 'Reasoning...', state: 'done' }),
        expect.objectContaining({ type: 'text', text: 'Claude says hi', state: 'done' }),
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

  it('applies Claude Agent SDK model aliases from agent settings to chat runs', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'assistant',
        session_id: 'claude-agent-settings-session',
        message: {
          content: [{ type: 'text', text: 'Agent configured' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-agent-settings-session',
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    ]))

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({ id: 'workspace-agent-settings', name: 'Workspace Agent Settings', path: workspaceRoot }).run()

      const credentialRes = await app.handle(new Request('http://localhost/secrets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'anthropic',
          label: 'Anthropic key',
          secret: 'sk-ant-agent-settings',
        }),
      }))
      expect(credentialRes.status).toBe(200)
      const credential = await credentialRes.json() as { id: string }

      const profileRes = await app.handle(new Request('http://localhost/profiles/profile-agent-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Anthropic',
          providerKind: 'anthropic',
          enabled: true,
          config: { model: 'claude-sonnet-4-20250514' },
          credentialRef: credential.id,
        }),
      }))
      expect(profileRes.status).toBe(200)

      const agentRes = await app.handle(new Request('http://localhost/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Claude Alias Agent',
          avatarStyle: 'bottts-neutral',
          avatarSeed: 'alias-seed',
          providerTargetId: 'profile-agent-settings',
          modelId: 'claude-sonnet-4-20250514',
          runtimeKind: 'claude-agent',
          configJson: JSON.stringify({
            claudeAgent: {
              modelAliases: {
                haiku: 'claude-haiku-4-5',
                sonnet: 'claude-sonnet-4-5',
                opus: 'claude-opus-4-5',
              },
            },
          }),
        }),
      }))
      expect(agentRes.status).toBe(200)
      const agent = await agentRes.json() as { id: string }

      const sessionRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'session-agent-settings',
          workspaceId: 'workspace-agent-settings',
          title: 'Agent settings session',
          agentId: agent.id,
        }),
      }))
      expect(sessionRes.status).toBe(200)

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-agent-settings/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Use agent settings' }),
      }))
      expect(runRes.status).toBe(200)

      await waitForMessageStatus(app, 'session-agent-settings', 'complete')

      const call = sdkMocks.claudeQuery.mock.calls[0]?.[0] as {
        options?: { env?: Record<string, string> }
      } | undefined
      expect(call?.options?.env).toEqual(expect.objectContaining({
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-5',
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
      const url = new Request(input).url
      if (url === 'https://api.openai.com/v1/models') {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-5-codex' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({ openai: { models: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({ id: 'workspace-sdk', name: 'Workspace SDK', path: workspaceRoot }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-sdk',
        providerKind: 'codex',
        profileId: 'profile-codex',
        sessionId: 'session-codex',
        config: { model: 'gpt-5-codex' },
        secret: 'sk-openai-123',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-codex/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello Codex' }),
      }))
      expect(runRes.status).toBe(200)

      const timeline = await waitForMessageStatus(app, 'session-codex', 'complete')
      const assistant = timeline.find(group => group.role === 'assistant')
      expect(assistant?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'reasoning', text: 'Thinking', state: 'done' }),
        expect.objectContaining({ type: 'text', text: 'Codex reply', state: 'done' }),
        expect.objectContaining({ type: 'dynamic-tool', toolCallId: 'cmd-1', state: 'output-available', output: 'pass' }),
      ]))

      expect(sdkMocks.codexStartThread).toHaveBeenCalledWith(expect.objectContaining({
        workingDirectory: workspaceRoot,
      }))
      expect(sdkMocks.codexConstructor).toHaveBeenCalledWith(expect.objectContaining({
        config: expect.objectContaining({
          mcp_servers: expect.objectContaining({
            'browser-use': {
              command: 'node',
              args: ['/tmp/browser-use-mcp-server.mjs'],
              env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
            },
            chronicle: expect.objectContaining({
              command: 'node',
              env: { CRADLE_URL: 'http://127.0.0.1:21423' },
            }),
          }),
        }),
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
      removeHostMcpServer('browser-use')
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
      const url = new Request(input).url
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

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
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
      const partTypes = assistant?.message.parts.map(part => part.type) ?? []

      expect(partTypes).toContain('dynamic-tool')
      expect(partTypes).toContain('text')

      const toolIdx = partTypes.indexOf('dynamic-tool')
      const textIdx = partTypes.indexOf('text')
      expect(toolIdx).toBeLessThan(textIdx)

      expect(assistant?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'dynamic-tool', toolCallId: 'toolu_abc123', state: 'output-available', output: 'hello\n' }),
        expect.objectContaining({ type: 'text', text: 'Done running bash', state: 'done' }),
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

  it('routes parent_tool_use_id chunks into subagent_message_delta events with globally increasing seq values', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'assistant',
        session_id: 'claude-subagent-session',
        message: {
          content: [
            { type: 'text', text: 'Main task dispatch' },
            { type: 'tool_use', id: 'toolu_parent_1', name: 'task', input: { description: 'Investigate runtime' } },
          ],
        },
      },
        {
          type: 'system/task_started',
          session_id: 'claude-subagent-session',
          task_id: 'task_sub_1',
          agent_name: 'Investigate Agent',
          parent_tool_use_id: 'toolu_parent_1',
        },
      {
        type: 'assistant',
        session_id: 'claude-subagent-session',
        parent_tool_use_id: 'toolu_parent_1',
        message: {
          content: [{ type: 'text', text: 'Subagent investigating' }],
        },
      },
      {
        type: 'assistant',
        session_id: 'claude-subagent-session',
        message: {
          content: [{ type: 'text', text: 'Main task finished' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-subagent-session',
        usage: { input_tokens: 21, output_tokens: 9 },
      },
    ]))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
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

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({ id: 'workspace-subagent', name: 'Workspace Subagent', path: workspaceRoot }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-subagent',
        providerKind: 'claude-agent',
        profileId: 'profile-claude-subagent',
        sessionId: 'session-claude-subagent',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-subagent-test',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude-subagent/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Dispatch a subagent' }),
      }))
      expect(runRes.status).toBe(200)

      const events = await collectSseEvents(runRes)
      const mainEvents = events.filter(event => event.type === 'message_delta')
      const subagentEvents = events.filter(event => event.type === 'subagent_message_delta')

      expect(mainEvents.length).toBeGreaterThan(0)
      expect(subagentEvents.length).toBeGreaterThan(0)
      expect(events.at(-1)?.type).toBe('run_completed')

      const seqs = events
        .filter(event => event.type === 'message_delta' || event.type === 'subagent_message_delta')
        .flatMap((event) => {
          const data = event.data as { deltas?: Array<{ seq: number }> }
          return (data.deltas ?? []).map(delta => delta.seq)
        })
      expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, index) => index))

      const mainMessageId = (mainEvents[0]!.data as { messageId: string }).messageId
      const subagentContext = (subagentEvents[0]!.data as {
        context: {
          messageId: string
          parentMessageId: string
          parentToolCallId: string
        }
      }).context

      expect(subagentContext.parentToolCallId).toBe('toolu_parent_1')
      expect(subagentContext.parentMessageId).toBe(mainMessageId)
      expect(subagentContext.messageId).not.toBe(mainMessageId)
      expect(subagentContext.taskId).toBe('task_sub_1')

      const timeline = await waitForMessageStatus(app, 'session-claude-subagent', 'complete')
      const assistantMessages = timeline.filter(message => message.role === 'assistant')
      expect(assistantMessages).toHaveLength(2)
      expect(assistantMessages.find(message => !message.parentToolCallId)?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'dynamic-tool', toolCallId: 'toolu_parent_1', state: 'input-available' }),
        expect.objectContaining({ type: 'text', text: 'Main task dispatch', state: 'done' }),
        expect.objectContaining({ type: 'text', text: 'Main task finished', state: 'done' }),
      ]))
      expect(assistantMessages.find(message => message.parentToolCallId === 'toolu_parent_1')).toEqual(expect.objectContaining({
        parentToolCallId: 'toolu_parent_1',
        taskId: 'task_sub_1',
      }))
      expect(assistantMessages.find(message => message.parentToolCallId === 'toolu_parent_1')?.content).toContain('Subagent investigating')
      expect(assistantMessages.find(message => message.parentToolCallId === 'toolu_parent_1')?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: '[Investigate Agent started]' }),
        expect.objectContaining({ type: 'text', text: 'Subagent investigating' }),
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

  it('backfills late subagent taskId metadata and persists task_notification lifecycle text', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'assistant',
        session_id: 'claude-subagent-late-task-session',
        message: {
          content: [
            { type: 'text', text: 'Dispatch late-task subagent' },
            { type: 'tool_use', id: 'toolu_parent_late', name: 'task', input: { description: 'Investigate late task metadata' } },
          ],
        },
      },
      {
        type: 'assistant',
        session_id: 'claude-subagent-late-task-session',
        parent_tool_use_id: 'toolu_parent_late',
        message: {
          content: [{ type: 'text', text: 'Working before task metadata arrives' }],
        },
      },
      {
        type: 'system/task_notification',
        session_id: 'claude-subagent-late-task-session',
        task_id: 'task_sub_late',
        status: 'completed',
        parent_tool_use_id: 'toolu_parent_late',
      },
      {
        type: 'result',
        session_id: 'claude-subagent-late-task-session',
        usage: { input_tokens: 21, output_tokens: 9 },
      },
    ]))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
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

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({ id: 'workspace-subagent-late-task', name: 'Workspace Subagent Late Task', path: workspaceRoot }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-subagent-late-task',
        providerKind: 'claude-agent',
        profileId: 'profile-claude-subagent-late-task',
        sessionId: 'session-claude-subagent-late-task',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-subagent-late-task',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude-subagent-late-task/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Dispatch late task metadata subagent' }),
      }))
      expect(runRes.status).toBe(200)

      const events = await collectSseEvents(runRes)
      const subagentEvents = events.filter(event => event.type === 'subagent_message_delta')
      expect(subagentEvents.some(event => (event.data as { context: { taskId?: string | null } }).context.taskId === 'task_sub_late')).toBe(true)

      const timeline = await waitForMessageStatus(app, 'session-claude-subagent-late-task', 'complete')
      const subagentMessage = timeline.find(message => message.parentToolCallId === 'toolu_parent_late')
      expect(subagentMessage).toEqual(expect.objectContaining({
        parentToolCallId: 'toolu_parent_late',
        taskId: 'task_sub_late',
      }))
      expect(subagentMessage?.content).toContain('Working before task metadata arrives')
      expect(subagentMessage?.content).toContain('[Task completed]')
      expect(subagentMessage?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: 'Working before task metadata arrives' }),
        expect.objectContaining({ type: 'text', text: '[Task completed]' }),
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
      const url = new Request(input).url
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

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
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
      expect(assistant?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'dynamic-tool', toolCallId: 'toolu_err456', state: 'output-error', errorText: 'exit code 1' }),
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
})

describe('claude-agent mapper: input_json_delta streaming', () => {
  it('maps content_block_delta with input_json_delta to tool-input-delta chunks', async () => {
    const { mapClaudeAgentMessageToChunks } = await import('../src/modules/chat-runtime/providers/claude-agent/mapper')
    type MapperState = import('../src/modules/chat-runtime/providers/claude-agent/mapper').ClaudeAgentChunkMapperState

    const state: MapperState = {
      textItemId: 'text-1',
      assistantStarted: false,
      hadToolCallSinceLastText: false,
      emittedTextByTextItemId: new Map(),
      emittedToolStateByToolCallId: new Map(),
      activeToolBlockIds: new Map(),
      currentParentToolUseId: null,
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
      emittedTextByTextItemId: new Map(),
      emittedToolStateByToolCallId: new Map(),
      activeToolBlockIds: new Map([[0, 'toolu_empty']]),
      currentParentToolUseId: null,
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
      emittedTextByTextItemId: new Map(),
      emittedToolStateByToolCallId: new Map(),
      activeToolBlockIds: new Map(),
      currentParentToolUseId: null,
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
