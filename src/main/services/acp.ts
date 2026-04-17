// Input: IpcService base, acp-registry, acp-installer, acp-connection, acp-process-manager
// Output: AcpService IPC handler — registry browsing, agent install/uninstall,
//         runtime start/stop, session management, audit log, metrics
// Position: Main-process service registered in src/main/index.ts

import { IpcMethod, IpcService } from '@cradle/ipc'
import { desc, eq } from 'drizzle-orm'
import { app } from 'electron'

import { getDb } from '../db'
import type { AcpAgent, AcpAuditEntry } from '../db/schema'
import { acpAgents, acpAuditLog } from '../db/schema'
import { AcpConnectionManager } from '../lib/acp-connection'
import {
  getAgentInstallDir,
  installBinaryAgent,
  installPackageAgent,
  persistFailed,
  persistInstalled,
  uninstallBinaryAgent,
} from '../lib/acp-installer'
import type { ProcessMetrics } from '../lib/acp-process-manager'
import { AcpProcessManager } from '../lib/acp-process-manager'
import type { RegistryAgent } from '../lib/acp-registry'
import { fetchRegistry, getSupportedDistributionTypes } from '../lib/acp-registry'

export class AcpService extends IpcService {
  static readonly groupName = 'acp'

  // ── Registry ──────────────────────────────────────────────────────────────

  /**
   * Fetch the ACP registry from the CDN and return the full agent list.
   * The result is not cached — callers that need caching should do so in the
   * renderer layer.
   */
  @IpcMethod()
  async fetchRegistry(): Promise<RegistryAgent[]> {
    const registry = await fetchRegistry()
    return registry.agents
  }

  /**
   * Return the distribution types that are available on the current platform
   * for a given registry agent id.  Useful for the UI before fetching the full
   * registry again.
   */
  @IpcMethod()
  async getDistributionTypes(agentId: string): Promise<Array<'binary' | 'npx' | 'uvx'>> {
    const registry = await fetchRegistry()
    const agent = registry.agents.find(a => a.id === agentId)
    if (!agent) {
      return []
    }
    return getSupportedDistributionTypes(agent)
  }

  // ── Installed agents ──────────────────────────────────────────────────────

  /** List all agents that have been installed (or are pending). */
  @IpcMethod()
  listInstalled(): AcpAgent[] {
    return getDb().select().from(acpAgents).orderBy(desc(acpAgents.updatedAt)).all()
  }

  /** Get a single installed agent record by its registry id. */
  @IpcMethod()
  getInstalled(agentId: string): AcpAgent | undefined {
    return getDb().select().from(acpAgents).where(eq(acpAgents.id, agentId)).get()
  }

  // ── Install ───────────────────────────────────────────────────────────────

  /**
   * Install an agent from the registry.
   *
   * `distributionType` must be one of 'binary', 'npx', or 'uvx'.  For
   * 'npx'/'uvx' agents, no binary is downloaded — only the metadata is stored
   * in the database.  For 'binary' agents, the archive is downloaded and
   * extracted to `userData/acp/agents/<agentId>/`.
   *
   * The method is intentionally synchronous from the caller's perspective but
   * runs async work internally; it marks the record as 'installing' first and
   * updates it on completion so the UI can poll for status changes.
   */
  @IpcMethod()
  async install(agentId: string, distributionType: 'binary' | 'npx' | 'uvx'): Promise<AcpAgent> {
    const registry = await fetchRegistry()
    const agent = registry.agents.find(a => a.id === agentId)
    if (!agent) {
      throw new Error(`Agent not found in registry: ${agentId}`)
    }

    const userData = app.getPath('userData')

    // Mark as installing in DB immediately so the UI can react
    const now = Math.floor(Date.now() / 1000)
    getDb()
      .insert(acpAgents)
      .values({
        id: agentId,
        name: agent.name,
        version: agent.version,
        distributionType,
        status: 'installing',
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: acpAgents.id,
        set: { status: 'installing', updatedAt: now },
      })
      .run()

    try {
      let result
      if (distributionType === 'binary') {
        result = await installBinaryAgent(agent, userData)
      }
      else {
        result = installPackageAgent(agent, distributionType)
      }

      persistInstalled(agentId, agent.name, agent.version, distributionType, result)
    }
    catch (err) {
      persistFailed(agentId, err)
      throw err
    }

    return getDb().select().from(acpAgents).where(eq(acpAgents.id, agentId)).get()!
  }

  // ── Uninstall ─────────────────────────────────────────────────────────────

  /**
   * Uninstall an agent.  Binary agents have their installation directory
   * removed; package-manager agents simply have their DB record deleted.
   * Either way, the audit log retains the history.
   */
  @IpcMethod()
  async uninstall(agentId: string): Promise<void> {
    const record = getDb().select().from(acpAgents).where(eq(acpAgents.id, agentId)).get()
    if (!record) {
      throw new Error(`Agent not installed: ${agentId}`)
    }

    const userData = app.getPath('userData')

    if (record.distributionType === 'binary' && record.installPath) {
      await uninstallBinaryAgent(agentId, record.installPath, userData)
    }
    else {
      // npx / uvx — nothing on disk to remove; just audit the logical operation
      getDb()
        .insert(acpAuditLog)
        .values({
          agentId,
          action: 'uninstall_start',
          path: null,
          details: JSON.stringify({ distributionType: record.distributionType }),
        })
        .run()
      getDb()
        .insert(acpAuditLog)
        .values({
          agentId,
          action: 'uninstall_complete',
          path: null,
          details: '{}',
        })
        .run()
    }

    getDb().delete(acpAgents).where(eq(acpAgents.id, agentId)).run()
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  /**
   * Return the audit trail for all agents, or for a specific `agentId` when
   * provided.  Entries are ordered newest-first.
   */
  @IpcMethod()
  getAuditLog(agentId?: string): AcpAuditEntry[] {
    const db = getDb()
    if (agentId) {
      return db
        .select()
        .from(acpAuditLog)
        .where(eq(acpAuditLog.agentId, agentId))
        .orderBy(desc(acpAuditLog.id))
        .all()
    }
    return db.select().from(acpAuditLog).orderBy(desc(acpAuditLog.id)).all()
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  /**
   * Return the absolute path where a binary agent would be installed.
   * Safe to call before installation — useful for displaying the install
   * location in the UI.
   */
  @IpcMethod()
  getAgentInstallPath(agentId: string): string {
    return getAgentInstallDir(app.getPath('userData'), agentId)
  }

  // ── Runtime: Start / Stop ─────────────────────────────────────────────────

  /**
   * Start an installed agent process and establish an ACP connection.
   * Returns a serializable summary of the InitializeResponse.
   */
  @IpcMethod()
  async startAgent(agentId: string): Promise<Record<string, unknown>> {
    const record = getDb().select().from(acpAgents).where(eq(acpAgents.id, agentId)).get()
    if (!record || record.status !== 'installed') {
      throw new Error(`Agent not installed or not ready: ${agentId}`)
    }

    const connMgr = AcpConnectionManager.getInstance()
    const initResult = await connMgr.connect(agentId, record)
    return initResult as unknown as Record<string, unknown>
  }

  /** Stop a running agent process. */
  @IpcMethod()
  async stopAgent(agentId: string): Promise<void> {
    await AcpConnectionManager.getInstance().disconnect(agentId)
  }

  /** Check if an agent is currently running. */
  @IpcMethod()
  isAgentRunning(agentId: string): boolean {
    return AcpConnectionManager.getInstance().isConnected(agentId)
  }

  // ── Runtime: Sessions ─────────────────────────────────────────────────────

  /**
   * Create a new ACP session on a running agent.
   * `cwd` is the workspace path the agent will operate in.
   */
  @IpcMethod()
  async createSession(agentId: string, cwd: string): Promise<Record<string, unknown>> {
    const result = await AcpConnectionManager.getInstance().newSession(agentId, cwd)
    return result as unknown as Record<string, unknown>
  }

  /** Send a prompt to a running agent session. */
  @IpcMethod()
  async sendPrompt(agentId: string, sessionId: string, message: string): Promise<Record<string, unknown>> {
    const result = await AcpConnectionManager.getInstance().prompt(agentId, sessionId, message)
    return result as unknown as Record<string, unknown>
  }

  /** Cancel an in-progress prompt. */
  @IpcMethod()
  async cancelPrompt(agentId: string, sessionId: string): Promise<void> {
    await AcpConnectionManager.getInstance().cancel(agentId, sessionId)
  }

  // ── Runtime: Session model / config ───────────────────────────────────────

  /**
   * Return the current model + config option state for a session.
   * Returns null if the agent doesn't expose model selection.
   */
  @IpcMethod()
  getSessionState(agentId: string, sessionId: string): import('../lib/acp-connection').AcpSessionState | null {
    return AcpConnectionManager.getInstance().getSessionState(agentId, sessionId)
  }

  /**
   * Switch the model for a running session.
   * The agent must support the `unstable_setSessionModel` capability.
   */
  @IpcMethod()
  async setSessionModel(agentId: string, sessionId: string, modelId: string): Promise<void> {
    await AcpConnectionManager.getInstance().setSessionModel(agentId, sessionId, modelId)
  }

  /**
   * Update a session config option (e.g. thought_level / thinking effort).
   * `value` is the new `SessionConfigValueId` (string) or boolean for boolean options.
   */
  @IpcMethod()
  async setSessionConfigOption(
    agentId: string,
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void> {
    await AcpConnectionManager.getInstance().setSessionConfigOption(agentId, sessionId, configId, value)
  }

  // ── Runtime: Metrics (for Dev mode) ───────────────────────────────────────

  /** Return process metrics for all running agents. */
  @IpcMethod()
  getRunningAgentMetrics(): ProcessMetrics[] {
    return AcpProcessManager.getInstance().getMetrics()
  }
}
