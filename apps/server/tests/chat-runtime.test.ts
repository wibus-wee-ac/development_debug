// Input: chat runtime HTTP endpoints
// Output: integration tests for chat runs, timeline hydration, usage writes, search hits, and abort behavior
// Position: apps/server/tests

import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces } from '@cradle/db'
import { describe, expect, it, vi } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'
import { DbAccessor } from '../src/database/db-accessor'

interface ChatTimelineGroup {
  messageId: string
  role: 'user' | 'assistant'
  userText?: string
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText?: string
  events: Array<{ type: string, delta?: string }>
}

type HonoApp = Awaited<ReturnType<typeof createConfiguredApp>> extends { getInstance: () => infer T } ? T : never

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function createProfileAndSession(hono: HonoApp, workspaceId: string) {
  const credentialRes = await hono.request('/secrets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'openai-compatible',
      label: 'Chat Runtime Key',
      secret: 'sk-chat-runtime-test',
    }),
  })
  const credential = await credentialRes.json() as { id: string }

  const profileRes = await hono.request('/profiles/profile-chat', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Chat Runtime Profile',
      providerKind: 'openai-compatible',
      enabled: true,
      config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o-mini' },
      credentialRef: credential.id,
    }),
  })
  expect(profileRes.status).toBe(200)

  const sessionRes = await hono.request('/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'session-chat',
      workspaceId,
      title: 'Chat Runtime Session',
      agentProfileId: 'profile-chat',
    }),
  })
  expect(sessionRes.status).toBe(200)
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

describe('chat runtime capability', () => {
  it('runs an openai-compatible turn, writes timeline and usage, and makes assistant text searchable', async () => {
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
          'data: {"id":"chunk-1","choices":[{"delta":{"content":"Hello "}}]}\n\n',
          'data: {"id":"chunk-2","choices":[{"delta":{"content":"from chat runtime"}}]}\n\n',
          'data: {"id":"chunk-3","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}\n\n',
          'data: [DONE]\n\n',
        ])
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const accessor = app.getContainer().resolve(DbAccessor) as DbAccessor
      accessor.get().insert(workspaces).values({
        id: 'workspace-chat',
        name: 'Workspace Chat',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(hono, 'workspace-chat')

      const runRes = await hono.request('/chat/sessions/session-chat/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Explain server runtime' }),
      })
      expect(runRes.status).toBe(200)
      const run = await runRes.json() as { runId: string, assistantMessageId: string, userMessageId: string }
      expect(run.runId).toBeTruthy()
      expect(run.assistantMessageId).toBeTruthy()
      expect(run.userMessageId).toBeTruthy()

      const timeline = await waitForTimelineStatus(hono, 'session-chat', 'complete')
      expect(timeline).toHaveLength(2)
      expect(timeline[0]).toEqual(expect.objectContaining({ role: 'user', userText: 'Explain server runtime', status: 'complete' }))
      expect(timeline[1]).toEqual(expect.objectContaining({ role: 'assistant', status: 'complete' }))
      expect(timeline[1].events.map(event => event.type)).toEqual(expect.arrayContaining([
        'run.started',
        'assistant.message.started',
        'assistant.text.delta',
        'assistant.message.completed',
        'run.completed',
      ]))

      const usageRes = await hono.request('/usage/sessions/session-chat')
      expect(usageRes.status).toBe(200)
      expect(await usageRes.json()).toEqual(expect.objectContaining({
        promptTokens: 10,
        completionTokens: 3,
        totalTokens: 13,
      }))

      const searchRes = await hono.request('/search/threads?query=Hello%20from%20chat%20runtime')
      expect(searchRes.status).toBe(200)
      const hits = await searchRes.json() as Array<{ sessionId: string }>
      expect(hits).toEqual([expect.objectContaining({ sessionId: 'session-chat' })])
      expect(fetchSpy).toHaveBeenCalledTimes(1)
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
          'data: {"id":"chunk-1","choices":[{"delta":{"content":"Starting "}}]}\n\n',
          'data: {"id":"chunk-2","choices":[{"delta":{"content":"long reply"}}]}\n\n',
          'data: [DONE]\n\n',
        ], [0, 60, 60])
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const accessor = app.getContainer().resolve(DbAccessor) as DbAccessor
      accessor.get().insert(workspaces).values({
        id: 'workspace-chat',
        name: 'Workspace Chat',
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(hono, 'workspace-chat')

      const missingText = await hono.request('/chat/sessions/session-chat/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(missingText.status).toBe(400)
      expect((await missingText.json()).code).toBe('invalid_chat_runtime_input')

      const missingSession = await hono.request('/chat/sessions/missing/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      })
      expect(missingSession.status).toBe(404)
      expect((await missingSession.json()).code).toBe('chat_session_not_found')

      const runRes = await hono.request('/chat/sessions/session-chat/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Abort this run' }),
      })
      expect(runRes.status).toBe(200)
      const run = await runRes.json() as { runId: string }

      const abortRes = await hono.request(`/chat/runs/${encodeURIComponent(run.runId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'aborted' }),
      })
      expect(abortRes.status).toBe(200)
      expect(await abortRes.json()).toEqual({ ok: true })

      const timeline = await waitForTimelineStatus(hono, 'session-chat', 'aborted')
      expect(timeline[1]).toEqual(expect.objectContaining({ role: 'assistant', status: 'aborted' }))
      expect(timeline[1].events.map(event => event.type)).toContain('run.aborted')

      const missingRun = await hono.request('/chat/runs/missing-run', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'aborted' }),
      })
      expect(missingRun.status).toBe(404)
      expect((await missingRun.json()).code).toBe('chat_run_not_found')
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
