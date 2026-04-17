// Input: @agentclientprotocol/sdk, AcpProcessManager, Electron BrowserWindow
// Output: AcpConnectionManager singleton — manages ACP ClientSideConnection
//         instances and forwards session updates to the renderer
// Position: Main-process bridge between spawned agents and the Electron UI

import { promises as fsp } from 'node:fs'

import type {
  Agent,
  Client,
  InitializeResponse,
  NewSessionResponse,
  PromptResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import type { WebContents } from 'electron'

import type { ProcessEntry } from './acp-process-manager'
import { AcpProcessManager } from './acp-process-manager'

// ── Connection entry ──────────────────────────────────────────────────────────

interface ConnectionEntry {
  agentId: string
  connection: ClientSideConnection
  initResult: InitializeResponse | null
}

// ── Manager ───────────────────────────────────────────────────────────────────

export class AcpConnectionManager {
  private static instance: AcpConnectionManager
  private readonly connections = new Map<string, ConnectionEntry>()

  /** WebContents to forward session/update notifications to the renderer. */
  private webContents: WebContents | null = null

  static getInstance(): AcpConnectionManager {
    if (!AcpConnectionManager.instance) {
      AcpConnectionManager.instance = new AcpConnectionManager()
    }
    return AcpConnectionManager.instance
  }

  /** Call once from the main window to set the target renderer. */
  setWebContents(wc: WebContents): void {
    this.webContents = wc
  }

  // ── Connect ───────────────────────────────────────────────────────────────

  /**
   * Start an agent process and establish an ACP connection.
   * Returns the `InitializeResponse` from the agent.
   */
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

    // Parse stored JSON fields
    const args: string[] = JSON.parse(record.args || '[]')
    const env: Record<string, string> = JSON.parse(record.env || '{}')
    const distType = record.distributionType as 'binary' | 'npx' | 'uvx'

    // 1. Spawn process
    const procMgr = AcpProcessManager.getInstance()
    const entry: ProcessEntry = procMgr.spawn({
      agentId,
      cmd: record.cmd ?? '',
      args,
      env,
      distributionType: distType,
      installPath: record.installPath,
    })

    // 2. Create ACP stream from the process's Web streams
    const stream = ndJsonStream(entry.stdinWeb, entry.stdoutWeb)

    // 3. Create the ClientSideConnection with our Client implementation
    const wc = this.webContents
    const connection = new ClientSideConnection(
      (agent: Agent): Client => this.createClient(agentId, agent, wc),
      stream,
    )

    // 4. Initialize the connection
    const initResult = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: 'Cradle',
        version: '1.0.0',
      },
    })

    this.connections.set(agentId, {
      agentId,
      connection,
      initResult,
    })

    // Clean up when the connection closes
    connection.closed.then(() => {
      this.connections.delete(agentId)
    })

    return initResult
  }

  // ── Session operations ────────────────────────────────────────────────────

  async newSession(agentId: string, cwd: string): Promise<NewSessionResponse> {
    const conn = this.getConnection(agentId)
    return conn.connection.newSession({ cwd, mcpServers: [] })
  }

  async prompt(
    agentId: string,
    sessionId: string,
    message: string,
  ): Promise<PromptResponse> {
    const conn = this.getConnection(agentId)
    return conn.connection.prompt({
      sessionId,
      prompt: [{ type: 'text', text: message }],
    })
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

  /**
   * Create the `Client` that handles agent-side requests
   * (permissions, session updates, file ops, etc.).
   */
  private createClient(
    agentId: string,
    _agent: Agent,
    wc: WebContents | null,
  ): Client {
    return {
      // ── Required ────────────────────────────────────────────────────────

      async requestPermission(params) {
        // Auto-allow for now; the UI can be extended to prompt the user.
        const firstOption = params.options?.[0]
        return {
          outcome: {
            outcome: 'selected' as const,
            optionId: firstOption?.optionId ?? '',
          },
        }
      },

      async sessionUpdate(params: SessionNotification) {
        // Forward the notification to the renderer over IPC
        if (wc && !wc.isDestroyed()) {
          wc.send('acp:session-update', { agentId, ...params })
        }
      },

      // ── Optional: File system ───────────────────────────────────────────

      async readTextFile(params) {
        const content = await fsp.readFile(params.path, 'utf-8')
        return { content }
      },

      async writeTextFile(params) {
        await fsp.writeFile(params.path, params.content, 'utf-8')
        return {}
      },
    }
  }
}
