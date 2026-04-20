// Input: zustand
// Output: useSessionActivityStore — tracks sessions that have received new responses while not viewed
// Position: Global UI state store, consumed by AppLayout (listener) and WorkspaceSidebar (indicator)

import { create } from 'zustand'

interface SessionActivityState {
  /** Session IDs that received a `response.completed` or `response.failed` while not active */
  unread: Set<string>
  markUnread: (sessionId: string) => void
  clearUnread: (sessionId: string) => void
}

export const useSessionActivityStore = create<SessionActivityState>()(set => ({
  unread: new Set<string>(),
  markUnread: sessionId =>
    set(s => {
      const next = new Set(s.unread)
      next.add(sessionId)
      return { unread: next }
    }),
  clearUnread: sessionId =>
    set(s => {
      if (!s.unread.has(sessionId)) {
        return s
      }
      const next = new Set(s.unread)
      next.delete(sessionId)
      return { unread: next }
    }),
}))
