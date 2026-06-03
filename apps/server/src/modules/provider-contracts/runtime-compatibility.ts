import type { ProviderKind, RuntimeKind } from './types'

const RUNTIME_PROVIDER_KINDS: Record<RuntimeKind, readonly ProviderKind[]> = {
  'standard': ['openai-compatible'],
  'claude-agent': ['anthropic'],
  'codex': ['openai-compatible'],
  'jar-core': ['openai-compatible', 'anthropic'],
  'acp-chat': ['openai-compatible', 'anthropic'],
  'cli-tui': [],
}

export function listProviderKindsForRuntime(runtimeKind: RuntimeKind): readonly ProviderKind[] {
  return RUNTIME_PROVIDER_KINDS[runtimeKind]
}

export function runtimeSupportsProviderKind(runtimeKind: RuntimeKind, providerKind: ProviderKind): boolean {
  return RUNTIME_PROVIDER_KINDS[runtimeKind].includes(providerKind)
}
