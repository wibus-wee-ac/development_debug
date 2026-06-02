// Output: Session-level latest TODO plugin state from persisted chat messages.
// Input: Chat session id and Zustand chat store message snapshots.
// Position: Chat feature hook shared by Right Aside and future Composer-adjacent TODO surfaces.

import { useMemo } from 'react'
import type { UIMessage } from 'ai'

import { chatSelectors, useChatStore } from '~/store/chat'

import { selectTodosFromMessages } from './chat-todo-projection'
import type { SessionTodoSnapshot } from './chat-todo-projection'

const EMPTY_MESSAGES: UIMessage[] = []

export function useSessionTodos(sessionId: string | null): SessionTodoSnapshot | null {
  const messages = useChatStore(sessionId ? chatSelectors.messages(sessionId) : () => EMPTY_MESSAGES)
  return useMemo(() => selectTodosFromMessages(messages), [messages])
}
