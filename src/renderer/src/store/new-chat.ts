// Input: zustand, zustand/middleware
// Output: useNewChatStore hook for persisted new-chat preferences (last selected profile, model per profile)
// Position: Renderer store for cross-session new-chat page state

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NewChatState {
  lastAgentProfileId: string | null
  /** map of profileId → last selected modelId */
  lastModelByProfile: Record<string, string>
  setLastAgentProfileId: (id: string | null) => void
  setLastModelForProfile: (profileId: string, modelId: string) => void
  getLastModelForProfile: (profileId: string) => string | undefined
}

export const useNewChatStore = create<NewChatState>()(
  persist(
    (set, get) => ({
      lastAgentProfileId: null,
      lastModelByProfile: {},
      setLastAgentProfileId: (id) => { set({ lastAgentProfileId: id }) },
      setLastModelForProfile: (profileId, modelId) => {
        set((s) => ({
          lastModelByProfile: { ...s.lastModelByProfile, [profileId]: modelId },
        }))
      },
      getLastModelForProfile: (profileId) => get().lastModelByProfile[profileId],
    }),
    { name: 'cradle-new-chat' },
  ),
)
