// Input: agent profile store, runtime audit store, provider catalog, and credential store dependencies
// Output: Agent runtime application service plus DB-backed stores for profiles, credentials, audit logging, and capability capture
// Position: Feature-owned coordination for profile CRUD, provider probe/models, credential workflows, and probe capability snapshots

import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type * as schema from '../../db/schema'
import {
  agentCredentials,
  agentProfiles,
  agents,
  agentSessions,
  backendCapabilitySnapshots,
  runtimeAuditLog,
  sessions,
  usageLogs,
} from '../../db/schema'
import { getProviderCatalog } from './catalog-instance'
import type {
  CredentialCipher,
  CredentialMetadata,
  SaveCredentialInput,
} from './credential-vault'
import { maskSecret } from './credential-vault'
import type { ProviderCatalog } from './provider-catalog'
import type {
  AgentProfile,
  ModelDescriptor,
  ProviderKind,
  ProviderProbeResult,
} from './runtime-provider-types'
import type { BackendCapabilityRecorder } from '../backend-control-plane/backend-control-plane'

export type EditableAgentProfile = Omit<AgentProfile, 'createdAt' | 'updatedAt'>

export interface AgentProfileStore {
  listProfiles: () => AgentProfile[]
  getProfile: (id: string) => AgentProfile | undefined
  upsertProfile: (input: EditableAgentProfile) => AgentProfile
  removeProfile: (id: string) => void
}

export interface AgentRuntimeCredentialStore {
  save: (input: SaveCredentialInput) => CredentialMetadata
  readSecret: (id: string) => string
  remove: (id: string) => void
  list: () => CredentialMetadata[]
}

export interface RuntimeAuditStore {
  recordProbe: (input: {
    profileId: string
    providerKind: ProviderKind
    subject: string
    ok: boolean
    errorText: string | null
  }) => void
  recordModelList: (input: {
    profileId: string
    providerKind: ProviderKind
    subject: string
    count: number
  }) => void
}

export interface AgentRuntimeApplicationService {
  listProfiles: () => AgentProfile[]
  getProfile: (id: string) => AgentProfile | undefined
  upsertProfile: (input: EditableAgentProfile) => AgentProfile
  removeProfile: (id: string) => void
  probeProfile: (id: string) => Promise<ProviderProbeResult>
  listModels: (id: string) => Promise<ModelDescriptor[]>
  saveCredential: (input: SaveCredentialInput) => CredentialMetadata
  removeCredential: (id: string) => void
  listCredentials: () => CredentialMetadata[]
}

export function createDbAgentProfileStore(
  db: BetterSQLite3Database<typeof schema>,
): AgentProfileStore {
  return {
    listProfiles() {
      return db.select().from(agentProfiles).all()
    },
    getProfile(id) {
      return db.select().from(agentProfiles).where(eq(agentProfiles.id, id)).get()
    },
    upsertProfile(input) {
      const now = Math.floor(Date.now() / 1000)
      db.insert(agentProfiles)
        .values({
          ...input,
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
      return db.select().from(agentProfiles).where(eq(agentProfiles.id, input.id)).get()!
    },
    removeProfile(id) {
      db.transaction((tx) => {
        const ownedSessionIds = tx
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.agentProfileId, id))
          .all()
          .map(row => row.id)

        tx.delete(agents).where(eq(agents.providerId, id)).run()
        tx.delete(agentSessions).where(eq(agentSessions.agentProfileId, id)).run()
        tx.delete(backendCapabilitySnapshots).where(eq(backendCapabilitySnapshots.agentProfileId, id)).run()
        tx.delete(runtimeAuditLog).where(eq(runtimeAuditLog.agentProfileId, id)).run()
        tx.delete(usageLogs).where(eq(usageLogs.agentProfileId, id)).run()
        if (ownedSessionIds.length > 0) {
          tx.delete(sessions).where(inArray(sessions.id, ownedSessionIds)).run()
        }
        tx.delete(agentProfiles).where(eq(agentProfiles.id, id)).run()
      })
    },
  }
}

export function createDbCredentialStore(
  db: BetterSQLite3Database<typeof schema>,
  cipher: CredentialCipher,
): AgentRuntimeCredentialStore {
  return {
    save(input) {
      const id = randomUUID()
      const now = Math.floor(Date.now() / 1000)
      const encryptedSecret = cipher.encrypt(input.secret)
      db.insert(agentCredentials)
        .values({
          id,
          providerKind: input.providerKind,
          label: input.label,
          encryptedSecret,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      return {
        id,
        providerKind: input.providerKind,
        label: input.label,
        maskedSecret: maskSecret(input.secret),
        createdAt: now,
        updatedAt: now,
      }
    },
    readSecret(id) {
      const row = db.select().from(agentCredentials).where(eq(agentCredentials.id, id)).get()
      if (!row) {
        throw new Error(`Credential not found: ${id}`)
      }
      return cipher.decrypt(row.encryptedSecret)
    },
    remove(id) {
      db.delete(agentCredentials).where(eq(agentCredentials.id, id)).run()
    },
    list() {
      return db.select().from(agentCredentials).all().map((row) => {
        const plainSecret = cipher.decrypt(row.encryptedSecret)
        return {
          id: row.id,
          providerKind: row.providerKind,
          label: row.label,
          maskedSecret: maskSecret(plainSecret),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }
      })
    },
  }
}

export function createDbRuntimeAuditStore(
  db: BetterSQLite3Database<typeof schema>,
): RuntimeAuditStore {
  return {
    recordProbe({ profileId, providerKind, subject, ok, errorText }) {
      db.insert(runtimeAuditLog).values({
        agentProfileId: profileId,
        providerKind,
        action: 'probe',
        subject,
        details: JSON.stringify({ ok, errorText }),
      }).run()
    },
    recordModelList({ profileId, providerKind, subject, count }) {
      db.insert(runtimeAuditLog).values({
        agentProfileId: profileId,
        providerKind,
        action: 'listModels',
        subject,
        details: JSON.stringify({ count }),
      }).run()
    },
  }
}

interface AgentRuntimeApplicationDeps {
  profileStore: AgentProfileStore
  credentialStore: AgentRuntimeCredentialStore
  auditStore: RuntimeAuditStore
  capabilityRecorder?: BackendCapabilityRecorder
  catalog?: ProviderCatalog
}

export function createAgentRuntimeApplicationService(
  deps: AgentRuntimeApplicationDeps,
): AgentRuntimeApplicationService {
  const catalog = deps.catalog ?? getProviderCatalog()

  const getProfileOrThrow = (id: string): AgentProfile => {
    const profile = deps.profileStore.getProfile(id)
    if (!profile) {
      throw new Error(`Agent profile not found: ${id}`)
    }
    return profile
  }

  const listProfiles: AgentRuntimeApplicationService['listProfiles'] = () => {
    return deps.profileStore.listProfiles()
  }

  const getProfile: AgentRuntimeApplicationService['getProfile'] = (id) => {
    return deps.profileStore.getProfile(id)
  }

  const upsertProfile: AgentRuntimeApplicationService['upsertProfile'] = (input) => {
    return deps.profileStore.upsertProfile(input)
  }

  const removeProfile: AgentRuntimeApplicationService['removeProfile'] = (id) => {
    deps.profileStore.removeProfile(id)
  }

  const probeProfile: AgentRuntimeApplicationService['probeProfile'] = async (id) => {
    const profile = getProfileOrThrow(id)
    const result = await catalog.get(profile.providerKind).probe(profile)
    deps.auditStore.recordProbe({
      profileId: profile.id,
      providerKind: profile.providerKind,
      subject: profile.name,
      ok: result.ok,
      errorText: result.errorText ?? null,
    })
    deps.capabilityRecorder?.recordCapabilitySnapshot({
      agentProfileId: profile.id,
      providerKind: profile.providerKind,
      source: 'probe',
      capabilitiesJson: JSON.stringify(result.details ?? {}),
    })
    return result
  }

  const listModels: AgentRuntimeApplicationService['listModels'] = async (id) => {
    const profile = getProfileOrThrow(id)
    const models = await catalog.get(profile.providerKind).listModels(profile)
    deps.auditStore.recordModelList({
      profileId: profile.id,
      providerKind: profile.providerKind,
      subject: profile.name,
      count: models.length,
    })
    return models
  }

  const saveCredential: AgentRuntimeApplicationService['saveCredential'] = (input) => {
    return deps.credentialStore.save(input)
  }

  const removeCredential: AgentRuntimeApplicationService['removeCredential'] = (id) => {
    deps.credentialStore.remove(id)
  }

  const listCredentials: AgentRuntimeApplicationService['listCredentials'] = () => {
    return deps.credentialStore.list()
  }

  return {
    listProfiles,
    getProfile,
    upsertProfile,
    removeProfile,
    probeProfile,
    listModels,
    saveCredential,
    removeCredential,
    listCredentials,
  }
}
