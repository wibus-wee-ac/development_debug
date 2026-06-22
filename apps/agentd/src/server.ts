import { mkdirSync, chmodSync, existsSync, unlinkSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createConnection } from 'node:net'
import { dirname } from 'node:path'

import {
  createRemoteAgentError,
  encodeRemoteAgentFrame,
  parseRemoteAgentFrame,
  REMOTE_AGENT_PROTOCOL_VERSION,
  type RemoteAgentFrame,
} from '@cradle/remote-agent-protocol'
import { WebSocket, WebSocketServer } from 'ws'

import { AgentdDaemon } from './daemon'

export interface AgentdServerOptions {
  socketPath: string
  homeDir: string
}

export interface AgentdServer {
  socketPath: string
  close: () => Promise<void>
}

export async function startAgentdServer(options: AgentdServerOptions): Promise<AgentdServer> {
  mkdirSync(dirname(options.socketPath), { recursive: true })
  await removeStaleSocket(options.socketPath)

  const httpServer = createServer()
  const socketServer = new WebSocketServer({ server: httpServer })
  const daemon = new AgentdDaemon({ homeDir: options.homeDir })

  socketServer.on('connection', (socket) => {
    bindSocket(socket, daemon)
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(options.socketPath, () => {
      httpServer.off('error', reject)
      try {
        chmodSync(options.socketPath, 0o600)
      }
      catch {
        // Best effort on platforms that support Unix socket chmod.
      }
      resolve()
    })
  })

  return {
    socketPath: options.socketPath,
    close: async () => {
      await closeServer(socketServer, httpServer)
    },
  }
}

function bindSocket(socket: WebSocket, daemon: AgentdDaemon): void {
  socket.on('message', (raw) => {
    void handleSocketMessage(socket, daemon, raw)
  })
}

async function handleSocketMessage(socket: WebSocket, daemon: AgentdDaemon, raw: Buffer | string): Promise<void> {
  let frame: RemoteAgentFrame
  try {
    frame = parseRemoteAgentFrame(raw.toString())
  }
  catch (error) {
    send(socket, {
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'notification',
      method: 'protocol/error',
      params: createRemoteAgentError('invalid_frame', 'Invalid remote agent frame', String(error)),
    })
    return
  }

  try {
    if (frame.kind === 'rpc.request') {
      const result = await daemon.handleUnary(frame.method, frame.params)
      send(socket, {
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        kind: 'rpc.response',
        id: frame.id,
        result,
      })
      return
    }

    if (frame.kind === 'stream.open') {
      for await (const value of daemon.handleStream(frame.method, frame.params)) {
        send(socket, {
          protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
          kind: 'stream.next',
          streamId: frame.streamId,
          value,
        })
      }
      send(socket, {
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        kind: 'stream.close',
        streamId: frame.streamId,
      })
    }
  }
  catch (error) {
    const payload = createRemoteAgentError(
      'request_failed',
      error instanceof Error ? error.message : String(error),
    )
    if (frame.kind === 'rpc.request') {
      send(socket, {
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        kind: 'rpc.error',
        id: frame.id,
        error: payload,
      })
      return
    }
    if (frame.kind === 'stream.open') {
      send(socket, {
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        kind: 'stream.error',
        streamId: frame.streamId,
        error: payload,
      })
    }
  }
}

function send(socket: WebSocket, frame: RemoteAgentFrame): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(encodeRemoteAgentFrame(frame))
  }
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  if (!existsSync(socketPath)) {
    return
  }
  const live = await canConnect(socketPath)
  if (live) {
    throw new Error(`Agent daemon socket is already in use: ${socketPath}`)
  }
  unlinkSync(socketPath)
}

function canConnect(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      resolve(false)
    })
  })
}

function closeServer(socketServer: WebSocketServer, httpServer: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    socketServer.close()
    httpServer.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}
