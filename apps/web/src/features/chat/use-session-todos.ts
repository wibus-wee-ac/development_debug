// Output: Session-level latest TODO plugin state from persisted chat messages.
// Input: Chat session id and Zustand chat store message snapshots.
// Position: Chat feature hook shared by Right Aside and future Composer-adjacent TODO surfaces.

import { useMemo } from 'react'

import { useChatStore } from '~/store/chat'

import { selectTodosFromMessages } from './chat-todo-projection'
import type { SessionTodoSnapshot } from './chat-todo-projection'

const EMPTY_MESSAGES: Parameters<typeof selectTodosFromMessages>[0] = []

export function useSessionTodos(sessionId: string | null): SessionTodoSnapshot | null {
  const messages = useChatStore((state) => {
    if (!sessionId) {
      return EMPTY_MESSAGES
    }
    return state.messagesMap.get(sessionId) ?? EMPTY_MESSAGES
  })
  return useMemo(() => selectTodosFromMessages(messages), [messages])
}
