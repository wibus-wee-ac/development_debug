// Input: Node HTTP primitives plus configurable mock response behavior for OpenAI-compatible chat endpoints
// Output: MockLlmServer with scenario-safe lifecycle, deterministic failure modes, tool calls, and request logging
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

export interface MockToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface MockToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface MockLlmServerOptions {
  /** Fixed response text the "assistant" will stream back. Default: 'Hello from mock LLM!' */
  responseText?: string
  /** Per-request response texts used in order for deterministic multi-turn scenarios. */
  responseTexts?: string[]
  /** Simulated delay (ms) between SSE chunks. Default: 10 */
  chunkDelay?: number
  /** Deterministic failure mode for request/stream error scenarios. */
  failureMode?: MockLlmFailureMode
  /** HTTP status code returned when failureMode is enabled. */
  errorStatusCode?: number
  /** Error payload text returned when failureMode is enabled. */
  errorMessage?: string
  /** Tool calls the model should emit instead of text. When set, responseText is sent after tool results. */
  toolCalls?: MockToolCall[]
  /** Tool definitions reported by the model (for validation). */
  tools?: MockToolDefinition[]
  /** Available models to report via /models endpoint. */
  models?: Array<{ id: string, owned_by?: string }>
  /** Reasoning/thinking text to emit before the main response. */
  reasoningText?: string
}

export class MockLlmServer {
  private server: Server | null = null
  private port = 0
  private responseText: string
  private readonly responseTexts: string[] | null
  private chunkDelay: number
  private readonly failureMode: MockLlmFailureMode
  private readonly errorStatusCode: number
  private readonly errorMessage: string
  private readonly toolCalls: MockToolCall[]
  // @ts-expect-error Reserved for future tool validation in tests
  private readonly _tools: MockToolDefinition[]
  private readonly models: Array<{ id: string, owned_by?: string }>
  private readonly reasoningText: string | null
  private requestLog: MockLlmRequestLogEntry[] = []
  private turnCount = 0

  constructor(opts: MockLlmServerOptions = {}) {
    this.responseText = opts.responseText ?? 'Hello from mock LLM!'
    this.responseTexts = opts.responseTexts?.length ? [...opts.responseTexts] : null
    this.chunkDelay = opts.chunkDelay ?? 10
    this.failureMode = opts.failureMode ?? 'none'
    this.errorStatusCode = opts.errorStatusCode ?? 500
    this.errorMessage = opts.errorMessage ?? 'Mock LLM forced failure'
    this.toolCalls = opts.toolCalls ?? []
    this._tools = opts.tools ?? []
    this.models = opts.models ?? [{ id: 'mock-model', owned_by: 'mock' }]
    this.reasoningText = opts.reasoningText ?? null
  }

  /** Start the server and return the base URL (e.g. http://localhost:PORT/v1) */
  async start(): Promise<string> {
    if (this.server) {
      throw new Error('MockLlmServer is already running')
    }
    this.requestLog = []
    this.turnCount = 0

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

  getTurnCount(): number {
    return this.turnCount
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? ''

    // CORS for browser clients
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      })
      res.end()
      return
    }

    if (req.method === 'GET' && url.endsWith('/models')) {
      this.recordRequest(req, '')
      this.handleModels(res)
      return
    }

    if (req.method === 'POST' && url.endsWith('/chat/completions')) {
      this.handleChatCompletions(req, res)
      return
    }

    if (req.method === 'POST' && url.endsWith('/responses')) {
      this.handleResponses(req, res)
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  }

  private handleModels(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      object: 'list',
      data: this.models.map(m => ({
        id: m.id,
        object: 'model',
        created: 0,
        owned_by: m.owned_by ?? 'mock',
      })),
    }))
  }

  private handleChatCompletions(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      this.recordRequest(req, body)
      this.turnCount++
      const responseText = this.getResponseTextForTurn(this.turnCount)

      if (this.failureMode === 'http-error') {
        res.writeHead(this.errorStatusCode, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          error: {
            message: this.errorMessage,
          },
        }))
        return
      }

      // Parse body to check if this is a tool result turn
      let parsedBody: { messages?: Array<{ role: string, tool_call_id?: string }> } | null = null
      try {
        parsedBody = JSON.parse(body)
      }
      catch { /* ignore */ }

      const hasToolResults = parsedBody?.messages?.some(m => m.role === 'tool') ?? false

      // First turn with tool calls configured and no tool results yet: emit tool calls
      if (this.toolCalls.length > 0 && !hasToolResults) {
        void this.streamToolCallResponse(res)
      }
      else {
        void this.streamResponse(res, responseText)
      }
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

  private getResponseTextForTurn(turnIndex: number): string {
    if (!this.responseTexts?.length) {
      return this.responseText
    }

    return this.responseTexts[Math.min(turnIndex - 1, this.responseTexts.length - 1)]!
  }

  private async streamResponse(res: ServerResponse, responseText: string): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const id = `chatcmpl-mock-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)
    const model = 'mock-model'

    // Stream reasoning if configured
    if (this.reasoningText) {
      const reasoningChunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: { role: 'assistant', reasoning_content: this.reasoningText },
          finish_reason: null,
        }],
        usage: null,
      }
      res.write(`data: ${JSON.stringify(reasoningChunk)}\n\n`)
      await this.delay(this.chunkDelay)
    }

    const words = responseText.split(' ')

    // Stream content word by word
    for (let i = 0; i < words.length; i++) {
      const content = i === 0 ? words[i] : ` ${words[i]}`
      const chunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: i === 0 && !this.reasoningText
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
      created,
      model,
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

  private async streamToolCallResponse(res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const id = `chatcmpl-mock-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)
    const model = 'mock-model'

    // First chunk with role
    const roleChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: { role: 'assistant', content: null, tool_calls: [] as unknown[] },
        finish_reason: null,
      }],
      usage: null,
    }
    res.write(`data: ${JSON.stringify(roleChunk)}\n\n`)
    await this.delay(this.chunkDelay)

    // Stream each tool call
    for (let i = 0; i < this.toolCalls.length; i++) {
      const tc = this.toolCalls[i]!
      // Tool call start
      const startChunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: i,
              id: tc.id,
              type: 'function',
              function: { name: tc.function.name, arguments: '' },
            }],
          },
          finish_reason: null,
        }],
        usage: null,
      }
      res.write(`data: ${JSON.stringify(startChunk)}\n\n`)
      await this.delay(this.chunkDelay)

      // Tool call arguments
      const argsChunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: i,
              function: { arguments: tc.function.arguments },
            }],
          },
          finish_reason: null,
        }],
        usage: null,
      }
      res.write(`data: ${JSON.stringify(argsChunk)}\n\n`)
      await this.delay(this.chunkDelay)
    }

    // Final chunk
    const finalChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'tool_calls',
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    }
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ── Responses API (POST /v1/responses) ────────────────────────────────────

  private handleResponses(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      this.recordRequest(req, body)
      this.turnCount++
      const responseText = this.getResponseTextForTurn(this.turnCount)

      if (this.failureMode === 'http-error') {
        res.writeHead(this.errorStatusCode, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: this.errorMessage } }))
        return
      }

      // Parse body to check for tool results in input
      let parsedBody: { input?: Array<{ type?: string }> } | null = null
      try {
        parsedBody = JSON.parse(body)
      }
      catch { /* ignore */ }

      const hasToolResults = parsedBody?.input?.some(i => i.type === 'function_call_output') ?? false

      if (this.toolCalls.length > 0 && !hasToolResults) {
        void this.streamResponsesToolCall(res)
      }
      else {
        void this.streamResponsesText(res, responseText)
      }
    })
  }

  private async streamResponsesText(res: ServerResponse, responseText: string): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const responseId = `resp-mock-${Date.now()}`
    const model = 'mock-model'
    const created = Math.floor(Date.now() / 1000)

    // response.created
    this.writeSSE(res, { type: 'response.created', response: { id: responseId, created_at: created, model } })
    await this.delay(this.chunkDelay)

    // Reasoning (if configured)
    if (this.reasoningText) {
      const reasoningId = `rs-${Date.now()}`
      // output_item.added (reasoning)
      this.writeSSE(res, { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: reasoningId } })
      await this.delay(this.chunkDelay)

      // reasoning_summary_part.added (index 0 is implied by output_item.added)
      // reasoning_summary_text.delta
      this.writeSSE(res, { type: 'response.reasoning_summary_text.delta', item_id: reasoningId, summary_index: 0, delta: this.reasoningText })
      await this.delay(this.chunkDelay)

      // reasoning_summary_part.done
      this.writeSSE(res, { type: 'response.reasoning_summary_part.done', item_id: reasoningId, summary_index: 0 })
      await this.delay(this.chunkDelay)

      // output_item.done (reasoning)
      this.writeSSE(res, { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: reasoningId } })
      await this.delay(this.chunkDelay)
    }

    // Message output item
    const msgId = `msg-${Date.now()}`
    const outputIndex = this.reasoningText ? 1 : 0
    this.writeSSE(res, { type: 'response.output_item.added', output_index: outputIndex, item: { type: 'message', id: msgId } })
    await this.delay(this.chunkDelay)

    // Stream text deltas word by word
    const words = responseText.split(' ')
    for (let i = 0; i < words.length; i++) {
      const delta = i === 0 ? words[i] : ` ${words[i]}`
      this.writeSSE(res, { type: 'response.output_text.delta', item_id: msgId, delta })
      await this.delay(this.chunkDelay)
    }

    // output_item.done (message)
    this.writeSSE(res, { type: 'response.output_item.done', output_index: outputIndex, item: { type: 'message', id: msgId } })
    await this.delay(this.chunkDelay)

    // response.completed
    this.writeSSE(res, {
      type: 'response.completed',
      response: {
        usage: {
          input_tokens: 10,
          output_tokens: words.length,
          output_tokens_details: { reasoning_tokens: this.reasoningText ? this.reasoningText.length : 0 },
        },
      },
    })
    res.end()
  }

  private async streamResponsesToolCall(res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const responseId = `resp-mock-${Date.now()}`
    const model = 'mock-model'
    const created = Math.floor(Date.now() / 1000)

    // response.created
    this.writeSSE(res, { type: 'response.created', response: { id: responseId, created_at: created, model } })
    await this.delay(this.chunkDelay)

    // Emit each tool call as a function_call item
    for (let i = 0; i < this.toolCalls.length; i++) {
      const tc = this.toolCalls[i]!
      const itemId = `fc-${i}-${Date.now()}`
      // output_item.added
      this.writeSSE(res, {
        type: 'response.output_item.added',
        output_index: i,
        item: {
          type: 'function_call',
          id: itemId,
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })
      await this.delay(this.chunkDelay)

      // output_item.done
      this.writeSSE(res, {
        type: 'response.output_item.done',
        output_index: i,
        item: {
          type: 'function_call',
          id: itemId,
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
          status: 'completed',
        },
      })
      await this.delay(this.chunkDelay)
    }

    // response.completed
    this.writeSSE(res, {
      type: 'response.completed',
      response: {
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    })
    res.end()
  }

  private writeSSE(res: ServerResponse, data: Record<string, unknown>): void {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }
}
