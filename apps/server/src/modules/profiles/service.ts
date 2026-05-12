import type { AgentProfile } from '@cradle/db'
import {
  agentProfiles,
  agents,
  agentSessions,
  backendCapabilitySnapshots,
  runtimeAuditLog,
  usageLogs,
} from '@cradle/db'
import { eq } from 'drizzle-orm'

import { db } from '../../infra'
import type { ProviderKind } from '../providers/types'
import * as Session from '../session/service'

// ── types ──

export interface UpsertProfileInput {
  id: string
  name: string
  providerKind: ProviderKind
  enabled: boolean
  configJson: string
  credentialRef: string | null
}

// ── public API ──

export function listProfiles(): AgentProfile[] {
  return db().select().from(agentProfiles).orderBy(agentProfiles.name).all()
}

export function getProfile(id: string): AgentProfile | null {
  return db().select().from(agentProfiles).where(eq(agentProfiles.id, id)).get() ?? null
}

export function upsertProfile(input: UpsertProfileInput): AgentProfile {
  const now = Math.floor(Date.now() / 1000)
  db().insert(agentProfiles).values({
      id: input.id,
      name: input.name,
      providerKind: input.providerKind,
      enabled: input.enabled,
      configJson: input.configJson,
      credentialRef: input.credentialRef,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: agentProfiles.id,
      set: {
        name: input.name,
        providerKind: input.providerKind,
        enabled: input.enabled,
        configJson: input.configJson,
        credentialRef: input.credentialRef,
        updatedAt: now,
      },
    }).run()

  return db().select().from(agentProfiles).where(eq(agentProfiles.id, input.id)).get()!
}

export function removeProfile(id: string): void {
  Session.deleteByAgentProfile(id)
  const d = db()
  d.transaction((tx) => {
    tx.delete(agents).where(eq(agents.agentProfileId, id)).run()
    tx.delete(agentSessions).where(eq(agentSessions.agentProfileId, id)).run()
    tx.delete(backendCapabilitySnapshots).where(eq(backendCapabilitySnapshots.agentProfileId, id)).run()
    tx.delete(runtimeAuditLog).where(eq(runtimeAuditLog.agentProfileId, id)).run()
    tx.delete(usageLogs).where(eq(usageLogs.agentProfileId, id)).run()
    tx.delete(agentProfiles).where(eq(agentProfiles.id, id)).run()
  })
}
