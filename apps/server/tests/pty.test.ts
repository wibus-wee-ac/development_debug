// Input: terminal session HTTP endpoints
// Output: integration tests for session-bound cli-tui terminal runtime, streaming, input, and cleanup
// Position: apps/server/tests

import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'
import { DbAccessor } from '../src/database/db-accessor'

type HonoApp = Awaited<ReturnType<typeof createConfiguredApp>> extends { getInstance: () => infer T } ? T : never

const TERMINAL_FIXTURE_SCRIPT = [
  'process.stdout.write(\'READY\\n\')',
  'process.stdin.setEncoding(\'utf8\')',
  'process.stdin.on(\'data\', (chunk) => { process.stdout.write(\'ECHO:\' + chunk.toString()) })',
  'process.stdin.resume()',
  'setInterval(() => {}, 1000)',
].join(';')

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function createCliTuiSession(hono: HonoApp, accessor: DbAccessor, workspaceRoot: string) {
  accessor.get().insert(workspaces).values({
    id: 'workspace-pty',
    name: 'Workspace Pty',
    path: workspaceRoot,
  }).run()

  const profileRes = await hono.request('/profiles/profile-cli-tui', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'CLI TUI Profile',
      providerKind: 'cli-tui',
      enabled: true,
      config: {
        executable: process.execPath,
        args: ['-e', TERMINAL_FIXTURE_SCRIPT],
      },
      credentialRef: null,
    }),
  })
  expect(profileRes.status).toBe(200)

  const sessionRes = await hono.request('/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'session-cli-tui',
      workspaceId: 'workspace-pty',
      title: 'CLI Session',
      agentProfileId: 'profile-cli-tui',
    }),
  })
  expect(sessionRes.status).toBe(200)
}

async function readSseEvent(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{ type: string, data?: string, exitCode?: number | null }> {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      throw new Error('SSE stream closed before next event')
    }
    buffer += decoder.decode(value, { stream: true })
    const boundary = buffer.indexOf('\n\n')
    if (boundary === -1) {
      continue
    }
    const chunk = buffer.slice(0, boundary)
    buffer = buffer.slice(boundary + 2)
    const dataLine = chunk.split('\n').find(line => line.startsWith('data: '))
    if (!dataLine) {
      continue
    }
    return JSON.parse(dataLine.slice(6)) as { type: string, data?: string, exitCode?: number | null }
  }
}

describe('pty capability', () => {
  it('starts a cli-tui terminal session, replays buffered output, accepts input, and stops cleanly', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const accessor = app.getContainer().resolve(DbAccessor) as DbAccessor
      await createCliTuiSession(hono, accessor, workspaceRoot)

      const startRes = await hono.request('/terminal-sessions/session-cli-tui/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      })
      expect(startRes.status).toBe(200)
      expect(await startRes.json()).toEqual({ sessionId: 'session-cli-tui', running: true })

      const streamRes = await hono.request('/terminal-sessions/session-cli-tui/stream')
      expect(streamRes.status).toBe(200)
      const reader = streamRes.body?.getReader()
      expect(reader).toBeTruthy()

      const firstEvent = await readSseEvent(reader!)
      expect(firstEvent).toEqual(expect.objectContaining({ type: 'terminal.buffer' }))
      expect(firstEvent.data).toContain('READY')

      const attachAgainRes = await hono.request('/terminal-sessions/session-cli-tui/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 100, rows: 30 }),
      })
      expect(attachAgainRes.status).toBe(200)

      const inputRes = await hono.request('/terminal-sessions/session-cli-tui/input', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: 'hello from test\n' }),
      })
      expect(inputRes.status).toBe(200)
      expect(await inputRes.json()).toEqual({ ok: true })

      let echoEvent = await readSseEvent(reader!)
      while (!echoEvent.data?.includes('ECHO:hello from test')) {
        echoEvent = await readSseEvent(reader!)
      }
      expect(echoEvent.type).toBe('terminal.data')

      const stopRes = await hono.request('/terminal-sessions/session-cli-tui', { method: 'DELETE' })
      expect(stopRes.status).toBe(200)
      expect(await stopRes.json()).toEqual({ ok: true })

      let exitEvent = await readSseEvent(reader!)
      while (exitEvent.type !== 'terminal.exit') {
        exitEvent = await readSseEvent(reader!)
      }
      expect(exitEvent.type).toBe('terminal.exit')
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
    }
  })

  it('stops the terminal when the chat session is deleted', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const accessor = app.getContainer().resolve(DbAccessor) as DbAccessor
      await createCliTuiSession(hono, accessor, workspaceRoot)

      await hono.request('/terminal-sessions/session-cli-tui/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      })

      const streamRes = await hono.request('/terminal-sessions/session-cli-tui/stream')
      const reader = streamRes.body?.getReader()
      expect(reader).toBeTruthy()
      await readSseEvent(reader!)

      const deleteSessionRes = await hono.request('/sessions/session-cli-tui', { method: 'DELETE' })
      expect(deleteSessionRes.status).toBe(200)

      let exitEvent = await readSseEvent(reader!)
      while (exitEvent.type !== 'terminal.exit') {
        exitEvent = await readSseEvent(reader!)
      }
      expect(exitEvent.type).toBe('terminal.exit')
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
    }
  })

  it('stops the terminal and deletes the chat session when the owning agent profile is deleted', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const accessor = app.getContainer().resolve(DbAccessor) as DbAccessor
      await createCliTuiSession(hono, accessor, workspaceRoot)

      const startRes = await hono.request('/terminal-sessions/session-cli-tui/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      })
      expect(startRes.status).toBe(200)

      const streamRes = await hono.request('/terminal-sessions/session-cli-tui/stream')
      const reader = streamRes.body?.getReader()
      expect(reader).toBeTruthy()
      await readSseEvent(reader!)

      const deleteProfileRes = await hono.request('/profiles/profile-cli-tui', { method: 'DELETE' })
      expect(deleteProfileRes.status).toBe(200)
      expect(await deleteProfileRes.json()).toEqual({ ok: true })

      let exitEvent = await readSseEvent(reader!)
      while (exitEvent.type !== 'terminal.exit') {
        exitEvent = await readSseEvent(reader!)
      }
      expect(exitEvent.type).toBe('terminal.exit')

      const deletedSession = accessor.get().select().from(sessions).where(eq(sessions.id, 'session-cli-tui')).get()
      expect(deletedSession).toBeUndefined()
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
    }
  })

  it('returns structured errors for invalid input and unsupported sessions', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const accessor = app.getContainer().resolve(DbAccessor) as DbAccessor
      accessor.get().insert(workspaces).values({
        id: 'workspace-pty',
        name: 'Workspace Pty',
        path: workspaceRoot,
      }).run()

      const nonCliProfileRes = await hono.request('/profiles/profile-chat-like', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'OpenAI Compatible',
          providerKind: 'openai-compatible',
          enabled: true,
          config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o-mini' },
          credentialRef: null,
        }),
      })
      expect(nonCliProfileRes.status).toBe(200)

      const sessionRes = await hono.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'session-non-cli',
          workspaceId: 'workspace-pty',
          title: 'Non CLI Session',
          agentProfileId: 'profile-chat-like',
        }),
      })
      expect(sessionRes.status).toBe(200)

      const missingSession = await hono.request('/terminal-sessions/missing/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      })
      expect(missingSession.status).toBe(404)
      expect((await missingSession.json()).code).toBe('terminal_session_not_found')

      const invalidInput = await hono.request('/terminal-sessions/session-non-cli/input', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(invalidInput.status).toBe(400)
      expect((await invalidInput.json()).code).toBe('invalid_terminal_input')

      const unsupportedProfile = await hono.request('/terminal-sessions/session-non-cli/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      })
      expect(unsupportedProfile.status).toBe(409)
      expect((await unsupportedProfile.json()).code).toBe('terminal_profile_not_supported')
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
    }
  })
})
