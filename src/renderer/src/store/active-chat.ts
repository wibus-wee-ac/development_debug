// Input: zustand
// Output: useActiveChatStore — shared store for the currently active chat session
// Position: Global store bridging sidebar navigation and chat content area

import { create } from 'zustand'

interface ActiveChatState {
  /** ACP session ID (also used as DB session ID) */
  sessionId: string | null
  agentId: string | null
  workspaceId: string | null

  /** Open an existing session from sidebar */
  openSession: (opts: { sessionId: string, agentId: string, workspaceId: string }) => void
  /** Start a fresh chat (reset session) */
  resetChat: () => void
}

export const useActiveChatStore = create<ActiveChatState>(set => ({
  sessionId: null,
  agentId: null,
  workspaceId: null,

  openSession: ({ sessionId, agentId, workspaceId }) =>
    set({ sessionId, agentId, workspaceId }),

  resetChat: () =>
    set({ sessionId: null }),
}))
