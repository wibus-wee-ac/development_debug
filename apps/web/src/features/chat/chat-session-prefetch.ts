// Output: Chat-owned prefetch boundary for opening existing chat sessions.
// Input: React Query client plus a target chat session id.
// Position: Lets navigation surfaces express intent without owning chat transcript query details.

import type { QueryClient } from '@tanstack/react-query'

import {
  getChatSessionsBySessionIdMessagesOptions,
  getSessionsByIdOptions,
} from '~/api-gen/@tanstack/react-query.gen'

import { preloadChatView } from './chat-view-loader'

export function prefetchChatSession(queryClient: QueryClient, sessionId: string): void {
  preloadChatView()
  void queryClient.prefetchQuery(getSessionsByIdOptions({ path: { id: sessionId } }))
  void queryClient.prefetchQuery(getChatSessionsBySessionIdMessagesOptions({ path: { sessionId } }))
}
