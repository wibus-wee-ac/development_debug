// Input: AgentProvider implementations registered by main-process bootstrap
// Output: ProviderCatalog for typed provider lookup by ProviderKind
// Position: Registry boundary between AgentRuntimeService and concrete providers

import type { AgentProvider, ProviderKind } from './runtime-provider-types'

export class ProviderCatalog {
  private readonly providers = new Map<ProviderKind, AgentProvider>()

  constructor(providers: AgentProvider[] = []) {
    for (const provider of providers) {
      this.register(provider)
    }
  }

  register(provider: AgentProvider): void {
    this.providers.set(provider.providerKind, provider)
  }

  get(providerKind: ProviderKind): AgentProvider {
    const provider = this.providers.get(providerKind)
    if (!provider) {
      throw new Error(`No provider registered for kind: ${providerKind}`)
    }
    return provider
  }

  list(): AgentProvider[] {
    return [...this.providers.values()]
  }
}
