// Input: IpcService base, Agent Runtime repository, ProviderCatalog, CredentialVault
// Output: AgentRuntimeService IPC handler for unified agent profiles, probes, models, and credentials
// Position: Main-process service replacing split ACP/CLI agent management surfaces

import { randomUUID } from 'node:crypto'

import { IpcMethod, IpcService } from '@cradle/ipc'
import { eq, inArray } from 'drizzle-orm'

import { getProviderCatalog } from '../../features/agent-runtime/catalog-instance'
import type { CredentialMetadata, SaveCredentialInput } from '../../features/agent-runtime/credential-vault'
import { maskSecret } from '../../features/agent-runtime/credential-vault'
import type { ProviderCatalog } from '../../features/agent-runtime/provider-catalog'
import type {
  AgentProfile,
  ModelDescriptor,
  ProviderProbeResult,
} from '../../features/agent-runtime/runtime-provider-types'
import { getDb } from '../../db'
import {
  agents,
  agentCredentials,
  agentProfiles,
  agentSessions,
  runtimeAuditLog,
  runtimeSessions,
  sessions,
  usageLogs,
} from '../../db/schema'
import { decryptSecret, encryptSecret } from '../../platform/storage/safe-storage'

type EditableAgentProfile = Omit<AgentProfile, 'createdAt' | 'updatedAt'>

export interface AgentProfileRepository {
  listProfiles: () => AgentProfile[]
  getProfile: (id: string) => AgentProfile | undefined
  upsertProfile: (input: EditableAgentProfile) => AgentProfile
  removeProfile: (id: string) => void
}

// ── CredentialVault interface ─────────────────────────────────────────────────

export interface ICredentialVault {
  save: (input: SaveCredentialInput) => CredentialMetadata
  readSecret: (id: string) => string
  remove: (id: string) => void
  list: () => CredentialMetadata[]
}

// ── DB implementations ────────────────────────────────────────────────────────

class DbAgentProfileRepository implements AgentProfileRepository {
  listProfiles(): AgentProfile[] {
    return getDb().select().from(agentProfiles).all()
  }

  getProfile(id: string): AgentProfile | undefined {
    return getDb().select().from(agentProfiles).where(eq(agentProfiles.id, id)).get()
  }

  upsertProfile(input: EditableAgentProfile): AgentProfile {
    const now = Math.floor(Date.now() / 1000)
    getDb()
      .insert(agentProfiles)
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
    return this.getProfile(input.id)!
  }

  removeProfile(id: string): void {
    const db = getDb()
    db.transaction((tx) => {
      const ownedSessionIds = tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.agentProfileId, id))
        .all()
        .map(row => row.id)

      // Remove rows that reference this profile across runtime and kanban delegation domains.
      tx.delete(agents).where(eq(agents.providerId, id)).run()
      tx.delete(agentSessions).where(eq(agentSessions.agentProfileId, id)).run()
      tx.delete(runtimeSessions).where(eq(runtimeSessions.agentProfileId, id)).run()
      tx.delete(runtimeAuditLog).where(eq(runtimeAuditLog.agentProfileId, id)).run()
      tx.delete(usageLogs).where(eq(usageLogs.agentProfileId, id)).run()
      if (ownedSessionIds.length > 0) {
        tx.delete(sessions).where(inArray(sessions.id, ownedSessionIds)).run()
      }
      tx.delete(agentProfiles).where(eq(agentProfiles.id, id)).run()
    })
  }
}

class DbCredentialVault implements ICredentialVault {
  save(input: SaveCredentialInput): CredentialMetadata {
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    getDb()
      .insert(agentCredentials)
      .values({
        id,
        providerKind: input.providerKind,
        label: input.label,
        encryptedSecret: encryptSecret(input.secret),
        createdAt: now,
        updatedAt: now,
      })
      .run()
    return this.toMetadata(id, input.providerKind, input.label, input.secret, now, now)
  }

  readSecret(id: string): string {
    const row = getDb().select().from(agentCredentials).where(eq(agentCredentials.id, id)).get()
    if (!row) {
      throw new Error(`Credential not found: ${id}`)
    }
    return decryptSecret(row.encryptedSecret)
  }

  remove(id: string): void {
    getDb().delete(agentCredentials).where(eq(agentCredentials.id, id)).run()
  }

  list(): CredentialMetadata[] {
    return getDb()
      .select()
      .from(agentCredentials)
      .all()
      .map(row => this.toMetadata(
        row.id,
        row.providerKind,
        row.label,
        decryptSecret(row.encryptedSecret),
        row.createdAt,
        row.updatedAt,
      ))
  }

  private toMetadata(
    id: string,
    providerKind: SaveCredentialInput['providerKind'],
    label: string,
    plainSecret: string,
    createdAt: number,
    updatedAt: number,
  ): CredentialMetadata {
    return {
      id,
      providerKind,
      label,
      maskedSecret: maskSecret(plainSecret),
      createdAt,
      updatedAt,
    }
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

interface AgentRuntimeServiceDeps {
  repository?: AgentProfileRepository
  catalog?: ProviderCatalog
  credentialVault?: ICredentialVault
}

export class AgentRuntimeService extends IpcService {
  static readonly groupName = 'agentRuntime'

  private readonly repository: AgentProfileRepository
  private readonly _catalog: ProviderCatalog | null
  private readonly credentialVault: ICredentialVault

  constructor(deps: AgentRuntimeServiceDeps = {}) {
    super()
    this.repository = deps.repository ?? new DbAgentProfileRepository()
    this._catalog = deps.catalog ?? null
    this.credentialVault = deps.credentialVault ?? new DbCredentialVault()
  }

  /** Returns the catalog from singleton if not injected. */
  private get catalog(): ProviderCatalog {
    return this._catalog ?? getProviderCatalog()
  }

  @IpcMethod()
  listProfiles(): AgentProfile[] {
    return this.repository.listProfiles()
  }

  @IpcMethod()
  getProfile(id: string): AgentProfile | undefined {
    return this.repository.getProfile(id)
  }

  @IpcMethod()
  upsertProfile(input: EditableAgentProfile): AgentProfile {
    return this.repository.upsertProfile(input)
  }

  @IpcMethod()
  removeProfile(id: string): void {
    this.repository.removeProfile(id)
  }

  @IpcMethod()
  async probeProfile(id: string): Promise<ProviderProbeResult> {
    const profile = this.getProfileOrThrow(id)
    const result = await this.catalog.get(profile.providerKind).probe(profile)
    getDb().insert(runtimeAuditLog).values({
      agentProfileId: profile.id,
      providerKind: profile.providerKind,
      action: 'probe',
      subject: profile.name,
      details: JSON.stringify({ ok: result.ok, errorText: result.errorText ?? null }),
    }).run()
    return result
  }

  @IpcMethod()
  async listModels(id: string): Promise<ModelDescriptor[]> {
    const profile = this.getProfileOrThrow(id)
    const models = await this.catalog.get(profile.providerKind).listModels(profile)
    getDb().insert(runtimeAuditLog).values({
      agentProfileId: profile.id,
      providerKind: profile.providerKind,
      action: 'listModels',
      subject: profile.name,
      details: JSON.stringify({ count: models.length }),
    }).run()
    return models
  }

  @IpcMethod()
  saveCredential(input: SaveCredentialInput): CredentialMetadata {
    return this.credentialVault.save(input)
  }

  @IpcMethod()
  removeCredential(id: string): void {
    this.credentialVault.remove(id)
  }

  @IpcMethod()
  listCredentials(): CredentialMetadata[] {
    return this.credentialVault.list()
  }

  private getProfileOrThrow(id: string): AgentProfile {
    const profile = this.repository.getProfile(id)
    if (!profile) {
      throw new Error(`Agent profile not found: ${id}`)
    }
    return profile
  }
}
