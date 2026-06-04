import type { BuiltinRuntimeKind, ProviderKind, RuntimeKind } from './types'

const RUNTIME_PROVIDER_KINDS: Record<BuiltinRuntimeKind, ProviderKind[]> = {
  'standard': ['openai-compatible', 'universal'],
  'claude-agent': ['anthropic', 'universal'],
  'codex': ['openai-compatible', 'universal'],
  'jar-core': ['openai-compatible', 'anthropic', 'universal'],
  'acp-chat': ['openai-compatible', 'anthropic', 'universal'],
  'cli-tui': [],
}

const runtimeProviderKinds = new Map<RuntimeKind, readonly ProviderKind[]>(
  Object.entries(RUNTIME_PROVIDER_KINDS),
)

export function registerRuntimeProviderKinds(runtimeKind: RuntimeKind, providerKinds: readonly ProviderKind[]): void {
  runtimeProviderKinds.set(runtimeKind, [...providerKinds])
}

export function listProviderKindsForRuntime(runtimeKind: RuntimeKind): readonly ProviderKind[] {
  return runtimeProviderKinds.get(runtimeKind) ?? []
}

export function runtimeSupportsProviderKind(runtimeKind: RuntimeKind, providerKind: ProviderKind): boolean {
  return listProviderKindsForRuntime(runtimeKind).includes(providerKind)
}
