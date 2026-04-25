// Input: OpenAI ResponseStreamEvent type
// Output: Chat push event payload types for IPC channels
// Position: Shared types used by main (ChatEngine), preload (chatPush), and renderer (useChatEvents)

import type { ResponseStreamEvent } from 'openai/resources/responses/responses'

/** Payload for the `chat:response-event` IPC push channel. */
export interface ChatResponseEventPayload {
  chatSessionId: string
  messageId: string
  event: ResponseStreamEvent
}

/** Payload for the `chat:session-title` IPC push channel. */
export interface ChatSessionTitlePayload {
  chatSessionId: string
  title: string
}
