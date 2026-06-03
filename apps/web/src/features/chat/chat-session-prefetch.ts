import type { QueryClient } from '@tanstack/react-query'

import {
  getChatSessionsBySessionIdMessagesOptions,
  getSessionsByIdOptions,
} from '~/api-gen/@tanstack/react-query.gen'

export function prefetchChatSession(queryClient: QueryClient, sessionId: string): void {
  void import('./chat-view')
  void queryClient.prefetchQuery(getSessionsByIdOptions({ path: { id: sessionId } }))
  void queryClient.prefetchQuery(getChatSessionsBySessionIdMessagesOptions({ path: { sessionId } }))
}
