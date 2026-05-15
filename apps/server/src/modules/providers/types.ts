// Input: provider taxonomy, runtime kinds, and metadata responses
// Output: shared provider + runtime types for provider catalog and chat-runtime modules
// Position: apps/server/src/modules/providers/types.ts

export const providerKinds = ['openai-compatible'] as const

export type ProviderKind = (typeof providerKinds)[number]

export const runtimeKinds = ['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui'] as const

export type RuntimeKind = (typeof runtimeKinds)[number]

export interface ProviderHealthCheckResult {
  ok: boolean
  label: string
  version: string | null
  details: Record<string, unknown>
  errorText: string | null
}

export interface ProviderRequest {
  providerKind: ProviderKind
  label: string
  configJson: string
  secretRef: string | null
  profileId: string | null
}

export interface ModelDescriptor {
  id: string
  label: string
  providerKind: ProviderKind
  contextWindow: number | null
}
