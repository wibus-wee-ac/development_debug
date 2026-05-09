// Input: DbAccessor and identity/runtime tables
// Output: DB-backed saved profile lifecycle helpers
// Position: apps/server/src/modules/profiles/profiles.store.ts

import {
  agentProfiles,
  agents,
  agentSessions,
  backendCapabilitySnapshots,
  runtimeAuditLog,
  usageLogs,
} from '@cradle/db'
import type { AgentProfile } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'
import type { ProviderKind } from '../providers/types'

export interface UpsertProfileInput {
  id: string
  name: string
  providerKind: ProviderKind
  enabled: boolean
  configJson: string
  credentialRef: string | null
}

@injectable()
export class ProfilesStore {
  constructor(private readonly dbAccessor: DbAccessor) {}

  listProfiles(): AgentProfile[] {
    return this.dbAccessor.get().select().from(agentProfiles).orderBy(agentProfiles.name).all()
  }

  getProfile(id: string): AgentProfile | undefined {
    return this.dbAccessor.get().select().from(agentProfiles).where(eq(agentProfiles.id, id)).get()
  }

  upsertProfile(input: UpsertProfileInput): AgentProfile {
    const now = Math.floor(Date.now() / 1000)
    this.dbAccessor.get().insert(agentProfiles)
      .values({
        id: input.id,
        name: input.name,
        providerKind: input.providerKind,
        enabled: input.enabled,
        configJson: input.configJson,
        credentialRef: input.credentialRef,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: agentProfiles.id,
        set: {
          name: input.name,
          providerKind: input.providerKind,
          enabled: input.enabled,
          configJson: input.configJson,
          credentialRef: input.credentialRef,
          updatedAt: now,
        },
      })
      .run()

    return this.getProfile(input.id)!
  }

  removeProfile(id: string): void {
    const db = this.dbAccessor.get()
    db.transaction((tx) => {
      tx.delete(agents).where(eq(agents.agentProfileId, id)).run()
      tx.delete(agentSessions).where(eq(agentSessions.agentProfileId, id)).run()
      tx.delete(backendCapabilitySnapshots).where(eq(backendCapabilitySnapshots.agentProfileId, id)).run()
      tx.delete(runtimeAuditLog).where(eq(runtimeAuditLog.agentProfileId, id)).run()
      tx.delete(usageLogs).where(eq(usageLogs.agentProfileId, id)).run()
      tx.delete(agentProfiles).where(eq(agentProfiles.id, id)).run()
    })
  }
}