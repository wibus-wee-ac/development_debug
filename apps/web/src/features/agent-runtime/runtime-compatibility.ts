// Output: Runtime/provider compatibility rules for renderer selection surfaces.
// Input: Runtime kind and provider kind identifiers.
// Position: Agent Runtime owns provider-kind compatibility semantics used by composer and settings UI.

import type { ProviderKind, RuntimeKind } from '~/lib/types'

const RUNTIME_PROVIDER_KINDS: Record<RuntimeKind, readonly ProviderKind[]> = {
  standard: ['openai-compatible'],
  'claude-agent': ['anthropic'],
  codex: ['openai-compatible'],
  'jar-core': ['openai-compatible', 'anthropic'],
  'acp-chat': ['openai-compatible', 'anthropic'],
  'cli-tui': [],
}

export function runtimeSupportsProviderKind(runtimeKind: RuntimeKind, providerKind: ProviderKind): boolean {
  return RUNTIME_PROVIDER_KINDS[runtimeKind].includes(providerKind)
}
