// Input: ACP registry/installer/runtime dependencies plus DB-backed persistence stores
// Output: ACP application service and DB store for installed agents, audit queries, and auto-created ACP profiles
// Position: Feature-owned coordination for ACP registry browsing, install lifecycle, runtime sessions, and profile synchronization

import { desc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type * as schema from '../db/schema'
import type { AcpAgent, AcpAuditEntry } from '../db/schema'
import { acpAgents, acpAuditLog, agentProfiles } from '../db/schema'
import type { AcpSessionState } from '../acp/acp-connection'
import type { InstallResult } from '../acp/acp-installer'
import type { ProcessMetrics } from '../acp/acp-process-manager'
import type { RegistryAgent } from '../acp/acp-registry'

export type AcpDistributionType = 'binary' | 'npx' | 'uvx'

export interface AcpRegistryCatalog {
  fetchRegistry: () => Promise<RegistryAgent[]>
  getSupportedDistributionTypes: (agent: RegistryAgent) => AcpDistributionType[]
}

export interface AcpInstallerBridge {
  installBinaryAgent: (agent: RegistryAgent, userData: string, signal?: AbortSignal) => Promise<InstallResult>
  installPackageAgent: (agent: RegistryAgent, type: 'npx' | 'uvx') => InstallResult
  uninstallBinaryAgent: (agentId: string, installPath: string, userData: string) => Promise<void>
}

export interface AcpRuntimeController {
  startAgent: (agentId: string, record: AcpAgent) => Promise<Record<string, unknown>>
  stopAgent: (agentId: string) => Promise<void>
  isAgentRunning: (agentId: string) => boolean
  createSession: (agentId: string, cwd: string) => Promise<Record<string, unknown>>
  sendPrompt: (agentId: string, sessionId: string, message: string) => Promise<Record<string, unknown>>
  cancelPrompt: (agentId: string, sessionId: string) => Promise<void>
  getSessionState: (agentId: string, sessionId: string) => AcpSessionState | null
  setSessionModel: (agentId: string, sessionId: string, modelId: string) => Promise<void>
  setSessionConfigOption: (agentId: string, sessionId: string, configId: string, value: string | boolean) => Promise<void>
  getRunningAgentMetrics: () => ProcessMetrics[]
}

export interface AcpPathProvider {
  getUserDataPath: () => string
  getAgentInstallPath: (agentId: string) => string
}

export interface AcpStore {
  listInstalled: () => AcpAgent[]
  getInstalled: (agentId: string) => AcpAgent | undefined
  markInstalling: (input: {
    agentId: string
    name: string
    version: string
    distributionType: AcpDistributionType
  }) => void
  saveInstalled: (input: {
    agent: RegistryAgent
    distributionType: AcpDistributionType
    result: InstallResult
  }) => void
  markFailed: (agentId: string) => void
  deleteInstalled: (agentId: string) => void
  getAuditLog: (agentId?: string) => AcpAuditEntry[]
  recordAudit: (input: {
    agentId: string
    action: string
    path: string | null
    details?: Record<string, unknown>
  }) => void
  upsertAutoProfile: (input: {
    agentId: string
    name: string
    configJson: string
  }) => void
  deleteAutoProfile: (agentId: string) => void
}

export interface AcpApplicationService {
  fetchRegistry: () => Promise<RegistryAgent[]>
  getDistributionTypes: (agentId: string) => Promise<AcpDistributionType[]>
  listInstalled: () => AcpAgent[]
  getInstalled: (agentId: string) => AcpAgent | undefined
  install: (agentId: string, distributionType: AcpDistributionType) => Promise<AcpAgent>
  cancelInstall: (agentId: string) => void
  uninstall: (agentId: string) => Promise<void>
  getAuditLog: (agentId?: string) => AcpAuditEntry[]
  getAgentInstallPath: (agentId: string) => string
  startAgent: (agentId: string) => Promise<Record<string, unknown>>
  stopAgent: (agentId: string) => Promise<void>
  isAgentRunning: (agentId: string) => boolean
  createSession: (agentId: string, cwd: string) => Promise<Record<string, unknown>>
  sendPrompt: (agentId: string, sessionId: string, message: string) => Promise<Record<string, unknown>>
  cancelPrompt: (agentId: string, sessionId: string) => Promise<void>
  getSessionState: (agentId: string, sessionId: string) => AcpSessionState | null
  setSessionModel: (agentId: string, sessionId: string, modelId: string) => Promise<void>
  setSessionConfigOption: (agentId: string, sessionId: string, configId: string, value: string | boolean) => Promise<void>
  getRunningAgentMetrics: () => ProcessMetrics[]
}

export function createDbAcpStore(
  db: BetterSQLite3Database<typeof schema>,
): AcpStore {
  return {
    listInstalled() {
      return db.select().from(acpAgents).orderBy(desc(acpAgents.updatedAt)).all()
    },
    getInstalled(agentId) {
      return db.select().from(acpAgents).where(eq(acpAgents.id, agentId)).get()
    },
    markInstalling({ agentId, name, version, distributionType }) {
      const now = Math.floor(Date.now() / 1000)
      db.insert(acpAgents)
        .values({
          id: agentId,
          name,
          version,
          distributionType,
          status: 'installing',
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: acpAgents.id,
          set: {
            name,
            version,
            distributionType,
            status: 'installing',
            updatedAt: now,
          },
        })
        .run()
    },
    saveInstalled({ agent, distributionType, result }) {
      const now = Math.floor(Date.now() / 1000)
      db.insert(acpAgents)
        .values({
          id: agent.id,
          name: agent.name,
          version: agent.version,
          distributionType,
          installPath: result.installPath,
          cmd: result.cmd,
          args: JSON.stringify(result.args ?? []),
          env: JSON.stringify(result.env ?? {}),
          status: 'installed',
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: acpAgents.id,
          set: {
            name: agent.name,
            version: agent.version,
            distributionType,
            installPath: result.installPath,
            cmd: result.cmd,
            args: JSON.stringify(result.args ?? []),
            env: JSON.stringify(result.env ?? {}),
            status: 'installed',
            updatedAt: now,
          },
        })
        .run()
    },
    markFailed(agentId) {
      const now = Math.floor(Date.now() / 1000)
      const existing = db.select().from(acpAgents).where(eq(acpAgents.id, agentId)).get()
      db.insert(acpAgents)
        .values({
          id: agentId,
          name: existing?.name ?? agentId,
          version: existing?.version ?? '0.0.0',
          distributionType: (existing?.distributionType as AcpDistributionType | undefined) ?? 'npx',
          installPath: existing?.installPath ?? null,
          cmd: existing?.cmd ?? null,
          args: existing?.args ?? '[]',
          env: existing?.env ?? '{}',
          status: 'failed',
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: acpAgents.id,
          set: {
            status: 'failed',
            updatedAt: now,
          },
        })
        .run()
    },
    deleteInstalled(agentId) {
      db.delete(acpAgents).where(eq(acpAgents.id, agentId)).run()
    },
    getAuditLog(agentId) {
      if (agentId) {
        return db
          .select()
          .from(acpAuditLog)
          .where(eq(acpAuditLog.agentId, agentId))
          .orderBy(desc(acpAuditLog.id))
          .all()
      }
      return db.select().from(acpAuditLog).orderBy(desc(acpAuditLog.id)).all()
    },
    recordAudit({ agentId, action, path, details = {} }) {
      db.insert(acpAuditLog)
        .values({
          agentId,
          action,
          path,
          details: JSON.stringify(details),
        })
        .run()
    },
    upsertAutoProfile({ agentId, name, configJson }) {
      db.insert(agentProfiles)
        .values({
          id: `acp:${agentId}`,
          name,
          providerKind: 'acp-chat',
          enabled: true,
          configJson,
          credentialRef: null,
        })
        .onConflictDoUpdate({
          target: agentProfiles.id,
          set: {
            name,
            enabled: true,
            configJson,
          },
        })
        .run()
    },
    deleteAutoProfile(agentId) {
      db.delete(agentProfiles).where(eq(agentProfiles.id, `acp:${agentId}`)).run()
    },
  }
}

interface AcpApplicationDeps {
  registry: AcpRegistryCatalog
  store: AcpStore
  installer: AcpInstallerBridge
  runtime: AcpRuntimeController
  paths: AcpPathProvider
}

export function createAcpApplicationService(
  deps: AcpApplicationDeps,
): AcpApplicationService {
  const installAbortControllers = new Map<string, AbortController>()

  const getRegistryAgent = async (agentId: string): Promise<RegistryAgent | undefined> => {
    const registry = await deps.registry.fetchRegistry()
    return registry.find(agent => agent.id === agentId)
  }

  const getInstalledOrThrow = (agentId: string): AcpAgent => {
    const record = deps.store.getInstalled(agentId)
    if (!record) {
      throw new Error(`Agent not installed: ${agentId}`)
    }
    return record
  }

  return {
    fetchRegistry: () => deps.registry.fetchRegistry(),
    async getDistributionTypes(agentId) {
      const agent = await getRegistryAgent(agentId)
      if (!agent) {
        return []
      }
      return deps.registry.getSupportedDistributionTypes(agent)
    },
    listInstalled: () => deps.store.listInstalled(),
    getInstalled: agentId => deps.store.getInstalled(agentId),
    async install(agentId, distributionType) {
      const agent = await getRegistryAgent(agentId)
      if (!agent) {
        throw new Error(`Agent not found in registry: ${agentId}`)
      }

      deps.store.markInstalling({
        agentId,
        name: agent.name,
        version: agent.version,
        distributionType,
      })

      try {
        const result = distributionType === 'binary'
          ? await installBinary(agentId, agent, deps, installAbortControllers)
          : deps.installer.installPackageAgent(agent, distributionType)

        deps.store.saveInstalled({ agent, distributionType, result })
        deps.store.upsertAutoProfile({
          agentId,
          name: agent.name,
          configJson: buildAutoProfileConfigJson(agentId, distributionType, result),
        })

        return deps.store.getInstalled(agentId)!
      }
      catch (error) {
        deps.store.markFailed(agentId)
        deps.store.recordAudit({
          agentId,
          action: 'install_failed',
          path: null,
          details: { error: String(error) },
        })
        throw error
      }
    },
    cancelInstall(agentId) {
      const controller = installAbortControllers.get(agentId)
      if (controller) {
        controller.abort()
      }
      deps.store.markFailed(agentId)
    },
    async uninstall(agentId) {
      const record = getInstalledOrThrow(agentId)

      if (record.distributionType === 'binary' && record.installPath) {
        await deps.installer.uninstallBinaryAgent(agentId, record.installPath, deps.paths.getUserDataPath())
      }
      else {
        deps.store.recordAudit({
          agentId,
          action: 'uninstall_start',
          path: null,
          details: { distributionType: record.distributionType },
        })
        deps.store.recordAudit({
          agentId,
          action: 'uninstall_complete',
          path: null,
          details: {},
        })
      }

      deps.store.deleteInstalled(agentId)
      deps.store.deleteAutoProfile(agentId)
    },
    getAuditLog: agentId => deps.store.getAuditLog(agentId),
    getAgentInstallPath: agentId => deps.paths.getAgentInstallPath(agentId),
    async startAgent(agentId) {
      const record = getInstalledOrThrow(agentId)
      if (record.status !== 'installed') {
        throw new Error(`Agent not installed or not ready: ${agentId}`)
      }
      return deps.runtime.startAgent(agentId, record)
    },
    stopAgent: agentId => deps.runtime.stopAgent(agentId),
    isAgentRunning: agentId => deps.runtime.isAgentRunning(agentId),
    createSession: (agentId, cwd) => deps.runtime.createSession(agentId, cwd),
    sendPrompt: (agentId, sessionId, message) => deps.runtime.sendPrompt(agentId, sessionId, message),
    cancelPrompt: (agentId, sessionId) => deps.runtime.cancelPrompt(agentId, sessionId),
    getSessionState: (agentId, sessionId) => deps.runtime.getSessionState(agentId, sessionId),
    setSessionModel: (agentId, sessionId, modelId) => deps.runtime.setSessionModel(agentId, sessionId, modelId),
    setSessionConfigOption: (agentId, sessionId, configId, value) => deps.runtime.setSessionConfigOption(agentId, sessionId, configId, value),
    getRunningAgentMetrics: () => deps.runtime.getRunningAgentMetrics(),
  }
}

async function installBinary(
  agentId: string,
  agent: RegistryAgent,
  deps: AcpApplicationDeps,
  installAbortControllers: Map<string, AbortController>,
): Promise<InstallResult> {
  const controller = new AbortController()
  installAbortControllers.set(agentId, controller)
  try {
    return await deps.installer.installBinaryAgent(agent, deps.paths.getUserDataPath(), controller.signal)
  }
  finally {
    installAbortControllers.delete(agentId)
  }
}

function buildAutoProfileConfigJson(
  agentId: string,
  distributionType: AcpDistributionType,
  result: InstallResult,
): string {
  const payload: Record<string, unknown> = {
    distributionType,
    cmd: result.cmd ?? agentId,
    args: result.args ?? [],
  }
  if (distributionType === 'binary') {
    payload.installPath = result.installPath
  }
  return JSON.stringify(payload)
}