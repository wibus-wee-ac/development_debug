// Input: ACP registry, installer, store, and server config
// Output: ACP management semantics for registry, install lifecycle, and audit
// Position: apps/server/src/modules/acp/acp.service.ts

import { dirname } from 'node:path'

import type { AcpAgent } from '@cradle/db'
import { inject, injectable } from 'tsyringe'

import { ServerConfig } from '../../config/server-config'
import { AppError } from '../../errors/app-error'
import type { InstallResult } from './acp.installer'
import { AcpInstaller } from './acp.installer'
import type { AcpDistributionType, RegistryAgent } from './acp.registry'
import { AcpRegistry } from './acp.registry'
import { AcpStore } from './acp.store'

@injectable()
export class AcpService {
  private readonly installAbortControllers = new Map<string, AbortController>()

  constructor(
    @inject(AcpRegistry) private readonly registry: AcpRegistry,
    @inject(AcpInstaller) private readonly installer: AcpInstaller,
    @inject(AcpStore) private readonly store: AcpStore,
    @inject(ServerConfig) private readonly serverConfig: ServerConfig,
  ) {}

  fetchRegistry(): Promise<RegistryAgent[]> {
    return this.registry.fetchRegistry()
  }

  async getDistributionTypes(agentId: string): Promise<AcpDistributionType[]> {
    const agent = await this.findRegistryAgent(agentId)
    if (!agent) {
      throw new AppError({
        code: 'acp_agent_not_found',
        status: 404,
        message: 'ACP agent not found in registry',
        details: { agentId },
      })
    }
    return this.registry.getSupportedDistributionTypes(agent)
  }

  listInstalled(): AcpAgent[] {
    return this.store.listInstalled()
  }

  getInstalled(agentId: string): AcpAgent | null {
    return this.store.getInstalled(agentId) ?? null
  }

  async install(agentId: string, distributionType: AcpDistributionType): Promise<AcpAgent> {
    const agent = await this.findRegistryAgent(agentId)
    if (!agent) {
      throw new AppError({
        code: 'acp_agent_not_found',
        status: 404,
        message: 'ACP agent not found in registry',
        details: { agentId },
      })
    }

    const supportedTypes = this.registry.getSupportedDistributionTypes(agent)
    if (!supportedTypes.includes(distributionType)) {
      throw new AppError({
        code: 'acp_distribution_not_supported',
        status: 409,
        message: 'Requested ACP distribution is not supported for this agent on the current platform',
        details: { agentId, distributionType, supportedTypes },
      })
    }

    this.store.markInstalling({
      agentId,
      name: agent.name,
      version: agent.version,
      distributionType,
    })
    this.store.recordAudit({
      agentId,
      action: 'install_start',
      path: null,
      details: { distributionType },
    })

    try {
      const result = distributionType === 'binary'
        ? await this.installBinary(agentId, agent)
        : this.installer.installPackageAgent(agent, distributionType)

      this.store.saveInstalled({ agent, distributionType, result })
      this.store.recordAudit({
        agentId,
        action: 'install_complete',
        path: result.installPath,
        details: { distributionType, cmd: result.cmd, args: result.args },
      })
      return this.store.getInstalled(agentId)!
    }
    catch (error) {
      this.store.markFailed(agentId)
      this.store.recordAudit({
        agentId,
        action: 'install_failed',
        path: null,
        details: { distributionType, error: stringifyError(error) },
      })
      throw error
    }
  }

  cancelInstall(agentId: string): void {
    const controller = this.installAbortControllers.get(agentId)
    if (controller) {
      controller.abort()
      this.installAbortControllers.delete(agentId)
    }
    this.store.markFailed(agentId)
    this.store.recordAudit({
      agentId,
      action: 'install_failed',
      path: null,
      details: { cancelled: true },
    })
  }

  async uninstall(agentId: string): Promise<void> {
    const record = this.store.getInstalled(agentId)
    if (!record) {
      throw new AppError({
        code: 'acp_agent_not_installed',
        status: 404,
        message: 'ACP agent is not installed',
        details: { agentId },
      })
    }

    this.store.recordAudit({
      agentId,
      action: 'uninstall_start',
      path: record.installPath,
      details: { distributionType: record.distributionType },
    })

    if (record.distributionType === 'binary' && record.installPath) {
      await this.installer.uninstallBinaryAgent(agentId, record.installPath, this.getRuntimeDataDir())
    }

    this.store.deleteInstalled(agentId)
    this.store.recordAudit({
      agentId,
      action: 'uninstall_complete',
      path: record.installPath,
      details: { distributionType: record.distributionType },
    })
  }

  getAuditLog(agentId?: string) {
    return this.store.getAuditLog(agentId)
  }

  getAgentInstallPath(agentId: string): string {
    return this.installer.getAgentInstallDir(this.getRuntimeDataDir(), agentId)
  }

  private async findRegistryAgent(agentId: string): Promise<RegistryAgent | undefined> {
    const agents = await this.registry.fetchRegistry()
    return agents.find(agent => agent.id === agentId)
  }

  private async installBinary(agentId: string, agent: RegistryAgent): Promise<InstallResult> {
    const controller = new AbortController()
    this.installAbortControllers.set(agentId, controller)
    try {
      return await this.installer.installBinaryAgent(agent, this.getRuntimeDataDir(), controller.signal)
    }
    finally {
      this.installAbortControllers.delete(agentId)
    }
  }

  private getRuntimeDataDir(): string {
    const config = this.serverConfig.get()
    return config.dataDir ?? dirname(config.dbPath)
  }
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
