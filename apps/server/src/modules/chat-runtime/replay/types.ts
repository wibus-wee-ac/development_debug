import type { RuntimeKind } from '../../provider-contracts/types'
import type { ChatRuntimeEventRecord } from '../events'

export type ProviderReplayTarget =
  | 'normal_turn'
  | 'resume_session'
  | 'fork_thread'
  | 'compact_continue'
  | 'provider_target_switch'

export interface ReplayLimits {
  maxEvents?: number
  maxChars?: number
}

export interface ProviderReplayProjection<TOutput> {
  output: TOutput
  diagnostics: ProviderReplayDiagnostic[]
}

export interface ProviderReplayDiagnostic {
  severity: 'info' | 'warning'
  eventId?: string
  message: string
}

export interface ChatRuntimeReplayProjectInput {
  events: ChatRuntimeEventRecord[]
  target: ProviderReplayTarget
  limits: ReplayLimits
}

export interface ChatRuntimeReplayProjector<TOutput> {
  runtimeKind: RuntimeKind
  project(input: ChatRuntimeReplayProjectInput): ProviderReplayProjection<TOutput>
}

export interface CradleReplayToolCall {
  id: string
  identifier: string
  apiName: string
  args: unknown
  result?: unknown
  eventIds: string[]
}
