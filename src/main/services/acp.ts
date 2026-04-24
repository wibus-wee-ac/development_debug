// Input: IpcService base, acp-registry, acp-installer, acp-connection, acp-process-manager
// Output: AcpService IPC handler — registry browsing, agent install/uninstall,
//         runtime start/stop, session management, audit log, metrics
// Position: Main-process service registered in src/main/index.ts

import { IpcMethod, IpcService } from '@cradle/ipc'
import { desc, eq } from 'drizzle-orm'
import { app } from 'electron'

import { getDb } from '../db'
import type { AcpAgent, AcpAuditEntry } from '../db/schema'
import { acpAgents, acpAuditLog, agentProfiles } from '../db/schema'
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

  private readonly installAbortControllers = new Map<string, AbortController>()

  // ── Registry ──────────────────────────────────────────────────────────────

  @IpcMethod()
  async fetchRegistry(): Promise<RegistryAgent[]> {
    const registry = await fetchRegistry()
    return registry.agents
  }

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

  @IpcMethod()
  listInstalled(): AcpAgent[] {
    return getDb().select().from(acpAgents).orderBy(desc(acpAgents.updatedAt)).all()
  }

  @IpcMethod()
  getInstalled(agentId: string): AcpAgent | undefined {
    return getDb().select().from(acpAgents).where(eq(acpAgents.id, agentId)).get()
  }

  // ── Install ───────────────────────────────────────────────────────────────

  @IpcMethod()
  async install(agentId: string, distributionType: 'binary' | 'npx' | 'uvx'): Promise<AcpAgent> {
    const registry = await fetchRegistry()
    const agent = registry.agents.find(a => a.id === agentId)
    if (!agent) {
      throw new Error(`Agent not found in registry: ${agentId}`)
    }

    const userData = app.getPath('userData')
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
        const controller = new AbortController()
        this.installAbortControllers.set(agentId, controller)
        try {
          result = await installBinaryAgent(agent, userData, controller.signal)
        }
        finally {
          this.installAbortControllers.delete(agentId)
        }
      }
      else {
        result = installPackageAgent(agent, distributionType)
      }
      persistInstalled(agentId, agent.name, agent.version, distributionType, result)

      // Auto-create or update agent profile so the agent appears immediately in chat
      const configJson = distributionType === 'binary'
        ? JSON.stringify({ distributionType: 'binary', cmd: result.cmd ?? agentId, args: result.args ?? [], installPath: result.installPath })
        : distributionType === 'npx'
          ? JSON.stringify({ distributionType: 'npx', cmd: agent.distribution.npx?.package ?? agentId, args: agent.distribution.npx?.args ?? [] })
          : JSON.stringify({ distributionType: 'uvx', cmd: agent.distribution.uvx?.package ?? agentId, args: agent.distribution.uvx?.args ?? [] })

      getDb()
        .insert(agentProfiles)
        .values({
          id: `acp:${agentId}`,
          name: agent.name,
          providerKind: 'acp-chat',
          enabled: true,
          configJson,
          credentialRef: null,
        })
        .onConflictDoUpdate({
          target: agentProfiles.id,
          set: { name: agent.name, enabled: true, configJson },
        })
        .run()
    }
    catch (err) {
      persistFailed(agentId, err)
      throw err
    }

    return getDb().select().from(acpAgents).where(eq(acpAgents.id, agentId)).get()!
  }

  // ── Cancel install ────────────────────────────────────────────────────────

  @IpcMethod()
  cancelInstall(agentId: string): void {
    const controller = this.installAbortControllers.get(agentId)
    if (controller) {
      controller.abort()
    }
    // Mark as failed in DB regardless so the UI resets
    const now = Math.floor(Date.now() / 1000)
    getDb()
      .update(acpAgents)
      .set({ status: 'failed', updatedAt: now })
      .where(eq(acpAgents.id, agentId))
      .run()
  }

  // ── Uninstall ─────────────────────────────────────────────────────────────

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
      getDb()
        .insert(acpAuditLog)
        .values({ agentId, action: 'uninstall_start', path: null, details: JSON.stringify({ distributionType: record.distributionType }) })
        .run()
      getDb()
        .insert(acpAuditLog)
        .values({ agentId, action: 'uninstall_complete', path: null, details: '{}' })
        .run()
    }

    getDb().delete(acpAgents).where(eq(acpAgents.id, agentId)).run()

    // Remove the auto-created agent profile when uninstalling
    getDb().delete(agentProfiles).where(eq(agentProfiles.id, `acp:${agentId}`)).run()
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

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

  @IpcMethod()
  getAgentInstallPath(agentId: string): string {
    return getAgentInstallDir(app.getPath('userData'), agentId)
  }

  // ── Runtime: Start / Stop ─────────────────────────────────────────────────

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

  @IpcMethod()
  async stopAgent(agentId: string): Promise<void> {
    await AcpConnectionManager.getInstance().disconnect(agentId)
  }

  @IpcMethod()
  isAgentRunning(agentId: string): boolean {
    return AcpConnectionManager.getInstance().isConnected(agentId)
  }

  // ── Runtime: Sessions ─────────────────────────────────────────────────────

  @IpcMethod()
  async createSession(agentId: string, cwd: string): Promise<Record<string, unknown>> {
    const result = await AcpConnectionManager.getInstance().newSession(agentId, cwd)
    return result as unknown as Record<string, unknown>
  }

  @IpcMethod()
  async sendPrompt(agentId: string, sessionId: string, message: string): Promise<Record<string, unknown>> {
    const result = await AcpConnectionManager.getInstance().prompt(agentId, sessionId, message)
    return result as unknown as Record<string, unknown>
  }

  @IpcMethod()
  async cancelPrompt(agentId: string, sessionId: string): Promise<void> {
    await AcpConnectionManager.getInstance().cancel(agentId, sessionId)
  }

  // ── Runtime: Session model / config ───────────────────────────────────────

  @IpcMethod()
  getSessionState(agentId: string, sessionId: string): import('../lib/acp-connection').AcpSessionState | null {
    return AcpConnectionManager.getInstance().getSessionState(agentId, sessionId)
  }

  @IpcMethod()
  async setSessionModel(agentId: string, sessionId: string, modelId: string): Promise<void> {
    await AcpConnectionManager.getInstance().setSessionModel(agentId, sessionId, modelId)
  }

  @IpcMethod()
  async setSessionConfigOption(
    agentId: string,
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void> {
    await AcpConnectionManager.getInstance().setSessionConfigOption(agentId, sessionId, configId, value)
  }

  // ── Runtime: Metrics ─────────────────────────────────────────────────────

  @IpcMethod()
  getRunningAgentMetrics(): ProcessMetrics[] {
    return AcpProcessManager.getInstance().getMetrics()
  }
}
