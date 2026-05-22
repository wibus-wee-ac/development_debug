// Output: Runtime-only bottom terminal panel session state.
// Input: Workspace/chat owners that need bottom-panel terminal sessions.
// Position: Owned by TUI; it stores panel session UI state without writing to workspace/session namespaces.

import { create } from 'zustand'

export interface TerminalPanelSession {
  id: string
  title: string
  cwd: string
  createdAt: number
}

interface TerminalPanelOwnerState {
  sessions: TerminalPanelSession[]
  activeSessionId: string | null
  nextIndex: number
}

interface TerminalPanelState {
  owners: Record<string, TerminalPanelOwnerState>
  registerOwner: (ownerId: string, cwd: string) => void
  addSession: (ownerId: string, cwd: string) => TerminalPanelSession
  activateSession: (ownerId: string, sessionId: string) => void
  removeSession: (ownerId: string, sessionId: string) => void
  updateSessionTitle: (ownerId: string, sessionId: string, title: string) => void
}

function createSession(ownerId: string, cwd: string, index: number): TerminalPanelSession {
  return {
    id: `terminal:${ownerId}:${index}`,
    title: index === 1 ? 'Terminal' : `Terminal ${index}`,
    cwd,
    createdAt: Date.now(),
  }
}

function buildInitialOwnerState(ownerId: string, cwd: string): TerminalPanelOwnerState {
  return {
    sessions: [createSession(ownerId, cwd, 1)],
    activeSessionId: `terminal:${ownerId}:1`,
    nextIndex: 2,
  }
}

export const useTerminalPanelStore = create<TerminalPanelState>()(
  (set, get) => ({
    owners: {},
    registerOwner: (ownerId, cwd) => {
      set((state) => {
        const owner = state.owners[ownerId]
        if (owner && owner.sessions.length > 0) {
          return state
        }

        return {
          owners: {
            ...state.owners,
            [ownerId]: buildInitialOwnerState(ownerId, cwd),
          },
        }
      })
    },
    addSession: (ownerId, cwd) => {
      const owner = get().owners[ownerId] ?? buildInitialOwnerState(ownerId, cwd)
      const index = owner.nextIndex
      const session = createSession(ownerId, cwd, index)

      set((state) => ({
        owners: {
          ...state.owners,
          [ownerId]: {
            sessions: [...owner.sessions, session],
            activeSessionId: session.id,
            nextIndex: index + 1,
          },
        },
      }))

      return session
    },
    activateSession: (ownerId, sessionId) => {
      set((state) => {
        const owner = state.owners[ownerId]
        if (!owner || owner.activeSessionId === sessionId || !owner.sessions.some(session => session.id === sessionId)) {
          return state
        }

        return {
          owners: {
            ...state.owners,
            [ownerId]: {
              ...owner,
              activeSessionId: sessionId,
            },
          },
        }
      })
    },
    removeSession: (ownerId, sessionId) => {
      set((state) => {
        const owner = state.owners[ownerId]
        if (!owner) {
          return state
        }

        const removed = owner.sessions.find(session => session.id === sessionId)
        const sessions = owner.sessions.filter(session => session.id !== sessionId)
        if (sessions.length === 0) {
          return {
            owners: {
              ...state.owners,
              [ownerId]: buildInitialOwnerState(ownerId, removed?.cwd ?? owner.sessions[0]?.cwd ?? ''),
            },
          }
        }

        return {
          owners: {
            ...state.owners,
            [ownerId]: {
              ...owner,
              sessions,
              activeSessionId: owner.activeSessionId === sessionId ? sessions.at(-1)!.id : owner.activeSessionId,
            },
          },
        }
      })
    },
    updateSessionTitle: (ownerId, sessionId, title) => {
      set((state) => {
        const owner = state.owners[ownerId]
        if (!owner) {
          return state
        }

        const trimmed = title.trim()
        if (!trimmed) {
          return state
        }

        return {
          owners: {
            ...state.owners,
            [ownerId]: {
              ...owner,
              sessions: owner.sessions.map(session => (
                session.id === sessionId && session.title !== trimmed
                  ? { ...session, title: trimmed }
                  : session
              )),
            },
          },
        }
      })
    },
  }),
)
