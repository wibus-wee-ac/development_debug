/**
 * Output: Provider-owned model capability defaults and projections.
 * Input: Provider model descriptors from live catalogs, registry enrichment, and cached inventory.
 * Position: Provider-catalog owns the canonical model capability projection consumed by runtime selection UI.
 */

import type { ModelCapabilities, ModelDescriptor, ProviderKind } from '../provider-contracts/types'

const ANTHROPIC_INPUT_MODALITIES = ['text', 'image'] as const
const ANTHROPIC_OUTPUT_MODALITIES = ['text'] as const

export function readProviderDefaultModelCapabilities(providerKind: ProviderKind): ModelCapabilities {
  if (providerKind !== 'anthropic') {
    return {}
  }
  return {
    inputModalities: [...ANTHROPIC_INPUT_MODALITIES],
    outputModalities: [...ANTHROPIC_OUTPUT_MODALITIES],
  }
}

export function projectProviderModelCapabilities(model: ModelDescriptor): ModelDescriptor {
  const defaults = readProviderDefaultModelCapabilities(model.providerKind)
  if (!defaults.inputModalities?.length && !defaults.outputModalities?.length) {
    return model
  }

  const capabilities: ModelCapabilities = { ...model.capabilities }
  if (!capabilities.inputModalities?.length && defaults.inputModalities?.length) {
    capabilities.inputModalities = [...defaults.inputModalities]
  }
  if (!capabilities.outputModalities?.length && defaults.outputModalities?.length) {
    capabilities.outputModalities = [...defaults.outputModalities]
  }

  return {
    ...model,
    capabilities,
  }
}

export function projectProviderModelListCapabilities(models: ModelDescriptor[]): ModelDescriptor[] {
  return models.map(projectProviderModelCapabilities)
}
