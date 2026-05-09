// Input: provider kind definitions and chat timeline event contract
// Output: runtime provider types for chat-runtime module
// Position: apps/server/src/modules/chat-runtime/runtime-provider-types.ts

import type { AgentProfile } from '@cradle/db'

import type { ProviderKind } from '../providers/types'

export interface TimelineSource {
  backend: ProviderKind
  eventType: string
  eventId?: string | null
  itemId?: string | null
  metadata?: Record<string, unknown>
}

interface TimelineEventBase {
  source: TimelineSource
}

export type TimelineInputEvent
  = (TimelineEventBase & { type: 'run.started' })
    | (TimelineEventBase & { type: 'assistant.message.started', itemId: string })
    | (TimelineEventBase & { type: 'assistant.text.delta', itemId: string, delta: string })
    | (TimelineEventBase & { type: 'assistant.message.completed', itemId: string })
    | (TimelineEventBase & { type: 'reasoning.started', itemId: string })
    | (TimelineEventBase & { type: 'reasoning.delta', itemId: string, delta: string })
    | (TimelineEventBase & { type: 'reasoning.completed', itemId: string })
    | (TimelineEventBase & { type: 'tool_call.started', itemId: string, toolName: string, toolInput?: string | null })
    | (TimelineEventBase & { type: 'tool_call.completed', itemId: string, result?: string | null })
    | (TimelineEventBase & { type: 'command.started', itemId: string, command: string })
    | (TimelineEventBase & { type: 'command.output.delta', itemId: string, stream: 'stdout' | 'stderr', delta: string })
    | (TimelineEventBase & { type: 'command.completed', itemId: string, exitCode?: number | null, output?: string | null })
    | (TimelineEventBase & { type: 'file_change.started', itemId: string, paths: string[] })
    | (TimelineEventBase & { type: 'file_change.completed', itemId: string, paths: string[], status: 'completed' | 'failed' })
    | (TimelineEventBase & { type: 'run.completed' })
    | (TimelineEventBase & { type: 'run.aborted' })
    | (TimelineEventBase & { type: 'run.failed', error: string })

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
  streamTurn: (input: StreamTurnInput) => AsyncGenerator<TimelineInputEvent, void, void>
  cancelTurn: (input: CancelTurnInput) => Promise<void>
}
