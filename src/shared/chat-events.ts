// Input: Typed timeline events and AI SDK chat chunk projection types
// Output: Chat push event payload types for IPC channels
// Position: Shared types used by main (ChatEngine), preload (chatPush), and renderer (chat event hooks)

import type { UIMessageChunk } from 'ai'

import type { BackendTimelineEvent } from '../main/features/backend-control-plane/timeline-events'

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
