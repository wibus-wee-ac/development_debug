// Input: AgentRuntimeService with mocked agent runtime application service
// Output: Unit tests for agent-runtime IPC forwarding behavior
// Position: App-level IPC adapter test for src/main/app/ipc/agent-runtime.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AgentRuntimeApplicationService,
} from '../../../agent-runtime/agent-runtime'
import type { CredentialMetadata } from '../../../agent-runtime/credential-vault'
import type {
  ModelDescriptor,
  ProviderProbeResult,
} from '../../../agent-runtime/runtime-provider-types'
import { AgentRuntimeService } from '../agent-runtime'

vi.mock('../../../db/index.ts', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: () => undefined, all: () => [] }) }) }),
  }),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

vi.mock('../../../storage/safe-storage', () => ({
  encryptSecret: (text: string) => `encrypted:${text}`,
  decryptSecret: (text: string) => text.replace('encrypted:', ''),
}))

describe('agentRuntimeService', () => {
  let appService: AgentRuntimeApplicationService
  let service: AgentRuntimeService

  beforeEach(() => {
    const probeResult: ProviderProbeResult = {
      ok: true,
      label: 'Test Profile',
      version: '1.0.0',
      details: { providerKind: 'openai-compatible' },
      errorText: null,
    }
    const models: ModelDescriptor[] = [{
      id: 'test-model',
      label: 'Test Model',
      providerKind: 'openai-compatible',
      contextWindow: 128000,
    }]
    const credentials: CredentialMetadata[] = [{
      id: 'credential-1',
      providerKind: 'openai-compatible',
      label: 'OpenAI-compatible',
      maskedSecret: 'sk-...cdef',
      createdAt: 100,
      updatedAt: 100,
    }]

    appService = {
      listProfiles: vi.fn(() => [{ id: 'test-profile' } as never]),
      getProfile: vi.fn(() => ({ id: 'test-profile' } as never)),
      upsertProfile: vi.fn(input => ({ ...input, createdAt: 100, updatedAt: 100 } as never)),
      removeProfile: vi.fn(),
      probeProfile: vi.fn(async () => probeResult),
      listModels: vi.fn(async () => models),
      saveCredential: vi.fn(() => credentials[0]),
      removeCredential: vi.fn(),
      listCredentials: vi.fn(() => credentials),
    }
    service = new AgentRuntimeService(appService)
  })

  it('forwards profile lifecycle calls to the feature application service', () => {
    const profile = service.upsertProfile({
      id: 'test-profile',
      name: 'Test Profile',
      providerKind: 'openai-compatible',
      enabled: true,
      configJson: '{"baseUrl":"http://localhost","model":"gpt-4o"}',
      credentialRef: null,
    })

    expect(profile.providerKind).toBe('openai-compatible')
    expect(service.listProfiles()).toEqual([{ id: 'test-profile' }])
    expect(service.getProfile('test-profile')).toEqual({ id: 'test-profile' })
    service.removeProfile('test-profile')

    expect(appService.upsertProfile).toHaveBeenCalledWith({
      id: 'test-profile',
      name: 'Test Profile',
      providerKind: 'openai-compatible',
      enabled: true,
      configJson: '{"baseUrl":"http://localhost","model":"gpt-4o"}',
      credentialRef: null,
    })
    expect(appService.listProfiles).toHaveBeenCalled()
    expect(appService.getProfile).toHaveBeenCalledWith('test-profile')
    expect(appService.removeProfile).toHaveBeenCalledWith('test-profile')
  })

  it('forwards probe, model listing, and credential calls to the feature application service', async () => {
    await expect(service.probeProfile('test-profile')).resolves.toEqual({
      ok: true,
      label: 'Test Profile',
      version: '1.0.0',
      details: { providerKind: 'openai-compatible' },
      errorText: null,
    })
    await expect(service.listModels('test-profile')).resolves.toEqual([{
      id: 'test-model',
      label: 'Test Model',
      providerKind: 'openai-compatible',
      contextWindow: 128000,
    }])

    const metadata = service.saveCredential({
      providerKind: 'openai-compatible',
      label: 'OpenAI-compatible',
      secret: 'sk-test-abcdef',
    })
    service.removeCredential('credential-1')

    expect(metadata.maskedSecret).toBe('sk-...cdef')
    expect(service.listCredentials()).toEqual([{
      id: 'credential-1',
      providerKind: 'openai-compatible',
      label: 'OpenAI-compatible',
      maskedSecret: 'sk-...cdef',
      createdAt: 100,
      updatedAt: 100,
    }])
    expect(appService.probeProfile).toHaveBeenCalledWith('test-profile')
    expect(appService.listModels).toHaveBeenCalledWith('test-profile')
    expect(appService.saveCredential).toHaveBeenCalledWith({
      providerKind: 'openai-compatible',
      label: 'OpenAI-compatible',
      secret: 'sk-test-abcdef',
    })
    expect(appService.removeCredential).toHaveBeenCalledWith('credential-1')
    expect(appService.listCredentials).toHaveBeenCalled()
  })
})
