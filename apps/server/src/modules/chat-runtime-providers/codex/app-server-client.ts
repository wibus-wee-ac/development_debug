// Output: Newline-delimited JSON-RPC client for a per-turn Codex app-server process.
// Input: Codex CLI app-server stdio transport, request payloads, and provider config overrides.
// Position: Codex runtime provider infrastructure used to support live turn steering.

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

type RequestId = number

export interface CodexAppServerMessage {
  id?: RequestId
  method?: string
  params?: unknown
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface CodexAppServerClientOptions {
  codexPath?: string
  apiKey?: string
  config?: Record<string, unknown>
}

export class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pendingRequests = new Map<RequestId, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()

  private readonly notificationQueue: CodexAppServerMessage[] = []
  private readonly notificationWaiters: Array<(message: CodexAppServerMessage) => void> = []
  private nextRequestId = 1
  private closed = false
  private stderrText = ''

  constructor(options: CodexAppServerClientOptions = {}) {
    const args = ['app-server', '--listen', 'stdio://']
    if (options.config) {
      for (const override of serializeConfigOverrides(options.config)) {
        args.push('--config', override)
      }
    }

    const env = { ...process.env }
    env.CODEX_HOME = prepareCodexAppServerHome()
    if (options.apiKey) {
      env.CRADLE_CODEX_API_KEY = options.apiKey
      env.CODEX_API_KEY = options.apiKey
      env.OPENAI_API_KEY = options.apiKey
    }

    this.child = spawn(options.codexPath ?? 'codex', args, { env })
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderrText += chunk.toString('utf8')
    })
    this.child.once('error', (error) => {
      this.failAll(error)
    })
    this.child.once('exit', (code, signal) => {
      this.closed = true
      if (code === 0 && !signal) {
        this.failAll(new Error('Codex app-server exited'))
        return
      }
      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`
      this.failAll(new Error(`Codex app-server exited with ${detail}: ${this.stderrText}`))
    })

    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    lines.on('line', line => this.handleLine(line))
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'cradle', title: 'Cradle', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    })
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('Codex app-server is closed'))
    }
    const id = this.nextRequestId
    this.nextRequestId += 1
    const payload = params === undefined ? { id, method } : { id, method, params }
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) {
          return
        }
        this.pendingRequests.delete(id)
        reject(error)
      })
    })
  }

  async nextNotification(signal?: AbortSignal): Promise<CodexAppServerMessage | null> {
    if (this.notificationQueue.length > 0) {
      return this.notificationQueue.shift() ?? null
    }
    if (this.closed) {
      return null
    }
    return new Promise((resolve, reject) => {
      let waiter: ((message: CodexAppServerMessage) => void) | null = null
      const onAbort = () => {
        const index = waiter ? this.notificationWaiters.indexOf(waiter) : -1
        if (index >= 0) {
          this.notificationWaiters.splice(index, 1)
        }
        reject(new Error('Codex app-server notification wait aborted'))
      }
      if (signal?.aborted) {
        reject(new Error('Codex app-server notification wait aborted'))
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      waiter = (message) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(message)
      }
      this.notificationWaiters.push(waiter)
    })
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.child.kill('SIGTERM')
    this.failAll(new Error('Codex app-server closed'))
  }

  private handleLine(line: string): void {
    if (!line.trim()) {
      return
    }
    let message: CodexAppServerMessage
    try {
      message = JSON.parse(line) as CodexAppServerMessage
    }
    catch (error) {
      this.failAll(error instanceof Error ? error : new Error(String(error)))
      return
    }

    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id)
      if (!pending) {
        return
      }
      this.pendingRequests.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message))
      }
      else {
        pending.resolve(message.result)
      }
      return
    }

    const waiter = this.notificationWaiters.shift()
    if (waiter) {
      waiter(message)
      return
    }
    this.notificationQueue.push(message)
  }

  private failAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
    while (this.notificationWaiters.length > 0) {
      this.notificationWaiters.shift()?.({ method: 'error', params: { message: error.message } })
    }
  }
}

export function resolveCodexAppServerHome(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): string {
  const env = input.env ?? process.env
  const dataDir = env.CRADLE_DATA_DIR?.trim()
  if (dataDir) {
    return join(dataDir, 'runtimes', 'codex-app-server')
  }

  const dbPath = env.CRADLE_DB_PATH?.trim()
  if (dbPath) {
    return join(dirname(dbPath), 'runtimes', 'codex-app-server')
  }

  return join(input.homeDir ?? homedir(), '.cradle', 'runtimes', 'codex-app-server')
}

function prepareCodexAppServerHome(): string {
  const resolvedHome = resolveCodexAppServerHome()
  mkdirSync(resolvedHome, { recursive: true })
  return resolvedHome
}

function serializeConfigOverrides(config: Record<string, unknown>, prefix = ''): string[] {
  const overrides: string[] = []
  for (const [key, value] of Object.entries(config)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainRecord(value)) {
      overrides.push(...serializeConfigOverrides(value, path))
    }
    else {
      overrides.push(`${path}=${toTomlValue(value)}`)
    }
  }
  return overrides
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toTomlValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}
