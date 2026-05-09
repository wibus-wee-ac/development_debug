// Input: DbAccessor plus ACP schema tables
// Output: DB-backed ACP install and audit persistence
// Position: apps/server/src/modules/acp/acp.store.ts

import type { AcpAgent, AcpAuditEntry } from '@cradle/db'
import { acpAgents, acpAuditLog } from '@cradle/db'
import { desc, eq } from 'drizzle-orm'
import { inject, injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'
import type { InstallResult } from './acp.installer'
import type { AcpDistributionType, RegistryAgent } from './acp.registry'

@injectable()
export class AcpStore {
  constructor(@inject(DbAccessor) private readonly dbAccessor: DbAccessor) {}

  listInstalled(): AcpAgent[] {
    return this.dbAccessor.get().select().from(acpAgents).orderBy(desc(acpAgents.updatedAt)).all()
  }

  getInstalled(agentId: string): AcpAgent | undefined {
    return this.dbAccessor.get().select().from(acpAgents).where(eq(acpAgents.id, agentId)).get()
  }

  markInstalling(input: { agentId: string, name: string, version: string, distributionType: AcpDistributionType }): void {
    const now = nowUnix()
    this.dbAccessor.get().insert(acpAgents).values({
      id: input.agentId,
      name: input.name,
      version: input.version,
      distributionType: input.distributionType,
      status: 'installing',
      updatedAt: now,
    }).onConflictDoUpdate({
      target: acpAgents.id,
      set: {
        name: input.name,
        version: input.version,
        distributionType: input.distributionType,
        status: 'installing',
        updatedAt: now,
      },
    }).run()
  }

  saveInstalled(input: { agent: RegistryAgent, distributionType: AcpDistributionType, result: InstallResult }): void {
    const now = nowUnix()
    this.dbAccessor.get().insert(acpAgents).values({
      id: input.agent.id,
      name: input.agent.name,
      version: input.agent.version,
      distributionType: input.distributionType,
      installPath: input.result.installPath,
      cmd: input.result.cmd,
      args: JSON.stringify(input.result.args ?? []),
      env: JSON.stringify(input.result.env ?? {}),
      status: 'installed',
      updatedAt: now,
    }).onConflictDoUpdate({
      target: acpAgents.id,
      set: {
        name: input.agent.name,
        version: input.agent.version,
        distributionType: input.distributionType,
        installPath: input.result.installPath,
        cmd: input.result.cmd,
        args: JSON.stringify(input.result.args ?? []),
        env: JSON.stringify(input.result.env ?? {}),
        status: 'installed',
        updatedAt: now,
      },
    }).run()
  }

  markFailed(agentId: string): void {
    const now = nowUnix()
    const existing = this.getInstalled(agentId)
    this.dbAccessor.get().insert(acpAgents).values({
      id: agentId,
      name: existing?.name ?? agentId,
      version: existing?.version ?? '0.0.0',
      distributionType: existing?.distributionType ?? 'npx',
      installPath: existing?.installPath ?? null,
      cmd: existing?.cmd ?? null,
      args: existing?.args ?? '[]',
      env: existing?.env ?? '{}',
      status: 'failed',
      updatedAt: now,
    }).onConflictDoUpdate({
      target: acpAgents.id,
      set: {
        status: 'failed',
        updatedAt: now,
      },
    }).run()
  }

  deleteInstalled(agentId: string): void {
    this.dbAccessor.get().delete(acpAgents).where(eq(acpAgents.id, agentId)).run()
  }

  getAuditLog(agentId?: string): AcpAuditEntry[] {
    if (agentId) {
      return this.dbAccessor.get().select().from(acpAuditLog).where(eq(acpAuditLog.agentId, agentId)).orderBy(desc(acpAuditLog.id)).all()
    }
    return this.dbAccessor.get().select().from(acpAuditLog).orderBy(desc(acpAuditLog.id)).all()
  }

  recordAudit(input: { agentId: string, action: string, path: string | null, details?: Record<string, unknown> }): void {
    this.dbAccessor.get().insert(acpAuditLog).values({
      agentId: input.agentId,
      action: input.action,
      path: input.path,
      details: JSON.stringify(input.details ?? {}),
    }).run()
  }
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}
