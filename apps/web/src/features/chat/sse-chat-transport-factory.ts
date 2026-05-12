// Input: sessionId string
// Output: re-exports createSseChatTransport and SseChatTransportHandle for ergonomic import
// Position: apps/web/src/features/chat/sse-chat-transport-factory.ts

export type { SseChatTransportHandle } from './sse-chat-transport'
export { createSseChatTransport } from './sse-chat-transport'
