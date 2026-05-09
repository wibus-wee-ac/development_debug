// Input: Agent runtime application service, in-memory profile/audit stores, provider catalog, and credential vault
// Output: Behavior tests for feature-owned agent runtime coordination
// Position: Feature-level test for src/main/features/agent-runtime/agent-runtime.ts

import { beforeEach, describe, expect, it } from 'vitest'

import type {
  AgentProfileStore,
  EditableAgentProfile,
  RuntimeAuditStore,
} from '../agent-runtime'
import {
  createAgentRuntimeApplicationService,
} from '../agent-runtime'
import { CredentialVault } from '../credential-vault'
import { ProviderCatalog } from '../provider-catalog'
import type {
  AgentProfile,
  AgentProvider,
  ProviderKind,
} from '../runtime-provider-types'

class MemoryCapabilityRecorder {
  readonly snapshots: Array<{
    agentProfileId: string
    providerKind: ProviderKind
    source: 'health_check' | 'session_start'
    capabilitiesJson: string
  }> = []

  recordCapabilitySnapshot(input: {
    agentProfileId: string
    providerKind: ProviderKind
    source: 'health_check' | 'session_start'
    capabilitiesJson: string
  }): void {
    this.snapshots.push(input)
  }
}

class MemoryProfileStore implements AgentProfileStore {
  private readonly profiles = new Map<string, AgentProfile>()

  listProfiles(): AgentProfile[] {
    return [...this.profiles.values()]
  }

  getProfile(id: string): AgentProfile | undefined {
    return this.profiles.get(id)
  }

  upsertProfile(input: EditableAgentProfile): AgentProfile {
    const now = 100
    const existing = this.profiles.get(input.id)
    const profile = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.profiles.set(input.id, profile)
    return profile
  }

  removeProfile(id: string): void {
    this.profiles.delete(id)
  }
}

class MemoryAuditStore implements RuntimeAuditStore {
  readonly healthCheckEvents: Array<{ profileId: string, providerKind: ProviderKind, subject: string, ok: boolean, errorText: string | null }> = []
  readonly modelListEvents: Array<{ profileId: string, providerKind: ProviderKind, subject: string, count: number }> = []

  recordHealthCheck(input: { profileId: string, providerKind: ProviderKind, subject: string, ok: boolean, errorText: string | null }): void {
    this.healthCheckEvents.push(input)
  }

  recordModelList(input: { profileId: string, providerKind: ProviderKind, subject: string, count: number }): void {
    this.modelListEvents.push(input)
  }
}

function createProvider(providerKind: ProviderKind): AgentProvider {
  return {
    providerKind,
    checkHealth: async profile => ({
      ok: true,
      label: profile.name,
      version: '1.0.0',
      details: { providerKind },
      errorText: null,
    }),
    listModels: async () => [
      {
        id: 'test-model',
        label: 'Test Model',
        providerKind,
        contextWindow: 128000,
      },
    ],
  }
}

describe('agentRuntimeApplicationService', () => {
  let profileStore: MemoryProfileStore
  let auditStore: MemoryAuditStore
  let credentialStore: CredentialVault
  let capabilityRecorder: MemoryCapabilityRecorder

  beforeEach(() => {
    profileStore = new MemoryProfileStore()
    auditStore = new MemoryAuditStore()
    capabilityRecorder = new MemoryCapabilityRecorder()
    credentialStore = new CredentialVault({
      encrypt: text => `encrypted:${text}`,
      decrypt: encrypted => encrypted.replace('encrypted:', ''),
    })
  })

  it('stores and lists unified agent profiles', () => {
    const service = createAgentRuntimeApplicationService({
      profileStore,
      auditStore,
      capabilityRecorder,
      catalog: new ProviderCatalog([createProvider('openai-compatible')]),
      credentialStore,
    })

    const profile = service.upsertProfile({
      id: 'test-profile',
      name: 'Test Profile',
      providerKind: 'openai-compatible',
      enabled: true,
      configJson: '{"baseUrl":"http://localhost","model":"gpt-4o"}',
      credentialRef: null,
    })

    expect(profile.providerKind).toBe('openai-compatible')
    expect(service.listProfiles()).toEqual([profile])
  })

  it('runs a health check through the registered provider and records audit', async () => {
    const service = createAgentRuntimeApplicationService({
      profileStore,
      auditStore,
      capabilityRecorder,
      catalog: new ProviderCatalog([createProvider('openai-compatible')]),
      credentialStore,
    })

    service.upsertProfile({
      id: 'test-profile',
      name: 'Test Profile',
      providerKind: 'openai-compatible',
      enabled: true,
      configJson: '{}',
      credentialRef: null,
    })

    await expect(service.healthCheckProfile('test-profile')).resolves.toEqual({
      ok: true,
      label: 'Test Profile',
      version: '1.0.0',
      details: { providerKind: 'openai-compatible' },
      errorText: null,
    })
    expect(auditStore.healthCheckEvents).toEqual([
      {
        profileId: 'test-profile',
        providerKind: 'openai-compatible',
        subject: 'Test Profile',
        ok: true,
        errorText: null,
      },
    ])
    expect(capabilityRecorder.snapshots).toEqual([
      {
        agentProfileId: 'test-profile',
        providerKind: 'openai-compatible',
        source: 'health_check',
        capabilitiesJson: JSON.stringify({ providerKind: 'openai-compatible' }),
      },
    ])
  })

  it('lists models through the provider and records audit', async () => {
    const service = createAgentRuntimeApplicationService({
      profileStore,
      auditStore,
      capabilityRecorder,
      catalog: new ProviderCatalog([createProvider('openai-compatible')]),
      credentialStore,
    })

    service.upsertProfile({
      id: 'test-profile',
      name: 'Test Profile',
      providerKind: 'openai-compatible',
      enabled: true,
      configJson: '{}',
      credentialRef: null,
    })

    await expect(service.listModels('test-profile')).resolves.toEqual([
      {
        id: 'test-model',
        label: 'Test Model',
        providerKind: 'openai-compatible',
        contextWindow: 128000,
      },
    ])
    expect(auditStore.modelListEvents).toEqual([
      {
        profileId: 'test-profile',
        providerKind: 'openai-compatible',
        subject: 'Test Profile',
        count: 1,
      },
    ])
  })

  it('saves API credentials without exposing the plaintext secret', () => {
    const service = createAgentRuntimeApplicationService({
      profileStore,
      auditStore,
      capabilityRecorder,
      catalog: new ProviderCatalog([createProvider('openai-compatible')]),
      credentialStore,
    })

    const metadata = service.saveCredential({
      providerKind: 'openai-compatible',
      label: 'OpenAI-compatible',
      secret: 'sk-test-abcdef',
    })

    expect(metadata.maskedSecret).toBe('sk-...cdef')
    expect(JSON.stringify(service.listCredentials())).not.toContain('sk-test-abcdef')
  })

  it('throws when probing a missing profile', async () => {
    const service = createAgentRuntimeApplicationService({
      profileStore,
      auditStore,
      capabilityRecorder,
      catalog: new ProviderCatalog([createProvider('openai-compatible')]),
      credentialStore,
    })

    await expect(service.healthCheckProfile('missing-profile')).rejects.toThrow('Agent profile not found: missing-profile')
  })
})
