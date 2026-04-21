// Input: nothing (global store)
// Output: useTuiPoolStore — tracks active CLI TUI sessions for keep-alive rendering
// Position: Global Zustand store consumed by TuiPool and chat.$sessionId route

import { create } from 'zustand'

interface TuiPoolState {
  /** All session IDs that have been opened as TUI (keep-alive pool) */
  sessions: string[]
  /** The currently visible TUI session, or null if viewing a chat session */
  activeId: string | null
  /** Register a session into the pool and make it active */
  activate: (sessionId: string) => void
  /** Mark no TUI as active (e.g. user navigated to a chat session) */
  deactivate: () => void
  /** Remove a session from the pool permanently (e.g. session deleted) */
  remove: (sessionId: string) => void
}

export const useTuiPoolStore = create<TuiPoolState>()((set) => ({
  sessions: [],
  activeId: null,
  activate: (sessionId) =>
    set(s => ({
      sessions: s.sessions.includes(sessionId) ? s.sessions : [...s.sessions, sessionId],
      activeId: sessionId,
    })),
  deactivate: () => set({ activeId: null }),
  remove: (sessionId) =>
    set(s => ({
      sessions: s.sessions.filter(id => id !== sessionId),
      activeId: s.activeId === sessionId ? null : s.activeId,
    })),
}))
