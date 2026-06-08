import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

interface OnboardingState {
  completed: boolean
  roles: string[]
  personalizedSuggestionsEnabled: boolean
  complete: (preferences?: { roles?: string[], personalizedSuggestionsEnabled?: boolean }) => void
  reset: () => void
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    set => ({
      completed: false,
      roles: [],
      personalizedSuggestionsEnabled: true,

      complete: preferences =>
        set(state => ({
          completed: true,
          roles: preferences?.roles ?? state.roles,
          personalizedSuggestionsEnabled:
            preferences?.personalizedSuggestionsEnabled ?? state.personalizedSuggestionsEnabled,
        })),

      reset: () => set({ completed: false, roles: [], personalizedSuggestionsEnabled: true }),
    }),
    {
      name: 'cradle:onboarding:v1',
      storage: persistStorage,
      version: 1,
      partialize: state => ({
        completed: state.completed,
        roles: state.roles,
        personalizedSuggestionsEnabled: state.personalizedSuggestionsEnabled,
      }),
    },
  ),
)
