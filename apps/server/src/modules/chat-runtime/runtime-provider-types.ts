// Input: runtime kind definitions and chat runtime contract
// Output: runtime types for chat-runtime module
// Position: apps/server/src/modules/chat-runtime/runtime-provider-types.ts

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
  message: string
  responseMessageId?: string
  modelId?: string
  workspaceId?: string | null
  workspacePath?: string
  providerOptions?: {
    thinkingEffort?: 'low' | 'medium' | 'high'
  }
  systemPrompt?: string
  history?: Array<{ role: 'user' | 'assistant', content: string }>
}

export interface CancelTurnInput {
  runtimeSession: RuntimeSession
  profile: AgentProfile
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
  cancelTurn: (input: CancelTurnInput) => Promise<void>
}
