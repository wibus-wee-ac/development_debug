// Input: observability HTTP endpoints and chat-runtime failure instrumentation
// Output: integration tests for event persistence, incident rules, and bundle export
// Position: apps/server/tests

import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces } from '@cradle/db'
import { describe, expect, it, vi } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'
import { DbAccessor } from '../src/database/db-accessor'

type HonoApp = Awaited<ReturnType<typeof createConfiguredApp>> extends { getInstance: () => infer T } ? T : never

type ChatTimelineGroup = {
  messageId: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText?: string
  events: Array<{ type: string }>
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function createProfileAndSession(hono: HonoApp, accessor: DbAccessor, workspaceRoot: string) {
  accessor.get().insert(workspaces).values({
    id: 'workspace-observability',
    name: 'Workspace Observability',
    path: workspaceRoot,
  }).run()

  const credentialRes = await hono.request('/secrets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'openai-compatible',
      label: 'Observability Key',
      secret: 'sk-observability-test',
    }),
  })
  const credential = await credentialRes.json() as { id: string }

  const profileRes = await hono.request('/profiles/profile-observability', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Observability Profile',
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
      id: 'session-observability',
      workspaceId: 'workspace-observability',
      title: 'Observability Session',
      agentProfileId: 'profile-observability',
    }),
  })
  expect(sessionRes.status).toBe(200)
}

async function waitForLatestAssistantStatus(
  hono: HonoApp,
  sessionId: string,
  expectedStatus: ChatTimelineGroup['status'],
  expectedAssistantCount: number,
): Promise<ChatTimelineGroup[]> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await hono.request(`/chat/sessions/${encodeURIComponent(sessionId)}/timeline`)
    if (response.status === 200) {
      const groups = await response.json() as ChatTimelineGroup[]
      const assistants = groups.filter(group => group.role === 'assistant')
      const latestAssistant = assistants.at(-1)
      if (assistants.length === expectedAssistantCount && latestAssistant?.status === expectedStatus) {
        return groups
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  throw new Error(`Timed out waiting for latest assistant status ${expectedStatus}`)
}

async function flushObservability(hono: HonoApp): Promise<void> {
  const response = await hono.request('/observability/flush', { method: 'POST' })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
}

describe('observability capability', () => {
  it('records empty-output failures, opens an incident at threshold, and exports the related bundle', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-observability-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'observability-secret'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/chat/completions')) {
        return new Response(new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()
            controller.enqueue(encoder.encode('data: {"id":"chunk-1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":0,"total_tokens":10}}\n\n'))
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          },
        }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const accessor = app.getContainer().resolve(DbAccessor) as DbAccessor
      await createProfileAndSession(hono, accessor, workspaceRoot)

      let finalRunId = ''
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const runRes = await hono.request('/chat/sessions/session-observability/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `empty output attempt ${attempt}` }),
        })
        expect(runRes.status).toBe(200)
        const run = await runRes.json() as { runId: string }
        finalRunId = run.runId

        const timeline = await waitForLatestAssistantStatus(hono, 'session-observability', 'failed', attempt)
        const latestAssistant = timeline.filter(group => group.role === 'assistant').at(-1)
        expect(latestAssistant).toEqual(expect.objectContaining({ status: 'failed' }))
        expect(latestAssistant?.events.map(event => event.type)).toContain('run.failed')
      }

      await flushObservability(hono)

      const eventsRes = await hono.request('/observability/events?chatSessionId=session-observability&code=CHAT_EMPTY_OUTPUT_COMPLETION')
      expect(eventsRes.status).toBe(200)
      const events = await eventsRes.json() as Array<{ code: string, runId?: string, severity: string }>
      expect(events).toHaveLength(3)
      expect(events.every(event => event.code === 'CHAT_EMPTY_OUTPUT_COMPLETION')).toBe(true)
      expect(events.every(event => event.severity === 'error')).toBe(true)

      const incidentsRes = await hono.request('/observability/incidents?chatSessionId=session-observability&code=CHAT_EMPTY_OUTPUT_COMPLETION')
      expect(incidentsRes.status).toBe(200)
      const incidents = await incidentsRes.json() as Array<{ code: string, status: string, attrs?: { occurrences?: number } }>
      expect(incidents).toHaveLength(1)
      expect(incidents[0]).toEqual(expect.objectContaining({
        code: 'CHAT_EMPTY_OUTPUT_COMPLETION',
        status: 'open',
      }))
      expect(incidents[0].attrs?.occurrences).toBe(3)

      const exportRes = await hono.request(`/observability/export?runId=${encodeURIComponent(finalRunId)}`)
      expect(exportRes.status).toBe(200)
      const bundle = await exportRes.json() as {
        events: Array<{ runId?: string, code: string }>
        incidents: Array<{ runId?: string, code: string }>
        timeline: Array<{ runId: string, eventType: string }>
      }
      expect(bundle.events).toEqual([expect.objectContaining({ runId: finalRunId, code: 'CHAT_EMPTY_OUTPUT_COMPLETION' })])
      expect(bundle.incidents).toEqual([expect.objectContaining({ runId: finalRunId, code: 'CHAT_EMPTY_OUTPUT_COMPLETION' })])
      expect(bundle.timeline.some(event => event.runId === finalRunId && event.eventType === 'run.failed')).toBe(true)
      expect(fetchSpy).toHaveBeenCalledTimes(3)
    }
    finally {
      fetchSpy.mockRestore()
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

  it('records stream failures as events and incidents', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-observability-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'observability-secret'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/chat/completions')) {
        throw new Error('provider stream exploded')
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const accessor = app.getContainer().resolve(DbAccessor) as DbAccessor
      await createProfileAndSession(hono, accessor, workspaceRoot)

      const runRes = await hono.request('/chat/sessions/session-observability/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'explode stream' }),
      })
      expect(runRes.status).toBe(200)
      const run = await runRes.json() as { runId: string }

      const timeline = await waitForLatestAssistantStatus(hono, 'session-observability', 'failed', 1)
      const latestAssistant = timeline.filter(group => group.role === 'assistant').at(-1)
      expect(latestAssistant?.errorText).toContain('provider stream exploded')

      await flushObservability(hono)

      const eventsRes = await hono.request(`/observability/events?runId=${encodeURIComponent(run.runId)}&code=TURN_STREAM_FAILED`)
      expect(eventsRes.status).toBe(200)
      const events = await eventsRes.json() as Array<{ code: string, message: string }>
      expect(events).toEqual([expect.objectContaining({ code: 'TURN_STREAM_FAILED' })])

      const incidentsRes = await hono.request(`/observability/incidents?runId=${encodeURIComponent(run.runId)}&code=TURN_STREAM_FAILED`)
      expect(incidentsRes.status).toBe(200)
      const incidents = await incidentsRes.json() as Array<{ code: string, status: string }>
      expect(incidents).toEqual([expect.objectContaining({ code: 'TURN_STREAM_FAILED', status: 'open' })])
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    }
    finally {
      fetchSpy.mockRestore()
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