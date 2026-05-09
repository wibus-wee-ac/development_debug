// Input: ProviderCatalog and typed provider doubles
// Output: Unit tests for provider registration and typed lookup behavior
// Position: Test coverage for the main-process agent runtime provider catalog

import { describe, expect, it } from 'vitest'

import { ProviderCatalog } from '../provider-catalog'
import type { AgentProvider } from '../runtime-provider-types'

const acpProvider: AgentProvider = {
  providerKind: 'acp-chat',
  checkHealth: async () => ({
    ok: true,
    label: 'ACP',
    version: null,
    details: {},
    errorText: null,
  }),
  listModels: async () => [],
}

describe('providerCatalog', () => {
  it('returns the registered provider for a provider kind', () => {
    const catalog = new ProviderCatalog([acpProvider])

    expect(catalog.get('acp-chat')).toBe(acpProvider)
  })

  it('throws a typed error when the provider kind is not registered', () => {
    const catalog = new ProviderCatalog([])

    expect(() => catalog.get('cli-tui')).toThrow(
      'No provider registered for kind: cli-tui',
    )
  })
})
