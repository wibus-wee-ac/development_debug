export const providerKinds = ['openai-compatible', 'anthropic'] as const

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

export interface ModelCapabilities {
  contextWindow?: number
  maxOutput?: number
  inputModalities?: string[]
  outputModalities?: string[]
  reasoning?: boolean
  toolCall?: boolean
  temperature?: boolean
  structuredOutput?: boolean
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
  }
  family?: string
  knowledgeCutoff?: string
  releaseDate?: string
  registryMatch?: 'exact' | 'fuzzy' | 'manual' | 'unmatched'
  registryModelId?: string
  registryModelLabel?: string
}

export interface ModelDescriptor {
  id: string
  label: string
  providerKind: ProviderKind
  capabilities: ModelCapabilities
}
