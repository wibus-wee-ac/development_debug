// Shared chat event payload types for SSE/push channels

/** Chat turn status values. */
export type ChatTurnStatus = 'streaming' | 'complete' | 'aborted' | 'failed'

/** Payload for the `chat:timeline-event` IPC push channel. */
export interface ChatTimelineEventPayload {
  chatSessionId: string
  messageId: string
  event: Record<string, unknown>
}

/** Payload for the `chat:session-title` IPC push channel. */
export interface ChatSessionTitlePayload {
  chatSessionId: string
  title: string
}

/** Payload for the `chat:session-activity` IPC push channel. */
export interface ChatSessionActivityPayload {
  chatSessionId: string
  messageId: string
  status: ChatTurnStatus
  errorText: string | null
}
