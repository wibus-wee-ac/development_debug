import type { ModelDescriptor, ProviderKind, ProviderTargetKind, RuntimeKind } from '~/lib/types'

export type ComposerContext = 'new-chat' | 'chat'

export type ThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh' | null

export interface ComposerSelection {
  agentId: string | null
  profileId: string | null
  modelId: string | null
  thinkingEffort: ThinkingEffort
  runtimeKind: RuntimeKind
}

export interface ProviderModelOption {
  id: string
  kind?: ProviderTargetKind
  name: string
  providerKind: ProviderKind
  enabled: boolean
  iconSlug: string | null
}

export type ModelsByProfileId = Record<string, ModelDescriptor[]>
