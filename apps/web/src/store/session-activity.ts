import { create } from 'zustand'

interface SessionActivityState {
  /** Session IDs that received assistant activity while not currently visible to the user. */
  unread: Set<string>
  visibleSessionId: string | null
  markRead: (sessionId: string) => void
  markUnread: (sessionId: string) => void
  recordActivity: (sessionId: string) => void
  setVisibleSession: (sessionId: string | null) => void
}

export const useSessionActivityStore = create<SessionActivityState>()(set => ({
  unread: new Set<string>(),
  visibleSessionId: null,
  markRead: sessionId =>
    set((s) => {
      if (!sessionId || !s.unread.has(sessionId)) {
        return s
      }
      const next = new Set(s.unread)
      next.delete(sessionId)
      return { unread: next }
    }),
  markUnread: sessionId =>
    set((s) => {
      if (!sessionId || s.unread.has(sessionId)) {
        return s
      }
      const next = new Set(s.unread)
      next.add(sessionId)
      return { unread: next }
    }),
  recordActivity: sessionId =>
    set((s) => {
      if (!sessionId || s.visibleSessionId === sessionId || s.unread.has(sessionId)) {
        return s
      }
      const next = new Set(s.unread)
      next.add(sessionId)
      return { unread: next }
    }),
  setVisibleSession: visibleSessionId =>
    set((s) => {
      const next = new Set(s.unread)
      if (visibleSessionId) {
        next.delete(visibleSessionId)
      }
      return {
        visibleSessionId,
        unread: next,
      }
    }),
}))
