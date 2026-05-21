import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  agentProfiles,
  agents,
  backendRuns,
  backendSessionBindings,
  messages,
  workspaces,
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { createPending, generatePolicyKeys, isPreviouslyAllowed, listPending, markAllowed } from '../src/modules/approval/service'
import { ptyTimeline } from '../src/modules/pty/pty.timeline'
import { startOrAttach } from '../src/modules/pty/service'
import { indexMessage, searchThreads } from '../src/modules/search/service'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function waitForCondition(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`)
}

describe('session capability', () => {
  it('supports CRUD, patch updates, messages, and export', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
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
        agentId: expect.any(String),
        modelId: null,
      }))
      const defaultAgent = d.select().from(agents).where(eq(agents.id, created.agentId)).get()
      expect(defaultAgent).toEqual(expect.objectContaining({
        name: 'Test Agent',
        agentProfileId,
        runtimeKind: 'standard',
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
          messageJson: JSON.stringify({ id: userMessageId, role: 'user', parts: [{ type: 'text', text: 'Hello' }] }),
          createdAt: now,
          updatedAt: now,
        },
        {
          id: assistantMessageId,
          sessionId,
          role: 'assistant',
          status: 'complete',
          content: 'Hello world',
          messageJson: JSON.stringify({ id: assistantMessageId, role: 'assistant', parts: [{ type: 'text', text: 'Hello world' }] }),
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

  it('deletes session-owned search, approvals, and cli-tui pty state', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()

      const workspaceId = randomUUID()
      d.insert(workspaces).values({
        id: workspaceId,
        name: 'Workspace',
        path: workspaceRoot,
      }).run()

      const agentId = randomUUID()
      d.insert(agents).values({
        id: agentId,
        name: 'CLI Agent',
        avatarStyle: 'bottts-neutral',
        avatarSeed: 'cleanup-seed',
        agentProfileId: null,
        runtimeKind: 'cli-tui',
        configJson: JSON.stringify({
          cliTui: {
            executable: process.execPath,
            args: ['-e', 'setInterval(() => {}, 1000)'],
          },
        }),
      }).run()

      const sessionId = randomUUID()
      const createRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: sessionId,
          workspaceId,
          title: 'CLI Cleanup Session',
          agentId,
        }),
      }))
      expect(createRes.status).toBe(200)

      startOrAttach({ sessionId, cols: 80, rows: 24 })
      expect(ptyTimeline.hasSession(sessionId)).toBe(true)

      const approval = createPending({
        chatSessionId: sessionId,
        agentId,
        prompt: 'Allow tool "bash"?',
        options: [
          { optionId: 'approve', label: 'Approve' },
          { optionId: 'deny', label: 'Deny' },
        ],
      })
      expect(listPending({ chatSessionId: sessionId })).toEqual([
        expect.objectContaining({ id: approval.id, chatSessionId: sessionId }),
      ])

      const policyKeys = generatePolicyKeys({
        runtimeKind: 'claude-agent',
        chatSessionId: sessionId,
        toolName: 'bash',
      })
      markAllowed(sessionId, policyKeys)
      expect(isPreviouslyAllowed(sessionId, policyKeys)).toBe(true)

      const messageId = randomUUID()
      const now = Math.floor(Date.now() / 1000)
      d.insert(messages).values({
        id: messageId,
        sessionId,
        role: 'assistant',
        status: 'complete',
        content: 'cleanup sentinel text',
        messageJson: JSON.stringify({
          id: messageId,
          role: 'assistant',
          parts: [{ type: 'text', text: 'cleanup sentinel text' }],
        }),
        createdAt: now,
        updatedAt: now,
      }).run()
      indexMessage(sessionId, 'CLI Cleanup Session', messageId, 'cleanup sentinel text')
      expect(searchThreads({ query: 'cleanup sentinel' })).toEqual([
        expect.objectContaining({ sessionId }),
      ])

      const deleteRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}`, { method: 'DELETE' }))
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ ok: true })

      await waitForCondition(() => !ptyTimeline.hasSession(sessionId))
      expect(listPending({ chatSessionId: sessionId })).toEqual([])
      expect(isPreviouslyAllowed(sessionId, policyKeys)).toBe(false)
      expect(searchThreads({ query: 'cleanup sentinel' })).toEqual([])
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
