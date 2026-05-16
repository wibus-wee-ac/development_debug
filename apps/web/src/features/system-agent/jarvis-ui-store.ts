// Input: zustand
// Output: useJarvisUiStore hook for Jarvis feature UI state
// Position: System-agent feature-owned UI state separated from shell layout ownership

import { create } from 'zustand'

interface JarvisUiState {
  expanded: boolean
  setExpanded: (expanded: boolean) => void
}

export const useJarvisUiStore = create<JarvisUiState>()(set => ({
  expanded: false,
  setExpanded: expanded => set({ expanded }),
}))