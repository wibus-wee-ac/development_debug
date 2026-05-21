import type { AnimationPresetName } from '@cradle/streamdown'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from './persist-storage'

interface StreamdownState {
  animationPreset: AnimationPresetName
  animateMode: 'char' | 'word'
  showCursor: boolean
  setAnimationPreset: (p: AnimationPresetName) => void
  setAnimateMode: (m: 'char' | 'word') => void
  setShowCursor: (v: boolean) => void
}

export const useStreamdownStore = create<StreamdownState>()(
  persist(
    set => ({
      animationPreset: 'balanced',
      animateMode: 'word',
      showCursor: false,
      setAnimationPreset: animationPreset => set({ animationPreset }),
      setAnimateMode: animateMode => set({ animateMode }),
      setShowCursor: showCursor => set({ showCursor }),
    }),
    {
      name: 'cradle:streamdown:v1',
      storage: persistStorage,
      version: 1,
    },
  ),
)
