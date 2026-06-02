// Output: Persisted onboarding state — step tracking and completion flag.
// Input: User interactions from OnboardingPage.
// Position: Web-owned store; survives page reload via localStorage.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

export const ONBOARDING_TOTAL_STEPS = 5

interface OnboardingState {
  /** Whether the user has completed (or dismissed) onboarding */
  completed: boolean
  /** Current step index (0-based) */
  step: number

  // Actions
  nextStep: () => void
  prevStep: () => void
  goToStep: (step: number) => void
  complete: () => void
  reset: () => void
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    set => ({
      completed: false,
      step: 0,

      nextStep: () =>
        set(s => ({
          step: Math.min(s.step + 1, ONBOARDING_TOTAL_STEPS - 1),
        })),

      prevStep: () =>
        set(s => ({
          step: Math.max(s.step - 1, 0),
        })),

      goToStep: (step: number) =>
        set({ step: Math.max(0, Math.min(step, ONBOARDING_TOTAL_STEPS - 1)) }),

      complete: () => set({ completed: true }),

      reset: () => set({ completed: false, step: 0 }),
    }),
    {
      name: 'cradle:onboarding:v1',
      storage: persistStorage,
      version: 1,
      // In dev, never persist — so the onboarding always shows fresh on every reload.
      partialize: import.meta.env.DEV ? () => ({}) : undefined,
    },
  ),
)
