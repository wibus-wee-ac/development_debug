// Input: Electron app plus ACP feature application service and platform bridges
// Output: AcpService IPC adapter for ACP registry, install lifecycle, runtime sessions, audit, and metrics
// Position: App-level IPC surface for ACP management in the main process

import { IpcMethod, IpcService } from '@cradle/ipc'
import { app } from 'electron'

import { getDb } from '../../db'
import type { AcpAgent, AcpAuditEntry } from '../../db/schema'
import type { AcpApplicationService } from '../../acp-feature/acp'
import { createAcpApplicationService, createDbAcpStore } from '../../acp-feature/acp'
import { acpConnectionManager } from '../../acp/acp-connection'
import {
  getAgentInstallDir,
  installBinaryAgent,
  installPackageAgent,
  uninstallBinaryAgent,
} from '../../acp/acp-installer'
import type { ProcessMetrics } from '../../acp/acp-process-manager'
import { acpProcessManager } from '../../acp/acp-process-manager'
import type { RegistryAgent } from '../../acp/acp-registry'
import { fetchRegistry, getSupportedDistributionTypes } from '../../acp/acp-registry'

function createDefaultAcpApplication(): AcpApplicationService {
  return createAcpApplicationService({
    registry: {
      fetchRegistry: async () => (await fetchRegistry()).agents,
      getSupportedDistributionTypes,
    },
    store: createDbAcpStore(getDb()),
    installer: {
      installBinaryAgent,
      installPackageAgent,
      uninstallBinaryAgent,
    },
    runtime: {
      async startAgent(agentId, record) {
        const initResult = await acpConnectionManager.connect(agentId, record)
        return initResult as unknown as Record<string, unknown>
      },
      stopAgent: agentId => acpConnectionManager.disconnect(agentId),
      isAgentRunning: agentId => acpConnectionManager.isConnected(agentId),
      async createSession(agentId, cwd) {
        const result = await acpConnectionManager.newSession(agentId, cwd)
        return result as unknown as Record<string, unknown>
      },
      async sendPrompt(agentId, sessionId, message) {
        const result = await acpConnectionManager.prompt(agentId, sessionId, message)
        return result as unknown as Record<string, unknown>
      },
      cancelPrompt: (agentId, sessionId) => acpConnectionManager.cancel(agentId, sessionId),
      getSessionState: (agentId, sessionId) => acpConnectionManager.getSessionState(agentId, sessionId),
      setSessionModel: (agentId, sessionId, modelId) => acpConnectionManager.setSessionModel(agentId, sessionId, modelId),
      setSessionConfigOption: (agentId, sessionId, configId, value) => acpConnectionManager.setSessionConfigOption(agentId, sessionId, configId, value),
      getRunningAgentMetrics: () => acpProcessManager.getMetrics(),
    },
    paths: {
      getUserDataPath: () => app.getPath('userData'),
      getAgentInstallPath: agentId => getAgentInstallDir(app.getPath('userData'), agentId),
    },
  })
}

export class AcpService extends IpcService {
  static readonly groupName = 'acp'

  private readonly appService: AcpApplicationService

  constructor(appService: AcpApplicationService = createDefaultAcpApplication()) {
    super()
    this.appService = appService
  }

  // ── Registry ──────────────────────────────────────────────────────────────

  @IpcMethod()
  async fetchRegistry(): Promise<RegistryAgent[]> {
    return this.appService.fetchRegistry()
  }

  @IpcMethod()
  async getDistributionTypes(agentId: string): Promise<Array<'binary' | 'npx' | 'uvx'>> {
    return this.appService.getDistributionTypes(agentId)
  }

  // ── Installed agents ──────────────────────────────────────────────────────

  @IpcMethod()
  listInstalled(): AcpAgent[] {
    return this.appService.listInstalled()
  }

  @IpcMethod()
  getInstalled(agentId: string): AcpAgent | undefined {
    return this.appService.getInstalled(agentId)
  }

  // ── Install ───────────────────────────────────────────────────────────────

  @IpcMethod()
  async install(agentId: string, distributionType: 'binary' | 'npx' | 'uvx'): Promise<AcpAgent> {
    return this.appService.install(agentId, distributionType)
  }

  // ── Cancel install ────────────────────────────────────────────────────────

  @IpcMethod()
  cancelInstall(agentId: string): void {
    this.appService.cancelInstall(agentId)
  }

  // ── Uninstall ─────────────────────────────────────────────────────────────

  @IpcMethod()
  async uninstall(agentId: string): Promise<void> {
    await this.appService.uninstall(agentId)
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  @IpcMethod()
  getAuditLog(agentId?: string): AcpAuditEntry[] {
    return this.appService.getAuditLog(agentId)
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  @IpcMethod()
  getAgentInstallPath(agentId: string): string {
    return this.appService.getAgentInstallPath(agentId)
  }

  // ── Runtime: Start / Stop ─────────────────────────────────────────────────

  @IpcMethod()
  async startAgent(agentId: string): Promise<Record<string, unknown>> {
    return this.appService.startAgent(agentId)
  }

  @IpcMethod()
  async stopAgent(agentId: string): Promise<void> {
    await this.appService.stopAgent(agentId)
  }

  @IpcMethod()
  isAgentRunning(agentId: string): boolean {
    return this.appService.isAgentRunning(agentId)
  }

  // ── Runtime: Sessions ─────────────────────────────────────────────────────

  @IpcMethod()
  async createSession(agentId: string, cwd: string): Promise<Record<string, unknown>> {
    return this.appService.createSession(agentId, cwd)
  }

  @IpcMethod()
  async sendPrompt(agentId: string, sessionId: string, message: string): Promise<Record<string, unknown>> {
    return this.appService.sendPrompt(agentId, sessionId, message)
  }

  @IpcMethod()
  async cancelPrompt(agentId: string, sessionId: string): Promise<void> {
    await this.appService.cancelPrompt(agentId, sessionId)
  }

  // ── Runtime: Session model / config ───────────────────────────────────────

  @IpcMethod()
  getSessionState(agentId: string, sessionId: string): import('../../acp/acp-connection').AcpSessionState | null {
    return this.appService.getSessionState(agentId, sessionId)
  }

  @IpcMethod()
  async setSessionModel(agentId: string, sessionId: string, modelId: string): Promise<void> {
    await this.appService.setSessionModel(agentId, sessionId, modelId)
  }

  @IpcMethod()
  async setSessionConfigOption(
    agentId: string,
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void> {
    await this.appService.setSessionConfigOption(agentId, sessionId, configId, value)
  }

  // ── Runtime: Metrics ─────────────────────────────────────────────────────

  @IpcMethod()
  getRunningAgentMetrics(): ProcessMetrics[] {
    return this.appService.getRunningAgentMetrics()
  }
}
