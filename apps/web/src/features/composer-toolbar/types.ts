import type { ModelDescriptor, RuntimeKind } from '~/lib/types'

export type ComposerContext = 'new-chat' | 'capsule' | 'chat'

export type ThinkingEffort = 'low' | 'medium' | 'high' | null

export interface ComposerSelection {
  agentId: string | null
  profileId: string | null
  modelId: string | null
  thinkingEffort: ThinkingEffort
  runtimeKind: RuntimeKind
}

export type ModelsByProfileId = Record<string, ModelDescriptor[]>
