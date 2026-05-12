// Input: zustand, zustand/middleware
// Output: useNewChatStore hook for persisted new-chat preferences (last selected profile, model per profile)
// Position: Renderer store for cross-session new-chat page state

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from './persist-storage'

interface NewChatState {
  lastAgentProfileId: string | null
  /** map of profileId → last selected modelId */
  lastModelByProfile: Record<string, string>
  setLastAgentProfileId: (id: string | null) => void
  setLastModelForProfile: (profileId: string, modelId: string) => void
  getLastModelForProfile: (profileId: string) => string | undefined
  reconcileProfiles: (profileIds: string[]) => void
}

export const useNewChatStore = create<NewChatState>()(
  persist(
    (set, get) => ({
      lastAgentProfileId: null,
      lastModelByProfile: {},
      setLastAgentProfileId: (id) => {
        set((state) => {
          if (state.lastAgentProfileId === id) {
            return state
          }
          return { lastAgentProfileId: id }
        })
      },
      setLastModelForProfile: (profileId, modelId) => {
        set((state) => {
          if (state.lastModelByProfile[profileId] === modelId) {
            return state
          }
          return {
            lastModelByProfile: { ...state.lastModelByProfile, [profileId]: modelId },
          }
        })
      },
      getLastModelForProfile: profileId => get().lastModelByProfile[profileId],
      reconcileProfiles: (profileIds) => {
        set((state) => {
          const allowed = new Set(profileIds)
          const lastAgentProfileId = state.lastAgentProfileId && allowed.has(state.lastAgentProfileId)
            ? state.lastAgentProfileId
            : null

          const lastModelByProfile = Object.fromEntries(
            Object.entries(state.lastModelByProfile).filter(([profileId]) => allowed.has(profileId)),
          )

          const modelsUnchanged = Object.keys(state.lastModelByProfile).length === Object.keys(lastModelByProfile).length
            && Object.entries(lastModelByProfile).every(([profileId, modelId]) => state.lastModelByProfile[profileId] === modelId)

          if (state.lastAgentProfileId === lastAgentProfileId && modelsUnchanged) {
            return state
          }

          return {
            lastAgentProfileId,
            lastModelByProfile,
          }
        })
      },
    }),
    {
      name: 'cradle:new-chat:v1',
      storage: persistStorage,
      version: 1,
    },
  ),
)
