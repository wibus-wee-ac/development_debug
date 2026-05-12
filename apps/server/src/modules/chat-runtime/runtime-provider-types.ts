// Input: provider kind definitions and chat runtime provider contract
// Output: runtime provider types for chat-runtime module
// Position: apps/server/src/modules/chat-runtime/runtime-provider-types.ts

import type { AgentProfile } from '@cradle/db'
import type { UIMessageChunk } from 'ai'

import type { ProviderKind } from '../providers/types'

export interface RuntimeSession {
  id: string
  chatSessionId: string
  agentProfileId: string
  providerKind: ProviderKind
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
  modelId?: string
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

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatRuntimeProvider {
  readonly providerKind: ProviderKind
  readonly lastUsage?: TokenUsage | null
  startChatSession: (input: StartChatSessionInput) => Promise<RuntimeSession>
  resumeChatSession: (input: ResumeChatSessionInput) => Promise<RuntimeSession>
  /**
   * Stream a turn, yielding AI SDK UIMessageChunk events directly.
   * No custom intermediate abstraction — pure AI SDK protocol.
   */
  streamTurn: (input: StreamTurnInput) => AsyncGenerator<UIMessageChunk, void, void>
  cancelTurn: (input: CancelTurnInput) => Promise<void>
}
