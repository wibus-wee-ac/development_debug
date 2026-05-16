// Input: session capability HTTP endpoints
// Output: integration tests for session CRUD, messages, and export
// Position: apps/server/tests

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  agents,
  agentProfiles,
  backendRuns,
  backendSessionBindings,
  backendTimelineEvents,
  messages,
  workspaces,
} from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

const TIMELINE_SCHEMA_VERSION = 'cradle.timeline.v1'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('session capability', () => {
  it('supports CRUD, patch updates, messages, and export', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      const d = db()

      const workspaceId = randomUUID()
      const agentProfileId = randomUUID()
      d.insert(workspaces).values({
        id: workspaceId,
        name: 'Workspace',
        path: workspaceRoot,
      }).run()
      d.insert(agentProfiles).values({
        id: agentProfileId,
        name: 'Test Agent',
        providerKind: 'openai-compatible',
      }).run()

      const sessionId = randomUUID()
      const createRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: sessionId,
          workspaceId,
          title: 'Chat',
          agentProfileId,
        }),
      }))
      expect(createRes.status).toBe(200)
      const created = await createRes.json()
      expect(created).toEqual(expect.objectContaining({
        id: sessionId,
        workspaceId,
        title: 'Chat',
        agentProfileId,
        modelId: null,
      }))
      expect(created.createdAt).toBeTypeOf('number')
      expect(created.updatedAt).toBeTypeOf('number')

      const listRes = await app.handle(new Request(`http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}`))
      const list = await listRes.json()
      expect(list).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: sessionId, modelId: null }),
      ]))

      const getRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}`))
      expect(await getRes.json()).toEqual(expect.objectContaining({ id: sessionId, modelId: null }))

      const missingGet = await app.handle(new Request('http://localhost/sessions/missing'))
      expect(missingGet.status).toBe(404)

      const updateRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed Chat' }),
      }))
      expect(updateRes.status).toBe(200)
      expect(await updateRes.json()).toEqual(expect.objectContaining({ title: 'Renamed Chat' }))

      const updated = await (await app.handle(new Request(`http://localhost/sessions/${sessionId}`))).json()
      expect(updated.title).toBe('Renamed Chat')

      const pinRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pinned: true }),
      }))
      expect(await pinRes.json()).toEqual(expect.objectContaining({ pinned: 1 }))

      const unpinRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pinned: false }),
      }))
      expect(await unpinRes.json()).toEqual(expect.objectContaining({ pinned: 0 }))

      const missingPin = await app.handle(new Request('http://localhost/sessions/missing', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pinned: true }),
      }))
      expect(missingPin.status).toBe(404)
      expect((await missingPin.json()).code).toBe('session_not_found')

      const userMessageId = randomUUID()
      const assistantMessageId = randomUUID()
      const now = Math.floor(Date.now() / 1000)
      d.insert(messages).values([
        {
          id: userMessageId,
          sessionId,
          role: 'user',
          status: 'complete',
          content: 'Hello',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: assistantMessageId,
          sessionId,
          role: 'assistant',
          status: 'complete',
          content: 'Fallback',
          createdAt: now + 1,
          updatedAt: now + 1,
        },
      ]).run()

      const messagesRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}/messages`))
      const msgs = await messagesRes.json()
      expect(msgs).toEqual([
        expect.objectContaining({ id: userMessageId, role: 'user' }),
        expect.objectContaining({ id: assistantMessageId, role: 'assistant' }),
      ])

      const bindingId = randomUUID()
      d.insert(backendSessionBindings).values({
        id: bindingId,
        chatSessionId: sessionId,
        agentProfileId,
        runtimeKind: 'standard',
        requestedModelId: 'gpt-test',
      }).run()

      const getWithBindingRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}`))
      expect(await getWithBindingRes.json()).toEqual(expect.objectContaining({
        id: sessionId,
        modelId: 'gpt-test',
      }))

      const cliAgentId = randomUUID()
      d.insert(agents).values({
        id: cliAgentId,
        name: 'CLI Agent',
        avatarStyle: 'bottts-neutral',
        avatarSeed: 'cli-seed',
        agentProfileId: null,
        runtimeKind: 'cli-tui',
        configJson: JSON.stringify({
          cliTui: {
            preset: 'claude-code',
            executable: 'claude',
            args: ['--print'],
          },
        }),
      }).run()

      const cliSessionRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          title: 'CLI Session',
          agentId: cliAgentId,
        }),
      }))
      expect(cliSessionRes.status).toBe(200)
      expect(await cliSessionRes.json()).toEqual(expect.objectContaining({
        agentId: cliAgentId,
        agentProfileId: null,
        runtimeKind: 'cli-tui',
      }))

      const runId = randomUUID()
      d.insert(backendRuns).values({
        id: runId,
        bindingId,
        chatSessionId: sessionId,
        messageId: assistantMessageId,
        origin: 'user',
        status: 'complete',
        startedAt: now,
        finishedAt: now + 1,
      }).run()

      const sourceJson = JSON.stringify({
        backend: 'openai-compatible',
        eventType: 'response',
        eventId: null,
        itemId: null,
      })
      d.insert(backendTimelineEvents).values([
        {
          id: randomUUID(),
          runId,
          chatSessionId: sessionId,
          sequenceNumber: 1,
          eventType: 'assistant.text.delta',
          schemaVersion: TIMELINE_SCHEMA_VERSION,
          payloadJson: JSON.stringify({ itemId: 'item-1', delta: 'Hello ' }),
          sourceJson,
          createdAt: now,
        },
        {
          id: randomUUID(),
          runId,
          chatSessionId: sessionId,
          sequenceNumber: 2,
          eventType: 'assistant.text.delta',
          schemaVersion: TIMELINE_SCHEMA_VERSION,
          payloadJson: JSON.stringify({ itemId: 'item-1', delta: 'world' }),
          sourceJson,
          createdAt: now + 1,
        },
      ]).run()

      const exportRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}/export/markdown`))
      const exportBody = await exportRes.json()
      expect(exportBody.markdown).toContain('# Renamed Chat')
      expect(exportBody.markdown).toContain('Model: gpt-test')
      expect(exportBody.markdown).toContain('## User')
      expect(exportBody.markdown).toContain('Hello')
      expect(exportBody.markdown).toContain('## Assistant')
      expect(exportBody.markdown).toContain('Hello world')

      const invalidCreate = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      }))
      expect(invalidCreate.status).toBe(400)
      const invalidBody = await invalidCreate.json()
      expect(invalidBody.code).toBe('validation_error')

      const deleteRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}`, { method: 'DELETE' }))
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ ok: true })

      const afterList = await (await app.handle(new Request(`http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}`))).json()
      expect(afterList).toEqual([
        expect.objectContaining({ id: expect.any(String), runtimeKind: 'cli-tui', agentId: cliAgentId }),
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
    }
  })
})
