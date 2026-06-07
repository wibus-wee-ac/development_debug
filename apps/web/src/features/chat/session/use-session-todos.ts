import type { UIMessage } from 'ai'
import { useMemo } from 'react'

import { chatSelectors, useChatStore } from '~/store/chat'

import type { SessionTodoSnapshot } from './chat-todo-projection'
import { selectTodosFromMessages } from './chat-todo-projection'

const EMPTY_MESSAGES: UIMessage[] = []

export function useSessionTodos(sessionId: string | null): SessionTodoSnapshot | null {
  const messages = useChatStore(sessionId ? chatSelectors.messages(sessionId) : () => EMPTY_MESSAGES)
  return useMemo(() => selectTodosFromMessages(messages), [messages])
}
