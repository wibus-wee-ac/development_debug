// Input: unified chat runtime endpoints with Claude Agent and Codex SDK-backed providers
// Output: integration tests for provider metadata and unified chat execution beyond openai-compatible
// Position: apps/server/tests

import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'
import { DbAccessor } from '../src/database/db-accessor'

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

interface ChatTimelineGroup {
  messageId: string
  role: 'user' | 'assistant'
  userText?: string
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  events: Array<{ type: string, delta?: string, command?: string, paths?: string[] }>
}

type HonoApp = Awaited<ReturnType<typeof createConfiguredApp>> extends { getInstance: () => infer T } ? T : never

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

async function waitForTimelineStatus(hono: HonoApp, sessionId: string, expectedStatus: ChatTimelineGroup['status']): Promise<ChatTimelineGroup[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await hono.request(`/chat/sessions/${encodeURIComponent(sessionId)}/timeline`)
    if (response.status === 200) {
      const groups = await response.json() as ChatTimelineGroup[]
      const assistant = groups.find(group => group.role === 'assistant')
      if (assistant?.status === expectedStatus) {
        return groups
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  throw new Error(`Timed out waiting for assistant status ${expectedStatus}`)
}

async function createProfileAndSession(hono: HonoApp, input: {
  workspaceId: string
  providerKind: 'claude-agent' | 'codex'
  profileId: string
  sessionId: string
  config: Record<string, unknown>
  secret: string
}) {
  const credentialRes = await hono.request('/secrets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: input.providerKind,
      label: `${input.providerKind} key`,
      secret: input.secret,
    }),
  })
  expect(credentialRes.status).toBe(200)
  const credential = await credentialRes.json() as { id: string }

  const profileRes = await hono.request(`/profiles/${input.profileId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: input.profileId,
      providerKind: input.providerKind,
      enabled: true,
      config: input.config,
      credentialRef: credential.id,
    }),
  })
  expect(profileRes.status).toBe(200)

  const sessionRes = await hono.request('/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: input.sessionId,
      workspaceId: input.workspaceId,
      title: `${input.providerKind} session`,
      agentProfileId: input.profileId,
    }),
  })
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
      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const accessor = app.getContainer().resolve(DbAccessor) as DbAccessor
      accessor.get().insert(workspaces).values({ id: 'workspace-sdk', name: 'Workspace SDK', path: workspaceRoot }).run()

      const { credentialRef } = await createProfileAndSession(hono, {
        workspaceId: 'workspace-sdk',
        providerKind: 'claude-agent',
        profileId: 'profile-claude',
        sessionId: 'session-claude',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-123',
      })

      const healthCheckRes = await hono.request('/providers/health-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-claude',
          providerKind: 'claude-agent',
          label: 'profile-claude',
          config: { model: 'claude-sonnet-4-20250514' },
          secretRef: credentialRef,
        }),
      })
      expect(healthCheckRes.status).toBe(200)
      expect(await healthCheckRes.json()).toEqual(expect.objectContaining({ ok: true }))

      const modelsRes = await hono.request('/providers/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-claude',
          providerKind: 'claude-agent',
          label: 'profile-claude',
          config: { model: 'claude-sonnet-4-20250514' },
          secretRef: credentialRef,
        }),
      })
      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({ id: 'claude-sonnet-4-20250514', providerKind: 'claude-agent' }),
      ])

      const runRes = await hono.request('/chat/sessions/session-claude/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello Claude' }),
      })
      expect(runRes.status).toBe(200)

      const timeline = await waitForTimelineStatus(hono, 'session-claude', 'complete')
      const assistant = timeline.find(group => group.role === 'assistant')
      expect(assistant?.events.map(event => event.type)).toEqual(expect.arrayContaining([
        'run.started',
        'reasoning.started',
        'reasoning.delta',
        'assistant.message.started',
        'assistant.text.delta',
        'assistant.message.completed',
        'run.completed',
      ]))

      const usageRes = await hono.request('/usage/sessions/session-claude')
      expect(usageRes.status).toBe(200)
      expect(await usageRes.json()).toEqual(expect.objectContaining({
        promptTokens: 9,
        completionTokens: 4,
        totalTokens: 13,
      }))
    }
    finally {
      if (app) {
        await app.close()
      }
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
      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const accessor = app.getContainer().resolve(DbAccessor) as DbAccessor
      accessor.get().insert(workspaces).values({ id: 'workspace-sdk', name: 'Workspace SDK', path: workspaceRoot }).run()

      const { credentialRef } = await createProfileAndSession(hono, {
        workspaceId: 'workspace-sdk',
        providerKind: 'codex',
        profileId: 'profile-codex',
        sessionId: 'session-codex',
        config: { model: 'gpt-5-codex' },
        secret: 'sk-openai-123',
      })

      const healthCheckRes = await hono.request('/providers/health-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-codex',
          providerKind: 'codex',
          label: 'profile-codex',
          config: { model: 'gpt-5-codex' },
          secretRef: credentialRef,
        }),
      })
      expect(healthCheckRes.status).toBe(200)
      expect(await healthCheckRes.json()).toEqual(expect.objectContaining({ ok: true }))

      const modelsRes = await hono.request('/providers/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-codex',
          providerKind: 'codex',
          label: 'profile-codex',
          config: { model: 'gpt-5-codex' },
          secretRef: credentialRef,
        }),
      })
      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({ id: 'gpt-5-codex', providerKind: 'codex' }),
      ])

      const runRes = await hono.request('/chat/sessions/session-codex/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello Codex' }),
      })
      expect(runRes.status).toBe(200)

      const timeline = await waitForTimelineStatus(hono, 'session-codex', 'complete')
      const assistant = timeline.find(group => group.role === 'assistant')
      expect(assistant?.events.map(event => event.type)).toEqual(expect.arrayContaining([
        'run.started',
        'reasoning.started',
        'reasoning.completed',
        'assistant.message.started',
        'assistant.text.delta',
        'command.started',
        'command.completed',
        'file_change.completed',
        'assistant.message.completed',
        'run.completed',
      ]))

      expect(sdkMocks.codexStartThread).toHaveBeenCalledWith(expect.objectContaining({
        workingDirectory: workspaceRoot,
      }))

      const usageRes = await hono.request('/usage/sessions/session-codex')
      expect(usageRes.status).toBe(200)
      expect(await usageRes.json()).toEqual(expect.objectContaining({
        promptTokens: 11,
        completionTokens: 6,
        totalTokens: 17,
      }))
    }
    finally {
      if (app) {
        await app.close()
      }
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
