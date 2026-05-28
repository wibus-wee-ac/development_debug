// Output: Session-level latest TODO plugin state from persisted chat messages.
// Input: Chat session id and Zustand chat store message snapshots.
// Position: Chat feature hook shared by Right Aside and future Composer-adjacent TODO surfaces.

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { chatSelectors, useChatStore } from '~/store/chat'

import { selectTodosFromToolEntities } from './chat-todo-projection'
import type { SessionTodoSnapshot } from './chat-todo-projection'

const EMPTY_TOOLS: Parameters<typeof selectTodosFromToolEntities>[0] = []

export function useSessionTodos(sessionId: string | null): SessionTodoSnapshot | null {
  const tools = useChatStore(
    useShallow(sessionId ? chatSelectors.sessionToolEntities(sessionId) : () => EMPTY_TOOLS),
  )
  return useMemo(() => selectTodosFromToolEntities(tools), [tools])
}
