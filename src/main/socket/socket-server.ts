// Input: node:net, node:readline, node:fs, node:path, electron app
// Output: startSocketServer / stopSocketServer — JSON-RPC 2.0 over Unix domain socket
// Position: Main-process infrastructure, started after createServices()

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import readline from 'node:readline'

import { app } from 'electron'

// ── State ─────────────────────────────────────────────────────────────────────

let server: net.Server | null = null
let socketPath: string | null = null

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\cradle-rpc'
  }
  return path.join(app.getPath('userData'), 'cradle.sock')
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string | null
  method: string
  params?: unknown[]
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number, message: string, data?: unknown }
}

function makeError(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function makeResult(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

// ── Server ────────────────────────────────────────────────────────────────────

export function startSocketServer(services: Record<string, object>): net.Server {
  socketPath = getSocketPath()

  // Clean up stale socket file from previous crash
  if (process.platform !== 'win32') {
    try {
      fs.unlinkSync(socketPath)
    }
    catch {
      // File doesn't exist — fine
    }
  }

  server = net.createServer((conn) => {
    const rl = readline.createInterface({ input: conn })

    rl.on('line', async (line) => {
      let request: JsonRpcRequest
      try {
        request = JSON.parse(line) as JsonRpcRequest
      }
      catch {
        conn.write(`${JSON.stringify(makeError(null, -32700, 'Parse error'))}\n`)
        return
      }

      const { id, method, params = [] } = request

      if (!method || typeof method !== 'string') {
        conn.write(`${JSON.stringify(makeError(id, -32600, 'Invalid Request'))}\n`)
        return
      }

      const dotIdx = method.indexOf('.')
      if (dotIdx < 0) {
        conn.write(`${JSON.stringify(makeError(id, -32601, `Invalid method format: ${method}`))}\n`)
        return
      }

      const groupName = method.slice(0, dotIdx)
      const methodName = method.slice(dotIdx + 1)
      const service = services[groupName] as Record<string, unknown> | undefined

      if (!service || typeof service[methodName] !== 'function') {
        conn.write(`${JSON.stringify(makeError(id, -32601, `Method not found: ${method}`))}\n`)
        return
      }

      try {
        const fn = service[methodName] as (...args: unknown[]) => unknown
        const result = await fn.call(service, ...params)
        conn.write(`${JSON.stringify(makeResult(id, result))}\n`)
      }
      catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        conn.write(`${JSON.stringify(makeError(id, -32000, message))}\n`)
      }
    })

    conn.on('error', () => {
      // Client disconnected
    })
  })

  server.listen(socketPath, () => {
    // Socket server ready
  })

  server.on('error', (err) => {
    console.error('[SocketServer] Server error:', err)
  })

  return server
}

export function stopSocketServer(): void {
  if (server) {
    server.close()
    server = null
  }
  if (socketPath && process.platform !== 'win32') {
    try {
      fs.unlinkSync(socketPath)
    }
    catch {
      // Already cleaned
    }
    socketPath = null
  }
}
