// Input: openai ResponseStreamEvent type
// Output: ChatProvider interface + ChatResponseEventPayload IPC envelope type
// Position: Chat capability contract for streaming providers; used by ChatEngine and runtime providers

import type { ResponseStreamEvent } from 'openai/resources/responses/responses'

export type { ResponseStreamEvent }

/**
 * Provider-agnostic streaming interface for a single in-flight prompt.
 *
 * The generator yields `ResponseStreamEvent` events in the style of the
 * OpenAI Responses API. The ChatEngine wraps this generator; the engine is
 * responsible for emitting `response.created` before iterating and
 * `response.completed` / `response.failed` after iteration ends.
 *
 * Each `stream()` call covers exactly one user turn.  The caller (ChatEngine)
 * is responsible for ensuring only one turn is in flight per session at a time.
 */
export interface ChatProvider {
  stream: (message: string) => AsyncGenerator<ResponseStreamEvent, void, void>
  cancel: () => Promise<void>
}

/**
 * IPC envelope for the `chat:response-event` channel.
 *
 * Every event emitted during a chat turn — including lifecycle events
 * (`response.created`, `response.completed`) and content deltas — is wrapped
 * in this envelope so renderers can route the event to the correct session.
 */
export interface ChatResponseEventPayload {
  chatSessionId: string
  messageId: string
  event: ResponseStreamEvent
}
