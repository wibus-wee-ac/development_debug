// Input: ResponseStreamEvent type from chat-provider
// Output: Agent runtime provider types shared by main-process services and providers
// Position: Core type contract for the main-process agent runtime layer

import type { ResponseStreamEvent } from '../lib/chat-provider'

export type ProviderKind
  = 'acp-chat'
    | 'cli-tui'
    | 'openai-compatible'

export interface AgentProfile {
  id: string
  name: string
  providerKind: ProviderKind
  enabled: boolean
  configJson: string
  credentialRef: string | null
  createdAt: number
  updatedAt: number
}

export interface ProviderProbeResult {
  ok: boolean
  label: string
  version: string | null
  details: Record<string, unknown>
  errorText: string | null
}

export interface ModelDescriptor {
  id: string
  label: string
  providerKind: ProviderKind
  contextWindow: number | null
}

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
  /** Override the model specified in the profile's configJson. */
  modelId?: string
}

export interface ResumeChatSessionInput {
  runtimeSession: RuntimeSession
  profile: AgentProfile
  workspacePath: string
  /** Override the model specified in the profile's configJson. */
  modelId?: string
}

export interface StreamTurnInput {
  runtimeSession: RuntimeSession
  profile: AgentProfile
  message: string
  /** Override the model for this turn. Takes precedence over profile configJson. */
  modelId?: string
  /** Reasoning effort hint for models that support it (e.g., OpenAI o-series). */
  thinkingEffort?: 'low' | 'medium' | 'high'
}

export interface CancelTurnInput {
  runtimeSession: RuntimeSession
  profile: AgentProfile
}

export interface StartTerminalSessionInput {
  sessionId: string
  profile: AgentProfile
  workspacePath: string
  cols: number
  rows: number
}

export interface StopTerminalSessionInput {
  sessionId: string
  profile: AgentProfile
}

export interface TerminalSessionResult {
  sessionId: string
}

export interface AgentProvider {
  readonly providerKind: ProviderKind
  probe: (profile: AgentProfile) => Promise<ProviderProbeResult>
  listModels: (profile: AgentProfile) => Promise<ModelDescriptor[]>
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatRuntimeProvider extends AgentProvider {
  startChatSession: (input: StartChatSessionInput) => Promise<RuntimeSession>
  resumeChatSession: (input: ResumeChatSessionInput) => Promise<RuntimeSession>
  streamTurn: (input: StreamTurnInput) => AsyncGenerator<ResponseStreamEvent, void, void>
  cancelTurn: (input: CancelTurnInput) => Promise<void>
  /** Token usage from the most recent streamTurn call, if the provider supports it. */
  readonly lastUsage?: TokenUsage | null
}

export interface TerminalRuntimeProvider extends AgentProvider {
  startTerminalSession: (input: StartTerminalSessionInput) => Promise<TerminalSessionResult>
  stopTerminalSession: (input: StopTerminalSessionInput) => Promise<void>
}
