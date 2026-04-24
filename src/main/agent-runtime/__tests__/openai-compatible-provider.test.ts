// Input: OpenAICompatibleProvider with fake credential reader and model client
// Output: Unit tests for OpenAI-compatible provider configuration and secret handling
// Position: Provider test coverage for Base URL / API key based agents

import { describe, expect, it, vi } from 'vitest'

import { OpenAICompatibleProvider } from '../providers/openai-compatible-provider'
import type { AgentProfile } from '../types'

const profile: AgentProfile = {
  id: 'openai-local',
  name: 'OpenAI Local',
  providerKind: 'openai-compatible',
  enabled: true,
  configJson: '{"baseUrl":"https://api.example.test/v1","model":"gpt-test"}',
  credentialRef: 'credential-1',
  createdAt: 1,
  updatedAt: 1,
}

describe('openAICompatibleProvider', () => {
  it('lists configured default model without exposing the API key', async () => {
    const readSecret = vi.fn().mockReturnValue('sk-secret-value')
    const provider = new OpenAICompatibleProvider({ readSecret })

    await expect(provider.listModels(profile)).resolves.toEqual([
      {
        id: 'gpt-test',
        label: 'gpt-test',
        providerKind: 'openai-compatible',
        contextWindow: null,
      },
    ])
    expect(readSecret).toHaveBeenCalledWith('credential-1')
  })

  it('returns probe failure when Base URL is missing', async () => {
    const provider = new OpenAICompatibleProvider({ readSecret: vi.fn() })

    await expect(provider.probe({ ...profile, configJson: '{}' })).resolves.toMatchObject({
      ok: false,
      label: 'OpenAI Local',
      errorText: 'Base URL is required',
    })
  })
})
