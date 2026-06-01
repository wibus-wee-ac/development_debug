import type { UIMessage, UIMessageChunk } from 'ai'

import type { ProviderKind, RuntimeKind } from '../provider-contracts/types'
import type { CradleTurnTranscript } from './transcript'

export interface RuntimeProviderTargetProfile {
  id: string
  name: string
  providerKind: ProviderKind
  enabled: boolean
  configJson: string
  credentialRef: string | null
  customModels: string
  iconSlug: string | null
  providerTargetKind: 'manual' | 'external'
  providerTargetId: string
}

export interface RuntimeSlashCommand {
  name: string
  description: string
  argumentHint: string
  aliases?: string[]
}

export interface ChatRuntimeCapabilities {
  runtimeKind: RuntimeKind
  slashCommands: RuntimeSlashCommand[]
  skills: string[]
}

export type ChatPermissionMode = 'bypassPermissions' | 'plan'

export interface RuntimeSession {
  id: string
  chatSessionId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  providerStateSnapshot: string | null
}

export interface StartChatSessionInput {
  chatSessionId: string
  profile: RuntimeProviderTargetProfile
  workspacePath: string
  modelId?: string
}

export interface ResumeChatSessionInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  workspacePath: string
  modelId?: string
}

export interface StreamTurnInput {
  runId: string
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  message: UIMessage
  transcript?: CradleTurnTranscript
  originalMessages?: UIMessage[]
  responseMessageId?: string
  modelId?: string
  workspaceId?: string | null
  workspacePath?: string
  providerOptions?: {
    thinkingEffort?: 'low' | 'medium' | 'high'
    permissionMode?: ChatPermissionMode
  }
  systemPrompt?: string
  history?: UIMessage[]
  reportSessionTitle?: (title: string) => void
}

export interface CancelTurnInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
}

export interface SteerTurnInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  message: UIMessage
}

export interface GetCapabilitiesInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  workspaceId?: string | null
  workspacePath: string
  modelId?: string
  systemPrompt?: string
}

export interface SetPermissionModeInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  mode: ChatPermissionMode
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatRuntime {
  readonly runtimeKind: RuntimeKind
  readonly lastUsage?: TokenUsage | null
  readonly lastModelId?: string | null
  startChatSession: (input: StartChatSessionInput) => Promise<RuntimeSession>
  resumeChatSession: (input: ResumeChatSessionInput) => Promise<RuntimeSession>
  getCapabilities?: (input: GetCapabilitiesInput) => Promise<ChatRuntimeCapabilities>
  /**
   * Stream a turn, yielding AI SDK UIMessageChunk events directly.
   * No custom intermediate abstraction — pure AI SDK protocol.
   */
  streamTurn: (input: StreamTurnInput) => AsyncGenerator<UIMessageChunk, void, void>
  steerTurn?: (input: SteerTurnInput) => Promise<void>
  cancelTurn: (input: CancelTurnInput) => Promise<void>
  setPermissionMode?: (input: SetPermissionModeInput) => Promise<void>
}
