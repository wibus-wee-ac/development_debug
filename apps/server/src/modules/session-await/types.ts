import type { sessionAwaits } from '@cradle/db'

export type SessionAwait = typeof sessionAwaits.$inferSelect

export type SessionAwaitStatus = 'pending' | 'triggered' | 'expired' | 'cancelled' | 'failed'

export interface RegisterAwaitInput {
  chatSessionId: string
  workspaceId: string
  source: string
  filterJson: string
  reason?: string | null
  expiresAt?: number | null
  fireAt?: number | null
}

export interface TriggerAwaitInput {
  awaitId: string
  resumeText: string
  resumePayloadJson?: string | null
}

export interface SessionAwaitSummary {
  awaiting: boolean
  pendingCount: number
  primarySource: string | null
  reason: string | null
}

export interface CheckResult {
  awaitId: string
  matched: boolean
  resumeText?: string
  resumePayloadJson?: string
  transientError?: string
}

export interface SessionAwaitSource {
  source: string
  pollIntervalMs?: number
  checkPending(awaits: SessionAwait[]): Promise<CheckResult[]>
}
