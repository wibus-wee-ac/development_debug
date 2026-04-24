// Input: AgentRuntimeService with fake repository, provider catalog, and credential vault
// Output: Unit tests for unified agent profile IPC behavior
// Position: Service-layer test coverage for the Agent Runtime IPC surface

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CredentialVault } from '../../agent-runtime/credential-vault'
import { ProviderCatalog } from '../../agent-runtime/provider-catalog'
import type { AgentProfile, AgentProvider, ProviderKind } from '../../agent-runtime/types'
import type { AgentProfileRepository } from '../agent-runtime'
import { AgentRuntimeService } from '../agent-runtime'

vi.mock('../../db', () => {
  const mockDb = {
    insert: () => ({ values: () => ({ run: () => {} }) }),
    select: () => ({ from: () => ({ where: () => ({ get: () => undefined, all: () => [] }) }) }),
  }
  return { getDb: () => mockDb }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

vi.mock('../../lib/safe-storage', () => ({
  encryptSecret: (text: string) => `encrypted:${text}`,
  decryptSecret: (text: string) => text.replace('encrypted:', ''),
}))

class MemoryProfileRepository implements AgentProfileRepository {
  private readonly profiles = new Map<string, AgentProfile>()

  listProfiles(): AgentProfile[] {
    return [...this.profiles.values()]
  }

  getProfile(id: string): AgentProfile | undefined {
    return this.profiles.get(id)
  }

  upsertProfile(input: Omit<AgentProfile, 'createdAt' | 'updatedAt'>): AgentProfile {
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

function createProvider(providerKind: ProviderKind): AgentProvider {
  return {
    providerKind,
    probe: async profile => ({
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

describe('agentRuntimeService', () => {
  let repository: MemoryProfileRepository
  let service: AgentRuntimeService

  beforeEach(() => {
    repository = new MemoryProfileRepository()
    service = new AgentRuntimeService({
      repository,
      catalog: new ProviderCatalog([createProvider('codex-app-server')]),
      credentialVault: new CredentialVault({
        encrypt: text => `encrypted:${text}`,
        decrypt: encrypted => encrypted.replace('encrypted:', ''),
      }),
    })
  })

  it('stores and lists unified agent profiles', () => {
    const profile = service.upsertProfile({
      id: 'local-codex',
      name: 'Local Codex',
      providerKind: 'codex-app-server',
      enabled: true,
      configJson: '{"executable":"codex"}',
      credentialRef: null,
    })

    expect(profile.providerKind).toBe('codex-app-server')
    expect(service.listProfiles()).toEqual([profile])
  })

  it('probes a profile through its registered provider', async () => {
    service.upsertProfile({
      id: 'local-codex',
      name: 'Local Codex',
      providerKind: 'codex-app-server',
      enabled: true,
      configJson: '{}',
      credentialRef: null,
    })

    await expect(service.probeProfile('local-codex')).resolves.toEqual({
      ok: true,
      label: 'Local Codex',
      version: '1.0.0',
      details: { providerKind: 'codex-app-server' },
      errorText: null,
    })
  })

  it('saves API credentials without exposing the plaintext secret', () => {
    const metadata = service.saveCredential({
      providerKind: 'openai-compatible',
      label: 'OpenAI-compatible',
      secret: 'sk-test-abcdef',
    })

    expect(metadata.maskedSecret).toBe('sk-...cdef')
    expect(JSON.stringify(service.listCredentials())).not.toContain('sk-test-abcdef')
  })
})
