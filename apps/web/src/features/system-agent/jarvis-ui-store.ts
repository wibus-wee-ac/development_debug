import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface JarvisSession {
  id: string
  title: string
  createdAt: number
}

interface JarvisUiState {
  expanded: boolean
  setExpanded: (expanded: boolean) => void

  // Window dimensions (persisted)
  panelWidth: number
  panelHeight: number
  setPanelSize: (width: number, height: number) => void

  // Session management
  sessions: JarvisSession[]
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  addSession: (session: JarvisSession) => void
  removeSession: (id: string) => void
}

export const useJarvisUiStore = create<JarvisUiState>()(
  persist(
    set => ({
      expanded: false,
      setExpanded: expanded => set({ expanded }),

      panelWidth: 420,
      panelHeight: 520,
      setPanelSize: (panelWidth, panelHeight) => set({ panelWidth, panelHeight }),

      sessions: [],
      activeSessionId: null,
      setActiveSessionId: activeSessionId => set({ activeSessionId }),
      addSession: session => set(s => ({ sessions: [...s.sessions, session] })),
      removeSession: id => set(s => ({
        sessions: s.sessions.filter(sess => sess.id !== id),
        activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
      })),
    }),
    {
      name: 'jarvis-ui',
      partialize: state => ({
        panelWidth: state.panelWidth,
        panelHeight: state.panelHeight,
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
)
