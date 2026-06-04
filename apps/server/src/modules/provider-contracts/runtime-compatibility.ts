import type { BuiltinRuntimeKind, ProviderKind, RuntimeKind } from './types'

const RUNTIME_PROVIDER_KINDS: Record<BuiltinRuntimeKind, ProviderKind[]> = {
  'standard': ['openai-compatible'],
  'claude-agent': ['anthropic'],
  'codex': ['openai-compatible'],
  'jar-core': ['openai-compatible', 'anthropic'],
  'acp-chat': ['openai-compatible', 'anthropic'],
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
