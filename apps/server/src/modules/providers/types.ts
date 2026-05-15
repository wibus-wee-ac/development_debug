// Input: provider taxonomy and metadata responses
// Output: shared provider types for provider catalog and chat-runtime modules
// Position: apps/server/src/modules/providers/types.ts

export const providerKinds = ['acp-chat', 'cli-tui', 'openai-compatible', 'codex', 'claude-agent', 'system-agent'] as const

export type ProviderKind = (typeof providerKinds)[number]

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
