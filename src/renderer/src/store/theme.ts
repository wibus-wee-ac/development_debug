// Input: zustand, zustand/middleware
// Output: useThemeStore hook with theme preference (light/dark/system)
// Position: Global theme state store, consumed by root route and settings UI

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    set => ({
      mode: 'system',
      setMode: mode => set({ mode }),
    }),
    { name: 'cradle-theme' },
  ),
)
