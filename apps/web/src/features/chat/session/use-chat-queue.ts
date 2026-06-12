import { useCallback } from 'react'

import { cancelChatSessionQueueItem, listChatSessionQueue, reorderChatSessionQueue } from '../commands/chat-response-command'
import type { ChatSessionRuntimeControls } from './use-chat-session-runtime-controls'

export function useChatQueue(
  chatSessionId: string | null,
  controls: Pick<ChatSessionRuntimeControls, 'refreshQueue'>,
) {
  const { refreshQueue } = controls

  const cancelQueueItem = useCallback(async (queueItemId: string) => {
    if (!chatSessionId) {
      return
    }
    await cancelChatSessionQueueItem({ sessionId: chatSessionId, queueItemId })
    refreshQueue()
  }, [chatSessionId, refreshQueue])

  const reorderQueueItems = useCallback(async (queueItemIds: string[]) => {
    if (!chatSessionId) {
      return
    }
    await reorderChatSessionQueue({ sessionId: chatSessionId, queueItemIds })
    refreshQueue()
  }, [chatSessionId, refreshQueue])

  return {
    listChatSessionQueue: chatSessionId ? () => listChatSessionQueue(chatSessionId) : undefined,
    cancelQueueItem,
    reorderQueueItems,
  }
}
