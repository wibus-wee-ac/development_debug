import type { AgentProfile } from '@cradle/db'
import type { UIMessage, UIMessageChunk } from 'ai'

import type { RuntimeKind } from '../providers/types'

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

export interface RuntimeSession {
  id: string
  chatSessionId: string
  agentProfileId: string
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  providerStateSnapshot: string | null
}

export interface StartChatSessionInput {
  chatSessionId: string
  profile: AgentProfile
  workspacePath: string
  modelId?: string
}

export interface ResumeChatSessionInput {
  runtimeSession: RuntimeSession
  profile: AgentProfile
  workspacePath: string
  modelId?: string
}

export interface StreamTurnInput {
  runtimeSession: RuntimeSession
  profile: AgentProfile
  message: UIMessage
  responseMessageId?: string
  modelId?: string
  workspaceId?: string | null
  workspacePath?: string
  providerOptions?: {
    thinkingEffort?: 'low' | 'medium' | 'high'
  }
  systemPrompt?: string
  history?: UIMessage[]
}

export interface CancelTurnInput {
  runtimeSession: RuntimeSession
  profile: AgentProfile
}

export interface SteerTurnInput {
  runtimeSession: RuntimeSession
  profile: AgentProfile
  message: UIMessage
}

export interface GetCapabilitiesInput {
  runtimeSession: RuntimeSession
  profile: AgentProfile
  workspaceId?: string | null
  workspacePath: string
  modelId?: string
  systemPrompt?: string
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
  streamTurnSnapshots?: (input: StreamTurnInput) => AsyncGenerator<UIMessage, void, void>
  /**
   * Stream a turn, yielding AI SDK UIMessageChunk events directly.
   * No custom intermediate abstraction — pure AI SDK protocol.
   */
  streamTurn: (input: StreamTurnInput) => AsyncGenerator<UIMessageChunk, void, void>
  steerTurn?: (input: SteerTurnInput) => Promise<void>
  cancelTurn: (input: CancelTurnInput) => Promise<void>
}
