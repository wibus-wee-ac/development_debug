// Input: unified chat runtime HTTP endpoints with mocked ACP SDK + subprocess layer
// Output: integration tests for ACP chat execution, approvals, title sync, and usage writes
// Position: apps/server/tests

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { workspaces } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

const acpMocks = vi.hoisted(() => {
  let client: {
    requestPermission: (params: unknown) => Promise<unknown>
    sessionUpdate: (params: unknown) => Promise<void>
  } | null = null

  return {
    initialize: vi.fn(),
    newSession: vi.fn(),
    loadSession: vi.fn(),
    resumeSession: vi.fn(),
    prompt: vi.fn(),
    cancel: vi.fn(),
    setSessionModel: vi.fn(),
    setSessionConfigOption: vi.fn(),
    spawn: vi.fn(),
    setClient(next: typeof client) {
      client = next
    },
    getClient() {
      return client
    },
  }
})

vi.mock('@agentclientprotocol/sdk', () => {
  class FakeClientSideConnection {
    closed = new Promise<void>(() => {})

    constructor(createClient: (agent: unknown) => unknown) {
      acpMocks.setClient(createClient({}) as {
        requestPermission: (params: unknown) => Promise<unknown>
        sessionUpdate: (params: unknown) => Promise<void>
      })
    }

    initialize = (...args: unknown[]) => acpMocks.initialize(...args)
    newSession = (...args: unknown[]) => acpMocks.newSession(...args)
    loadSession = (...args: unknown[]) => acpMocks.loadSession(...args)
    unstable_resumeSession = (...args: unknown[]) => acpMocks.resumeSession(...args)
    prompt = (...args: unknown[]) => acpMocks.prompt(...args)
    cancel = (...args: unknown[]) => acpMocks.cancel(...args)
    unstable_setSessionModel = (...args: unknown[]) => acpMocks.setSessionModel(...args)
    setSessionConfigOption = (...args: unknown[]) => acpMocks.setSessionConfigOption(...args)
  }

  return {
    ClientSideConnection: FakeClientSideConnection,
    PROTOCOL_VERSION: '2025-draft',
    ndJsonStream: () => ({ readable: new ReadableStream(), writable: new WritableStream() }),
  }
})

vi.mock('node:child_process', async () => {
  const { PassThrough } = await import('node:stream')

  class FakeChildProcess extends PassThrough {
    readonly stdin = new PassThrough()
    readonly stdout = new PassThrough()
    readonly stderr = new PassThrough()
    readonly pid = 4242
    exitCode: number | null = null

    kill(_signal?: string): boolean {
      this.exitCode = 0
      this.emit('exit', 0, null)
      return true
    }
  }

  return {
    spawn: (...args: unknown[]) => acpMocks.spawn(...args),
    ChildProcess: FakeChildProcess,
  }
})

interface ChatMessageSnapshot {
  messageId: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText?: string
  content: string
  message: {
    parts: Array<{ type: string, text?: string, state?: string, toolCallId?: string, output?: unknown, errorText?: string }>
  }
}

type ElysiaApp = ReturnType<typeof createServerApp>

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function createAcpProfileAndSession(app: ElysiaApp, workspaceId: string) {
  const profileRes = await app.handle(new Request('http://localhost/profiles/profile-acp', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'ACP Runtime Profile',
      providerKind: 'openai-compatible',
      enabled: true,
      config: { distributionType: 'npx', cmd: '@demo/acp-agent', args: ['--stdio'] },
      credentialRef: null,
    }),
  }))
  expect(profileRes.status).toBe(200)

  const sessionRes = await app.handle(new Request('http://localhost/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'session-acp',
      workspaceId,
      title: 'ACP Runtime Session',
      agentProfileId: 'profile-acp',
      runtimeKind: 'acp-chat',
    }),
  }))
  expect(sessionRes.status).toBe(200)
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

async function waitForPendingApproval(app: ElysiaApp, chatSessionId: string): Promise<{ id: string, prompt: string, options: Array<{ optionId: string }> }> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.handle(new Request(`http://localhost/approvals?chatSessionId=${encodeURIComponent(chatSessionId)}`))
    if (response.status === 200) {
      const approvals = await response.json() as Array<{ id: string, prompt: string, options: Array<{ optionId: string }> }>
      if (approvals.length > 0) {
        return approvals[0]
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  throw new Error('Timed out waiting for ACP approval request')
}

describe('acp chat runtime capability', () => {
  beforeEach(() => {
    acpMocks.setClient(null)
    acpMocks.initialize.mockReset()
    acpMocks.newSession.mockReset()
    acpMocks.loadSession.mockReset()
    acpMocks.resumeSession.mockReset()
    acpMocks.prompt.mockReset()
    acpMocks.cancel.mockReset()
    acpMocks.setSessionModel.mockReset()
    acpMocks.setSessionConfigOption.mockReset()
    acpMocks.spawn.mockReset()

    acpMocks.initialize.mockResolvedValue({
      protocolVersion: '1.0',
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {} },
      },
    })
    acpMocks.newSession.mockResolvedValue({
      sessionId: 'acp-session-1',
      models: {
        currentModelId: 'acp-model',
        availableModels: [{ modelId: 'acp-model', name: 'ACP Model' }],
      },
      configOptions: [],
    })
    acpMocks.loadSession.mockResolvedValue({ models: null, configOptions: [] })
    acpMocks.resumeSession.mockResolvedValue({ models: null, configOptions: [] })
    acpMocks.cancel.mockResolvedValue(undefined)
    acpMocks.setSessionModel.mockResolvedValue(undefined)
    acpMocks.setSessionConfigOption.mockResolvedValue({ configOptions: [] })
    acpMocks.spawn.mockImplementation(() => {
      const proc = new PassThrough() as PassThrough & {
        stdin: PassThrough
        stdout: PassThrough
        stderr: PassThrough
        pid: number
        exitCode: number | null
        kill: (_signal?: string) => boolean
      }
      proc.stdin = new PassThrough()
      proc.stdout = new PassThrough()
      proc.stderr = new PassThrough()
      proc.pid = 4242
      proc.exitCode = null
      proc.kill = () => {
        proc.exitCode = 0
        proc.emit('exit', 0, null)
        return true
      }
      return proc
    })

    acpMocks.prompt.mockImplementation(async ({ sessionId }: { sessionId: string }) => {
      const client = acpMocks.getClient()
      if (!client) {
        throw new Error('ACP client bridge not initialized')
      }

      await client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'session_info_update',
          title: 'ACP Session Renamed',
        },
      })

      await client.requestPermission({
        sessionId,
        toolCall: { title: 'Write workspace file' },
        options: [
          { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject_once', name: 'Reject once', kind: 'reject_once' },
        ],
      })

      await client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Thinking...' },
        },
      })
      await client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello from ACP runtime' },
        },
      })

      return {
        usage: {
          inputTokens: 7,
          outputTokens: 4,
          totalTokens: 11,
        },
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs an ACP turn through server chat-runtime, routes approvals, syncs titles, and writes usage', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-acp',
        name: 'Workspace ACP',
        path: workspaceRoot,
      }).run()

      await createAcpProfileAndSession(app, 'workspace-acp')

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-acp/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Explain ACP runtime ownership' }),
      }))
      expect(runRes.status).toBe(200)

      const approval = await waitForPendingApproval(app, 'session-acp')
      expect(approval.prompt).toBe('Write workspace file')

      const respondRes = await app.handle(new Request(`http://localhost/approvals/${encodeURIComponent(approval.id)}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision: 'approved',
          selectedOptionId: approval.options[0]!.optionId,
        }),
      }))
      expect(respondRes.status).toBe(200)
      expect(await respondRes.json()).toEqual({ ok: true })

      const timeline = await waitForMessageStatus(app, 'session-acp', 'complete')
      expect(timeline).toHaveLength(2)
      expect(timeline[0]).toEqual(expect.objectContaining({
        role: 'user',
        content: 'Explain ACP runtime ownership',
        status: 'complete',
      }))

      const assistant = timeline[1]
      expect(assistant).toEqual(expect.objectContaining({ role: 'assistant', status: 'complete' }))
      expect(assistant.content).toBe('Hello from ACP runtime')
      expect(assistant.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'reasoning', text: 'Thinking...', state: 'done' }),
        expect.objectContaining({ type: 'text', text: 'Hello from ACP runtime', state: 'done' }),
      ]))

      const sessionRes = await app.handle(new Request('http://localhost/sessions/session-acp'))
      expect(sessionRes.status).toBe(200)
      expect((await sessionRes.json()).title).toBe('ACP Session Renamed')

      const approvalsAfterRes = await app.handle(new Request('http://localhost/approvals?chatSessionId=session-acp'))
      expect(approvalsAfterRes.status).toBe(200)
      expect(await approvalsAfterRes.json()).toEqual([])

      const usageRes = await app.handle(new Request('http://localhost/usage/sessions/session-acp'))
      expect(usageRes.status).toBe(200)
      expect(await usageRes.json()).toEqual(expect.objectContaining({
        promptTokens: 7,
        completionTokens: 4,
        totalTokens: 11,
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
    }
  })
})
