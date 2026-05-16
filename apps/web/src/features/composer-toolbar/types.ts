// Input: RuntimeKind from lib/types
// Output: ComposerToolbar type definitions
// Position: Shared type definitions for the unified composer toolbar feature

import type { RuntimeKind } from '~/lib/types'

export type ComposerContext = 'new-chat' | 'capsule' | 'chat'

export type ThinkingEffort = 'low' | 'medium' | 'high' | null

export interface ComposerSelection {
  profileId: string | null
  modelId: string | null
  thinkingEffort: ThinkingEffort
  runtimeKind: RuntimeKind
}
