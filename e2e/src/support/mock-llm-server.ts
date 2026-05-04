// Input: Node HTTP primitives plus configurable mock response behavior for OpenAI-compatible chat endpoints
// Output: MockLlmServer with scenario-safe lifecycle, deterministic failure modes, and request logging
// Position: E2E support fixture providing a controllable local LLM provider for Electron end-to-end scenarios

import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createServer } from 'node:http'

export interface MockLlmRequestLogEntry {
  method: string
  path: string
  body: string
  recordedAt: number
}

export type MockLlmFailureMode = 'none' | 'http-error'

export interface MockLlmServerOptions {
  /** Fixed response text the "assistant" will stream back. Default: 'Hello from mock LLM!' */
  responseText?: string
  /** Simulated delay (ms) between SSE chunks. Default: 10 */
  chunkDelay?: number
  /** Deterministic failure mode for request/stream error scenarios. */
  failureMode?: MockLlmFailureMode
  /** HTTP status code returned when failureMode is enabled. */
  errorStatusCode?: number
  /** Error payload text returned when failureMode is enabled. */
  errorMessage?: string
}

export class MockLlmServer {
  private server: Server | null = null
  private port = 0
  private responseText: string
  private chunkDelay: number
  private readonly failureMode: MockLlmFailureMode
  private readonly errorStatusCode: number
  private readonly errorMessage: string
  private requestLog: MockLlmRequestLogEntry[] = []

  constructor(opts: MockLlmServerOptions = {}) {
    this.responseText = opts.responseText ?? 'Hello from mock LLM!'
    this.chunkDelay = opts.chunkDelay ?? 10
    this.failureMode = opts.failureMode ?? 'none'
    this.errorStatusCode = opts.errorStatusCode ?? 500
    this.errorMessage = opts.errorMessage ?? 'Mock LLM forced failure'
  }

  /** Start the server and return the base URL (e.g. http://localhost:PORT/v1) */
  async start(): Promise<string> {
    if (this.server) {
      throw new Error('MockLlmServer is already running')
    }
    this.requestLog = []

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res))
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address()
        if (typeof addr === 'object' && addr) {
          this.port = addr.port
          resolve(`http://127.0.0.1:${this.port}/v1`)
        }
        else {
          reject(new Error('Failed to get server address'))
        }
      })
      this.server.on('error', reject)
    })
  }

  /** Stop the server */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        const activeServer = this.server
        this.server = null
        this.port = 0
        activeServer.close(() => resolve())
      }
      else {
        resolve()
      }
    })
  }

  getRequestLog(): MockLlmRequestLogEntry[] {
    return this.requestLog.map(entry => ({ ...entry }))
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? ''

    if (req.method === 'GET' && url.endsWith('/models')) {
      this.recordRequest(req, '')
      this.handleModels(res)
      return
    }

    if (req.method === 'POST' && url.endsWith('/chat/completions')) {
      this.handleChatCompletions(req, res)
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  }

  private handleModels(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'mock-model', object: 'model', created: 0, owned_by: 'mock' },
      ],
    }))
  }

  private handleChatCompletions(req: IncomingMessage, res: ServerResponse): void {
    // Collect body (we don't really need it but must consume the stream)
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      this.recordRequest(req, body)

      if (this.failureMode === 'http-error') {
        res.writeHead(this.errorStatusCode, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          error: {
            message: this.errorMessage,
          },
        }))
        return
      }

      void this.streamResponse(res)
    })
  }

  private recordRequest(req: IncomingMessage, body: string): void {
    this.requestLog.push({
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      body,
      recordedAt: Date.now(),
    })
  }

  private async streamResponse(res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const words = this.responseText.split(' ')
    const id = `chatcmpl-mock-${Date.now()}`

    // Stream content word by word
    for (let i = 0; i < words.length; i++) {
      const content = i === 0 ? words[i] : ` ${words[i]}`
      const chunk = {
        id,
        object: 'chat.completion.chunk',
        choices: [{
          index: 0,
          delta: i === 0
            ? { role: 'assistant', content }
            : { content },
          finish_reason: null,
        }],
        usage: null,
      }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      await this.delay(this.chunkDelay)
    }

    // Final chunk with finish_reason + usage
    const finalChunk = {
      id,
      object: 'chat.completion.chunk',
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: words.length,
        total_tokens: 10 + words.length,
      },
    }
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
