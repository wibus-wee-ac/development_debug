// Input: Provider implementations and ProviderCatalog
// Output: Module-level singleton accessor for the main-process provider catalog
// Position: Lazy-init singleton; call initProviderCatalog() once at startup, then getProviderCatalog() anywhere

import { ProviderCatalog } from './provider-catalog'
import type { AgentProvider } from './runtime-provider-types'

let catalogInstance: ProviderCatalog | null = null

export function initProviderCatalog(providers: AgentProvider[]): ProviderCatalog {
  catalogInstance = new ProviderCatalog(providers)
  return catalogInstance
}

export function getProviderCatalog(): ProviderCatalog {
  if (!catalogInstance) {
    throw new Error('Provider catalog not initialized. Call initProviderCatalog() at startup.')
  }
  return catalogInstance
}
