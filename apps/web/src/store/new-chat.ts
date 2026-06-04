import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { RuntimeKind } from '~/lib/types'

import { persistStorage } from './persist-storage'

type PersistedThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh' | null

interface NewChatState {
  lastRuntimeKind: RuntimeKind | null
  lastCliTuiAgentId: string | null
  lastAgentProfileId: string | null
  /** map of profileId → last selected modelId */
  lastModelByProfile: Record<string, string>
  lastThinkingEffort: PersistedThinkingEffort
  setLastRuntimeKind: (kind: RuntimeKind | null) => void
  setLastCliTuiAgentId: (id: string | null) => void
  setLastAgentProfileId: (id: string | null) => void
  setLastModelForProfile: (profileId: string, modelId: string) => void
  setLastThinkingEffort: (effort: PersistedThinkingEffort) => void
  getLastModelForProfile: (profileId: string) => string | undefined
  reconcileProfiles: (profileIds: string[]) => void
}

export const useNewChatStore = create<NewChatState>()(
  persist(
    (set, get) => ({
      lastRuntimeKind: null,
      lastCliTuiAgentId: null,
      lastAgentProfileId: null,
      lastModelByProfile: {},
      lastThinkingEffort: null,
      setLastRuntimeKind: (kind) => {
        set((state) => {
          if (state.lastRuntimeKind === kind) {
            return state
          }
          return { lastRuntimeKind: kind }
        })
      },
      setLastCliTuiAgentId: (id) => {
        set((state) => {
          if (state.lastCliTuiAgentId === id) {
            return state
          }
          return { lastCliTuiAgentId: id }
        })
      },
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
      setLastThinkingEffort: (effort) => {
        set((state) => {
          if (state.lastThinkingEffort === effort) {
            return state
          }
          return { lastThinkingEffort: effort }
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
