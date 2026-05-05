// Input: Typed timeline events and AI SDK chat chunk projection types
// Output: Chat push event payload types for IPC channels
// Position: Shared types used by main (ChatEngine), preload (chatPush), and renderer (chat event hooks)

import type { UIMessageChunk } from 'ai'

import type { BackendTimelineEvent } from '../main/backend-control-plane/timeline-events'
import type { ChatTurnStatus } from '../main/chat/chat-engine'

/** Payload for the `chat:timeline-event` IPC push channel. */
export interface ChatTimelineEventPayload {
  chatSessionId: string
  messageId: string
  event: BackendTimelineEvent
  chunks: UIMessageChunk[]
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
