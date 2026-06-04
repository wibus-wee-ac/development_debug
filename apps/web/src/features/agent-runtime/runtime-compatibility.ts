import type { BuiltinRuntimeKind, ProviderKind, RuntimeKind } from '~/lib/types'

import type { RuntimeCatalogItem } from './use-runtime-catalog'

const RUNTIME_PROVIDER_KINDS: Record<BuiltinRuntimeKind, readonly ProviderKind[]> = {
  'standard': ['openai-compatible'],
  'claude-agent': ['anthropic'],
  'codex': ['openai-compatible'],
  'jar-core': ['openai-compatible', 'anthropic'],
  'acp-chat': ['openai-compatible', 'anthropic'],
  'cli-tui': [],
}

export function runtimeSupportsProviderKind(
  runtimeKind: RuntimeKind,
  providerKind: ProviderKind,
  runtimes?: RuntimeCatalogItem[],
): boolean {
  const runtime = runtimes?.find(item => item.runtimeKind === runtimeKind)
  if (runtime) {
    return runtime.providerKinds.includes(providerKind)
  }
  return (RUNTIME_PROVIDER_KINDS[runtimeKind as BuiltinRuntimeKind] ?? []).includes(providerKind)
}
