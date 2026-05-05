// Input: CredentialVault with injected encryption callbacks
// Output: Unit tests for secret storage, masking, and metadata-only listing
// Position: Test coverage for main-process agent credential handling

import { describe, expect, it } from 'vitest'

import { CredentialVault } from '../credential-vault'

describe('credentialVault', () => {
  it('stores encrypted secrets and lists only masked metadata', () => {
    const vault = new CredentialVault({
      encrypt: text => `encrypted:${text}`,
      decrypt: text => text.replace('encrypted:', ''),
    })

    const saved = vault.save({
      providerKind: 'openai-compatible',
      label: 'OpenAI',
      secret: 'sk-test-1234567890',
    })

    expect(vault.readSecret(saved.id)).toBe('sk-test-1234567890')
    expect(vault.list()).toEqual([
      expect.objectContaining({
        id: saved.id,
        providerKind: 'openai-compatible',
        label: 'OpenAI',
        maskedSecret: 'sk-...7890',
      }),
    ])
    expect(JSON.stringify(vault.list())).not.toContain('sk-test-1234567890')
  })

  it('removes credentials so deleted secrets cannot be read', () => {
    const vault = new CredentialVault({
      encrypt: text => text,
      decrypt: text => text,
    })
    const saved = vault.save({
      providerKind: 'openai-compatible',
      label: 'Temporary',
      secret: 'short',
    })

    vault.remove(saved.id)

    expect(() => vault.readSecret(saved.id)).toThrow(`Credential not found: ${saved.id}`)
    expect(vault.list()).toEqual([])
  })
})
