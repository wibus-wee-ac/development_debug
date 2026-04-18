// Input: zustand, zustand/middleware
// Output: useLayoutStore hook for persisted panel and sidebar layout state
// Position: Renderer global UI layout store used across the application shell

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface LayoutState {
  sidebarWidth: number
  asideWidth: number
  bottomPanelHeight: number
  asideOpen: boolean
  bottomPanelOpen: boolean
  setSidebarWidth: (w: number) => void
  setAsideWidth: (w: number) => void
  setBottomPanelHeight: (h: number) => void
  toggleAside: () => void
  toggleBottomPanel: () => void
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarWidth: 260,
      asideWidth: 280,
      bottomPanelHeight: 200,
      asideOpen: false,
      bottomPanelOpen: false,
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setAsideWidth: (asideWidth) => set({ asideWidth }),
      setBottomPanelHeight: (bottomPanelHeight) => set({ bottomPanelHeight }),
      toggleAside: () => set((s) => ({ asideOpen: !s.asideOpen })),
      toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen }))
    }),
    { name: 'cradle-layout' }
  )
)
