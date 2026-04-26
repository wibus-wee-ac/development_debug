// Input: @agentclientprotocol/sdk, AcpProcessManager, AcpResponsesConverter, Electron WebContents
// Output: AcpConnectionManager singleton — manages ACP ClientSideConnection instances,
//         exposes prompt() and session restore helpers, broadcasts title events
//         to subscriber set (supports multiple windows)
// Position: Main-process transport bridge between spawned agents and upper layers (ChatEngine)

import { promises as fsp } from 'node:fs'

import type {
  Agent,
  Client,
  InitializeResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  ResumeSessionResponse,
  SessionConfigOption,
  SessionModelState,
  SessionNotification,
} from '@agentclientprotocol/sdk'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'

import type { ProcessEntry } from './acp-process-manager'
import { AcpProcessManager } from './acp-process-manager'
import { AcpResponsesConverter } from './acp-responses-converter'
import type { ResponseStreamEvent } from './chat-provider'

// ── Session state ─────────────────────────────────────────────────────────────

export interface AcpSessionState {
  models: SessionModelState | null
  configOptions: SessionConfigOption[]
}

// ── Chunk queue (async pipe for prompt generator) ─────────────────────────────

class ChunkQueue {
  private buffered: ResponseStreamEvent[] = []
  private waiters: Array<{
    resolve: (value: ResponseStreamEvent | null) => void
    reject: (err: Error) => void
  }> = []

  private closed = false
  private failure: Error | null = null

  push(chunk: ResponseStreamEvent): void {
    if (this.closed) {
      return
    }
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve(chunk)
    }
    else {
      this.buffered.push(chunk)
    }
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    while (this.waiters.length) {
      this.waiters.shift()!.resolve(null)
    }
  }

  fail(err: Error): void {
    if (this.closed) {
      return
    }
    this.failure = err
    this.closed = true
    while (this.waiters.length) {
      this.waiters.shift()!.reject(err)
    }
  }

  async next(): Promise<ResponseStreamEvent | null> {
    if (this.buffered.length > 0) {
      return this.buffered.shift()!
    }
    if (this.failure) {
      throw this.failure
    }
    if (this.closed) {
      return null
    }
    return new Promise<ResponseStreamEvent | null>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }
}

// ── Connection entry ──────────────────────────────────────────────────────────

interface SessionChannel {
  converter: AcpResponsesConverter
  queue: ChunkQueue
}

interface ConnectionEntry {
  agentId: string
  connection: ClientSideConnection
  initResult: InitializeResponse | null
  /** Per-session runtime state (models + configOptions). Keyed by ACP sessionId. */
  sessionStates: Map<string, AcpSessionState>
  /** Per-session in-flight prompt channel. Keyed by ACP sessionId. */
  channels: Map<string, SessionChannel>
  /**
   * ACP `session/load` replays historical chunks, but Cradle already persists
   * transcript history in SQLite, so those replay notifications are discarded.
   */
  restoringSessionLoads: Set<string>
}

// ── Manager ───────────────────────────────────────────────────────────────────

export class AcpConnectionManager {
  private static instance: AcpConnectionManager
  private readonly connections = new Map<string, ConnectionEntry>()
  private readonly pendingConnects = new Map<string, Promise<InitializeResponse>>()
  private readonly sessionTitleHandlers = new Set<(acpSessionId: string, title: string) => void>()

  /** Token usage from the most recently completed prompt, if reported by the ACP agent. */
  private _lastUsage: { promptTokens: number, completionTokens: number, totalTokens: number } | null = null
  get lastUsage() { return this._lastUsage }

  static getInstance(): AcpConnectionManager {
    if (!AcpConnectionManager.instance) {
      AcpConnectionManager.instance = new AcpConnectionManager()
    }
    return AcpConnectionManager.instance
  }

  /** Register a callback for agent-pushed session title updates (used by ChatEngine). */
  onSessionTitle(cb: (acpSessionId: string, title: string) => void): () => void {
    this.sessionTitleHandlers.add(cb)
    return () => {
      this.sessionTitleHandlers.delete(cb)
    }
  }

  // ── Connect ───────────────────────────────────────────────────────────────

  async connect(
    agentId: string,
    record: {
      distributionType: string
      installPath: string | null
      cmd: string | null
      args: string
      env: string
    },
  ): Promise<InitializeResponse> {
    if (this.connections.has(agentId)) {
      throw new Error(`Agent ${agentId} is already connected`)
    }
    // Deduplicate concurrent calls for the same agent
    const pending = this.pendingConnects.get(agentId)
    if (pending) {
      return pending
    }
    const promise = this._doConnect(agentId, record).finally(() => {
      this.pendingConnects.delete(agentId)
    })
    this.pendingConnects.set(agentId, promise)
    return promise
  }

  private async _doConnect(
    agentId: string,
    record: {
      distributionType: string
      installPath: string | null
      cmd: string | null
      args: string
      env: string
    },
  ): Promise<InitializeResponse> {
    const args: string[] = JSON.parse(record.args || '[]')
    const env: Record<string, string> = JSON.parse(record.env || '{}')
    const distType = record.distributionType as 'binary' | 'npx' | 'uvx'

    const procMgr = AcpProcessManager.getInstance()
    const entry: ProcessEntry = procMgr.spawn({
      agentId,
      cmd: record.cmd ?? '',
      args,
      env,
      distributionType: distType,
      installPath: record.installPath,
    })

    const stream = ndJsonStream(entry.stdinWeb, entry.stdoutWeb)

    const connection = new ClientSideConnection(
      (agent: Agent): Client => this.createClient(agentId, agent),
      stream,
    )

    const initResult = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'Cradle', version: '1.0.0' },
    })

    this.connections.set(agentId, {
      agentId,
      connection,
      initResult,
      sessionStates: new Map(),
      channels: new Map(),
      restoringSessionLoads: new Set(),
    })

    connection.closed.then(() => {
      this.connections.delete(agentId)
    })

    return initResult
  }

  // ── Session operations ────────────────────────────────────────────────────

  async newSession(agentId: string, cwd: string): Promise<NewSessionResponse> {
    const conn = this.getConnection(agentId)
    const resp = await conn.connection.newSession({ cwd, mcpServers: [] })
    this.cacheSessionState(conn, resp.sessionId, resp)
    return resp
  }

  supportsLoadSession(agentId: string): boolean {
    return !!this.getConnection(agentId).initResult?.agentCapabilities?.loadSession
  }

  supportsResumeSession(agentId: string): boolean {
    return !!this.getConnection(agentId).initResult?.agentCapabilities?.sessionCapabilities?.resume
  }

  async loadSession(
    agentId: string,
    sessionId: string,
    cwd: string,
  ): Promise<LoadSessionResponse> {
    const conn = this.getConnection(agentId)
    if (!this.supportsLoadSession(agentId)) {
      throw new Error(`Agent ${agentId} does not support session/load`)
    }

    conn.restoringSessionLoads.add(sessionId)
    try {
      const resp = await conn.connection.loadSession({ sessionId, cwd, mcpServers: [] })
      this.cacheSessionState(conn, sessionId, resp)
      return resp
    }
    finally {
      conn.restoringSessionLoads.delete(sessionId)
    }
  }

  async resumeSession(
    agentId: string,
    sessionId: string,
    cwd: string,
  ): Promise<ResumeSessionResponse> {
    const conn = this.getConnection(agentId)
    if (!this.supportsResumeSession(agentId)) {
      throw new Error(`Agent ${agentId} does not support session/resume`)
    }

    const resp = await conn.connection.unstable_resumeSession({ sessionId, cwd, mcpServers: [] })
    this.cacheSessionState(conn, sessionId, resp)
    return resp
  }

  getSessionState(agentId: string, sessionId: string): AcpSessionState | null {
    const conn = this.connections.get(agentId)
    return conn?.sessionStates.get(sessionId) ?? null
  }

  async setSessionModel(agentId: string, sessionId: string, modelId: string): Promise<void> {
    const conn = this.getConnection(agentId)
    await conn.connection.unstable_setSessionModel({ sessionId, modelId })
    const state = conn.sessionStates.get(sessionId)
    if (state?.models) {
      state.models.currentModelId = modelId
    }
  }

  async setSessionConfigOption(
    agentId: string,
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void> {
    const conn = this.getConnection(agentId)
    const params = typeof value === 'boolean'
      ? { sessionId, configId, type: 'boolean' as const, value }
      : { sessionId, configId, value }
    const resp = await conn.connection.setSessionConfigOption(params)
    const state = conn.sessionStates.get(sessionId)
    if (state && resp?.configOptions) {
      state.configOptions = resp.configOptions
    }
  }

  /**
   * Send a prompt and yield UIMessageChunk values as they arrive.
   *
   * Generator semantics:
   *  - Yields every chunk produced by the AcpStreamConverter (text/reasoning/tool deltas)
   *  - Yields trailing flush chunks on normal completion, then returns
   *  - Throws if the underlying ACP connection errors (caller's for-await rethrows)
   *  - Safe to `break` from the generator: the active ACP prompt is *not* auto-cancelled —
   *    callers must call `cancel()` explicitly to stop generation
   */
  async* prompt(
    agentId: string,
    sessionId: string,
    message: string,
  ): AsyncGenerator<ResponseStreamEvent, void, void> {
    const conn = this.getConnection(agentId)
    const converter = new AcpResponsesConverter()
    const queue = new ChunkQueue()
    conn.channels.set(sessionId, { converter, queue })

    let promptResult: PromptResponse | null = null
    let promptError: Error | null = null

    const promptDone = conn.connection
      .prompt({ sessionId, prompt: [{ type: 'text', text: message }] })
      .then((result) => {
        promptResult = result
        for (const c of converter.flush()) {
          queue.push(c)
        }
        queue.close()
      })
      .catch((err: unknown) => {
        promptError = err instanceof Error ? err : new Error(String(err))
        for (const c of converter.flush()) {
          queue.push(c)
        }
        queue.fail(promptError)
      })
      .finally(() => {
        conn.channels.delete(sessionId)
      })

    try {
      while (true) {
        const chunk = await queue.next()
        if (chunk === null) {
          break
        }
        yield chunk
      }
      await promptDone
      if (promptError) {
        throw promptError
      }
      // Capture token usage if the ACP agent reported it
      if (promptResult?.usage) {
        const u = promptResult.usage
        this._lastUsage = {
          promptTokens: u.inputTokens ?? 0,
          completionTokens: u.outputTokens ?? 0,
          totalTokens: u.totalTokens ?? 0,
        }
      }
      else {
        this._lastUsage = null
      }
    }
 catch (err) {
      await promptDone.catch(() => {})
      throw err
    }
  }

  async cancel(agentId: string, sessionId: string): Promise<void> {
    const conn = this.getConnection(agentId)
    await conn.connection.cancel({ sessionId })
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  async disconnect(agentId: string): Promise<void> {
    this.connections.delete(agentId)
    await AcpProcessManager.getInstance().stop(agentId)
  }

  isConnected(agentId: string): boolean {
    return this.connections.has(agentId)
  }

  getInitResult(agentId: string): InitializeResponse | null {
    return this.connections.get(agentId)?.initResult ?? null
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private getConnection(agentId: string): ConnectionEntry {
    const entry = this.connections.get(agentId)
    if (!entry) {
      throw new Error(`Agent ${agentId} is not connected`)
    }
    return entry
  }

  private cacheSessionState(
    conn: ConnectionEntry,
    sessionId: string,
    resp: { models?: SessionModelState | null, configOptions?: SessionConfigOption[] | null },
  ): void {
    conn.sessionStates.set(sessionId, {
      models: resp.models ?? null,
      configOptions: resp.configOptions ?? [],
    })
  }

  /**
   * Create the `Client` that handles agent-side requests
   * (permissions, session updates, file ops, etc.).
   */
  private createClient(agentId: string, _agent: Agent): Client {
    return {
      requestPermission: async (params) => {
        const firstOption = params.options?.[0]
        return {
          outcome: {
            outcome: 'selected' as const,
            optionId: firstOption?.optionId ?? '',
          },
        }
      },

      sessionUpdate: async (params: SessionNotification) => {
        if (params.update.sessionUpdate === 'session_info_update') {
          const infoUpdate = params.update as { title?: string | null }
          if (infoUpdate.title) {
            for (const handler of [...this.sessionTitleHandlers]) {
              try {
                handler(params.sessionId, infoUpdate.title)
              }
              catch {
                // swallow — handlers must not break the session update loop
              }
            }
          }
          return
        }

        const connEntry = this.connections.get(agentId)
        if (connEntry?.restoringSessionLoads.has(params.sessionId)) {
          return
        }
        const channel = connEntry?.channels.get(params.sessionId)
        if (channel) {
          const chunks = channel.converter.convert(params.update)
          for (const chunk of chunks) {
            channel.queue.push(chunk)
          }
        }
      },

      readTextFile: async (params) => {
        const content = await fsp.readFile(params.path, 'utf-8')
        return { content }
      },

      writeTextFile: async (params) => {
        await fsp.writeFile(params.path, params.content, 'utf-8')
        return {}
      },
    }
  }
}
