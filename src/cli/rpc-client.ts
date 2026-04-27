// Input: net module, os/path for socket path resolution
// Output: rpcCall function for JSON-RPC 2.0 communication over Unix domain socket
// Position: CLI utility — RPC transport layer for Cradle socket server

import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

function getSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\cradle-rpc'
  }
  const appName = 'Cradle'
  let userDataDir: string
  if (process.platform === 'darwin') {
    userDataDir = path.join(os.homedir(), 'Library', 'Application Support', appName)
  }
  else {
    userDataDir = path.join(os.homedir(), '.config', appName)
  }
  return path.join(userDataDir, 'cradle.sock')
}

let requestId = 0

export async function rpcCall(method: string, params: unknown[] = []): Promise<unknown> {
  const socketPath = getSocketPath()
  return new Promise((resolve, reject) => {
    const id = ++requestId
    const client = net.createConnection({ path: socketPath }, () => {
      const request = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      client.write(`${request}\n`)
    })

    let buffer = ''
    client.on('data', (chunk) => {
      buffer += chunk.toString()
      const newlineIdx = buffer.indexOf('\n')
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx)
        client.end()
        try {
          const response = JSON.parse(line)
          if (response.error) {
            reject(new Error(`${response.error.message} (code: ${response.error.code})`))
          }
          else {
            resolve(response.result)
          }
        }
        catch {
          reject(new Error(`Invalid JSON response: ${line}`))
        }
      }
    })

    client.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT'
        || (err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        reject(new Error('Cannot connect to Cradle. Is the app running?'))
      }
      else {
        reject(err)
      }
    })
  })
}
