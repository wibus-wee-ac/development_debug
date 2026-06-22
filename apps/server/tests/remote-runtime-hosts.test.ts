import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { messages, providerTargets, remoteRuntimeSessionLinks, workspaces } from '@cradle/db'
import {
  encodeRemoteAgentFrame,
  parseRemoteAgentFrame,
  REMOTE_AGENT_PROTOCOL_VERSION,
  type AgentStartParams,
  type RemoteAgentFrame,
  type RemoteAgentSummary,
  type RemoteAgentTurnParams,
} from '@cradle/remote-agent-protocol'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { getRuntimeRegistry } from '../src/modules/chat-runtime/chat-runtime-provider-registry'
import { createRemoteMockProvider } from '../src/modules/chat-runtime-providers/remote-mock/provider'
import { buildSshProfileLaunchConfig } from '../src/modules/remote-runtime-hosts/service'

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

interface FakeDaemonServer {
  socketPath: string
  close(): Promise<void>
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function createAppWithDataDir(dataDir: string): Promise<ElysiaApp> {
  process.env.CRADLE_DATA_DIR = dataDir
  const app = await createServerApp()
  const registry = getRuntimeRegistry()
  if (!registry.get('remote-mock')) {
    registry.register(createRemoteMockProvider({
      readSecret: () => '',
    }))
  }
  return app
}

describe('remote runtime hosts', () => {
  let fakeDaemon: FakeDaemonServer | null = null

  afterEach(async () => {
    await fakeDaemon?.close()
    fakeDaemon = null
    shutdownInfra()
  })

  it('builds OpenSSH launch config from a structured SSH profile', () => {
    expect(buildSshProfileLaunchConfig({
      hostName: '127.0.0.1',
      user: 'me',
      port: 2222,
      auth: 'identityFile',
      identityFilePath: '/tmp/cradle-test-key',
    })).toEqual({
      sshTarget: 'me@127.0.0.1',
      sshArgs: ['-p', '2222', '-i', '/tmp/cradle-test-key'],
    })

    expect(buildSshProfileLaunchConfig({
      hostName: 'devbox',
      user: null,
      port: null,
      auth: 'default',
      identityFilePath: null,
    })).toEqual({
      sshTarget: 'devbox',
      sshArgs: [],
    })
  })

  it('stores host registry rows without writing provider targets', async () => {
    const dataDir = makeTempDir('cradle-remote-hosts-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      app = await createAppWithDataDir(dataDir)
      expect(db().select().from(providerTargets).all()).toHaveLength(0)

      const createRes = await app.handle(new Request('http://localhost/remote-runtime-hosts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'remote-host-a',
          displayName: 'Remote Host A',
          sshTarget: 'devbox',
          remoteSocketPath: '/home/me/.cradle/agentd/agent.sock',
          connectionConfig: { localSocketPath: '/tmp/cradle-agentd-test.sock' },
        }),
      }))
      expect(createRes.status).toBe(200)
      expect(await createRes.json()).toEqual(expect.objectContaining({
        id: 'remote-host-a',
        displayName: 'Remote Host A',
        connectionState: 'idle',
      }))

      const patchRes = await app.handle(new Request('http://localhost/remote-runtime-hosts/remote-host-a', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Remote Host Renamed' }),
      }))
      expect(patchRes.status).toBe(200)
      expect(await patchRes.json()).toEqual(expect.objectContaining({
        displayName: 'Remote Host Renamed',
      }))

      const listRes = await app.handle(new Request('http://localhost/remote-runtime-hosts'))
      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual([
        expect.objectContaining({ id: 'remote-host-a' }),
      ])
      expect(db().select().from(providerTargets).all()).toHaveLength(0)

      const deleteRes = await app.handle(new Request('http://localhost/remote-runtime-hosts/remote-host-a', {
        method: 'DELETE',
      }))
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ ok: true })
      expect(await (await app.handle(new Request('http://localhost/remote-runtime-hosts'))).json()).toEqual([])
      expect(db().select().from(providerTargets).all()).toHaveLength(0)
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('stores structured SSH profiles as remote host config without writing provider targets', async () => {
    const dataDir = makeTempDir('cradle-remote-hosts-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      app = await createAppWithDataDir(dataDir)
      expect(db().select().from(providerTargets).all()).toHaveLength(0)

      const createRes = await app.handle(new Request('http://localhost/remote-runtime-hosts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'remote-host-ssh-profile',
          displayName: 'SSH Profile Host',
          sshProfile: {
            hostName: '127.0.0.1',
            user: 'me',
            port: 2222,
            auth: 'identityFile',
            identityFilePath: '/tmp/cradle-test-key',
          },
          connectTimeoutMs: 5_000,
        }),
      }))
      expect(createRes.status).toBe(200)
      const created = await createRes.json() as {
        sshTarget: string
        remoteSocketPath: string
        connectionConfigJson: string
      }
      expect(created.sshTarget).toBe('me@127.0.0.1')
      expect(created.remoteSocketPath).toBe('~/.cradle/agentd/agent.sock')
      expect(JSON.parse(created.connectionConfigJson)).toEqual({
        transport: 'ssh',
        ssh: {
          hostName: '127.0.0.1',
          user: 'me',
          port: 2222,
          auth: 'identityFile',
          identityFilePath: '/tmp/cradle-test-key',
        },
        connectTimeoutMs: 5_000,
      })
      expect(db().select().from(providerTargets).all()).toHaveLength(0)
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('connects to a daemon over a local Unix socket and lists remote state', async () => {
    const dataDir = makeTempDir('cradle-remote-hosts-')
    const daemonHome = makeTempDir('cradle-fake-agentd-home-')
    const socketPath = join(makeTempDir('cradle-fake-agentd-sock-'), 'agent.sock')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    fakeDaemon = await startFakeDaemon(socketPath)
    let app: ElysiaApp | undefined

    try {
      app = await createAppWithDataDir(dataDir)
      await createRemoteHost(app, {
        hostId: 'remote-host-live',
        socketPath,
      })

      const connectRes = await app.handle(new Request('http://localhost/remote-runtime-hosts/remote-host-live/connect', {
        method: 'POST',
      }))
      expect(connectRes.status).toBe(200)
      expect(await connectRes.json()).toEqual(expect.objectContaining({
        hostId: 'remote-host-live',
        state: 'connected',
        daemonHostId: 'fake-daemon-host',
      }))

      const runtimesRes = await app.handle(new Request('http://localhost/remote-runtime-hosts/remote-host-live/runtimes'))
      expect(runtimesRes.status).toBe(200)
      expect(await runtimesRes.json()).toEqual({
        runtimes: [
          {
            runtimeKind: 'mock-remote',
            label: 'Remote Mock',
            status: 'available',
            detail: null,
          },
        ],
      })

      const agentRes = await app.handle(new Request('http://localhost/remote-runtime-hosts/remote-host-live/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runtimeKind: 'mock-remote',
          workspacePath: daemonHome,
        }),
      }))
      expect(agentRes.status).toBe(200)
      const started = await agentRes.json() as { agent: RemoteAgentSummary }
      expect(started.agent.runtimeKind).toBe('mock-remote')

      const agentsRes = await app.handle(new Request('http://localhost/remote-runtime-hosts/remote-host-live/agents'))
      expect(agentsRes.status).toBe(200)
      expect(await agentsRes.json()).toEqual({
        agents: [expect.objectContaining({ agentId: started.agent.agentId })],
      })
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(daemonHome, { recursive: true, force: true })
      rmSync(dirname(socketPath), { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('streams remote-mock output through normal chat runtime projection', async () => {
    const dataDir = makeTempDir('cradle-remote-chat-')
    const workspaceRoot = makeTempDir('cradle-remote-chat-workspace-')
    const socketPath = join(makeTempDir('cradle-fake-agentd-sock-'), 'agent.sock')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    fakeDaemon = await startFakeDaemon(socketPath)
    let app: ElysiaApp | undefined

    try {
      app = await createAppWithDataDir(dataDir)
      await createRemoteHost(app, {
        hostId: 'remote-host-chat',
        socketPath,
      })

      db().insert(workspaces).values({
        id: 'workspace-remote-chat',
        name: 'Remote Chat Workspace',
        path: workspaceRoot,
      }).run()
      db().insert(providerTargets).values({
        id: 'provider-target-remote-chat',
        kind: 'manual',
        providerKind: 'universal',
        displayName: 'Remote Chat Target',
        connectionConfigJson: JSON.stringify({
          remoteHostId: 'remote-host-chat',
        }),
      }).run()

      const sessionRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'session-remote-chat',
          workspaceId: 'workspace-remote-chat',
          title: 'Remote Chat',
          providerTargetId: 'provider-target-remote-chat',
          runtimeKind: 'remote-mock',
        }),
      }))
      expect(sessionRes.status).toBe(200)

      const response = await app.handle(new Request('http://localhost/chat/sessions/session-remote-chat/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Ping remote daemon' }),
      }))
      expect(response.status).toBe(200)
      await response.text()

      const assistant = await waitForAssistantMessage('session-remote-chat')
      expect(assistant.content).toContain('Remote mock response: Ping remote daemon')
      const link = db()
        .select()
        .from(remoteRuntimeSessionLinks)
        .where(eq(remoteRuntimeSessionLinks.chatSessionId, 'session-remote-chat'))
        .get()
      expect(link).toEqual(expect.objectContaining({
        remoteHostId: 'remote-host-chat',
        remoteRuntimeKind: 'mock-remote',
      }))
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(dirname(socketPath), { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })
})

async function createRemoteHost(
  app: ElysiaApp,
  input: { hostId: string, socketPath: string },
): Promise<void> {
  const res = await app.handle(new Request('http://localhost/remote-runtime-hosts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: input.hostId,
      displayName: input.hostId,
      sshTarget: 'unused-for-local-socket',
      remoteSocketPath: '/unused/agent.sock',
      connectionConfig: {
        localSocketPath: input.socketPath,
        connectTimeoutMs: 3_000,
      },
    }),
  }))
  expect(res.status).toBe(200)
}

async function waitForAssistantMessage(sessionId: string): Promise<typeof messages.$inferSelect> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const row = db()
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all()
      .find(message => message.role === 'assistant')
    if (row?.status === 'complete') {
      return row
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for assistant message in ${sessionId}`)
}

async function startFakeDaemon(socketPath: string): Promise<FakeDaemonServer> {
  mkdirSync(dirname(socketPath), { recursive: true })
  const httpServer = createServer()
  const socketServer = new WebSocketServer({ server: httpServer })
  const sockets = new Set<WebSocket>()
  const agents = new Map<string, RemoteAgentSummary>()

  socketServer.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('message', (raw) => {
      void handleFakeDaemonFrame(socket, agents, raw.toString())
    })
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(socketPath, () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  return {
    socketPath,
    close: async () => {
      for (const socket of sockets) {
        socket.close()
      }
      await new Promise<void>((resolve, reject) => {
        socketServer.close()
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

async function handleFakeDaemonFrame(
  socket: WebSocket,
  agents: Map<string, RemoteAgentSummary>,
  raw: string,
): Promise<void> {
  const frame = parseRemoteAgentFrame(raw)
  if (frame.kind === 'rpc.request') {
    sendFrame(socket, {
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'rpc.response',
      id: frame.id,
      result: handleFakeUnary(frame.method, frame.params, agents),
    })
    return
  }
  if (frame.kind === 'stream.open' && frame.method === 'agent/turn') {
    const params = frame.params as RemoteAgentTurnParams
    const textId = `fake-text-${params.runId}`
    const text = `Remote mock response: ${readMessageText(params.message) || '(empty)'}`
    sendFrame(socket, {
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.next',
      streamId: frame.streamId,
      value: { kind: 'chunk', chunk: { type: 'text-start', id: textId } },
    })
    sendFrame(socket, {
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.next',
      streamId: frame.streamId,
      value: { kind: 'chunk', chunk: { type: 'text-delta', id: textId, delta: text } },
    })
    sendFrame(socket, {
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.next',
      streamId: frame.streamId,
      value: { kind: 'chunk', chunk: { type: 'text-end', id: textId } },
    })
    sendFrame(socket, {
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.next',
      streamId: frame.streamId,
      value: { kind: 'chunk', chunk: { type: 'finish', finishReason: 'stop' } },
    })
    sendFrame(socket, {
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.close',
      streamId: frame.streamId,
    })
  }
}

function handleFakeUnary(
  method: string,
  params: unknown,
  agents: Map<string, RemoteAgentSummary>,
): unknown {
  switch (method) {
    case 'host/hello':
      return {
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        daemonVersion: 'fake-0.1.0',
        hostId: 'fake-daemon-host',
        platform: process.platform,
        arch: process.arch,
        supportedMethods: [
          'host/hello',
          'host/health',
          'runtime/list',
          'workspace/list',
          'agent/list',
          'agent/start',
          'agent/attach',
          'agent/cancel',
          'agent/steer',
          'agent/turn',
        ],
      }
    case 'host/health':
      return {
        status: 'ok',
        daemonVersion: 'fake-0.1.0',
        hostId: 'fake-daemon-host',
        uptimeSeconds: 1,
      }
    case 'runtime/list':
      return {
        runtimes: [
          {
            runtimeKind: 'mock-remote',
            label: 'Remote Mock',
            status: 'available',
            detail: null,
          },
        ],
      }
    case 'workspace/list':
      return { workspaces: [], message: null }
    case 'agent/list':
      return { agents: Array.from(agents.values()) }
    case 'agent/start': {
      const input = params as AgentStartParams
      const now = Date.now()
      const agent: RemoteAgentSummary = {
        agentId: randomUUID(),
        runtimeKind: input.runtimeKind,
        workspacePath: input.workspacePath,
        status: 'idle',
        providerSessionId: null,
        createdAt: now,
        updatedAt: now,
      }
      agents.set(agent.agentId, agent)
      return { agent }
    }
    case 'agent/attach': {
      const remoteAgentId = (params as { remoteAgentId: string }).remoteAgentId
      const agent = agents.get(remoteAgentId)
      if (!agent) {
        throw new Error(`missing fake agent ${remoteAgentId}`)
      }
      return { agent }
    }
    case 'agent/cancel':
      return { cancelled: true }
    case 'agent/steer':
      return { accepted: true }
    default:
      throw new Error(`unsupported fake method ${method}`)
  }
}

function sendFrame(socket: WebSocket, frame: RemoteAgentFrame): void {
  socket.send(encodeRemoteAgentFrame(frame))
}

function readMessageText(message: UIMessage): string {
  return message.parts
    .map((part) => {
      if (typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string') {
        return part.text
      }
      return ''
    })
    .join('')
    .trim()
}
