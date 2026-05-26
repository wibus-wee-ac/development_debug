// Output: Stores the app-wide global search dialog open state.
// Input: Command palette open and close intents from shell, workspace, home, and desktop tray surfaces.
// Position: Search-owned UI state consumed by App and search entry points.

import { create } from 'zustand'

interface GlobalSearchState {
  open: boolean
  initialQuery: string
  setOpen: (open: boolean) => void
  openPalette: (initialQuery?: string) => void
  openSearch: () => void
  closeSearch: () => void
}

export const useGlobalSearchStore = create<GlobalSearchState>((set) => ({
  open: false,
  initialQuery: '>',
  setOpen: (open) => set({ open }),
  openPalette: (initialQuery = '>') => set({ initialQuery, open: true }),
  openSearch: () => set({ initialQuery: '>', open: true }),
  closeSearch: () => set({ open: false })
}))
