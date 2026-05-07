// Input: Typed payloads from chat, PTY, approval domains
// Output: Unified push event map — single source of truth for all main→renderer signals
// Position: Shared contract defining every push topic and its payload shape

import type { ApprovalRequestedPayload, ApprovalResolvedPayload } from './approval-events'
import type { ObservabilityIncident } from '@cradle/ipc'
import type {
  ChatSessionActivityPayload,
  ChatSessionTitlePayload,
  ChatTimelineEventPayload,
} from './chat-events'

// ── PTY Payloads ──────────────────────────────────────────────────────────────

export interface PtyDataPayload {
  sessionId: string
  data: string
}

export interface PtyTitlePayload {
  sessionId: string
  title: string
}

export interface PtyExitPayload {
  sessionId: string
  exitCode: number
  signal: number | null
}

export interface PtyNotificationPayload {
  sessionId: string
  message: string
}

export interface PtyCommandFinishPayload {
  sessionId: string
  exitCode: number
}

// ── Push Event Map ────────────────────────────────────────────────────────────

/**
 * Canonical map of every push topic to its payload type.
 * Adding a new push event = adding one entry here.
 */
export interface PushEventMap {
  // Chat
  'chat:timeline-event': ChatTimelineEventPayload
  'chat:session-title': ChatSessionTitlePayload
  'chat:session-activity': ChatSessionActivityPayload

  // PTY
  'pty:data': PtyDataPayload
  'pty:title': PtyTitlePayload
  'pty:exit': PtyExitPayload
  'pty:notification': PtyNotificationPayload
  'pty:command-finish': PtyCommandFinishPayload

  // Approval
  'approval:requested': ApprovalRequestedPayload
  'approval:resolved': ApprovalResolvedPayload

  // Observability
  'observability:incident': ObservabilityIncident
}

export type PushTopic = keyof PushEventMap
