// Output: Shared provider taxonomy and model descriptor contracts.
// Input: Provider/runtime kind literals and model metadata fields.
// Position: Provider-contracts owns cross-module provider contracts consumed by catalog, targets, profiles, sessions, and chat runtime.

export const providerKinds = ['openai-compatible', 'anthropic'] as const

export type ProviderKind = (typeof providerKinds)[number]

export const providerTargetKinds = ['manual', 'external'] as const

export type ProviderTargetKind = (typeof providerTargetKinds)[number]

export const runtimeKinds = [
  'standard',
  'claude-agent',
  'codex',
  'jar-core',
  'acp-chat',
  'cli-tui',
] as const

export type RuntimeKind = (typeof runtimeKinds)[number]

export interface ProviderRequest {
  providerKind: ProviderKind
  label: string
  configJson: string
  secretRef: string | null
  profileId: string | null
  providerTargetKind: ProviderTargetKind | null
  providerTargetId: string | null
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
  registryMatch?: 'exact' | 'fuzzy' | 'manual' | 'alias' | 'unmatched'
  registryModelId?: string
  registryModelLabel?: string
}

export interface ModelDescriptor {
  id: string
  label: string
  providerKind: ProviderKind
  capabilities: ModelCapabilities
}
