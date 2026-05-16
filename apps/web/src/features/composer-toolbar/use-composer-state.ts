// Input: useNewChatStore, useAgentProfiles, useAgentModels, ComposerContext
// Output: useComposerState — unified state hook for all composer contexts
// Position: Replaces duplicated useReducer logic across NewChat and Capsule composers

import { useMemo, useState } from 'react'

import { useAgentModels } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import type { AgentProfile, ModelDescriptor, RuntimeKind } from '~/lib/types'
import { useNewChatStore } from '~/store/new-chat'

import type { ComposerContext, ComposerSelection, ThinkingEffort } from './types'

interface ComposerStateConfig {
  context: ComposerContext
  /** For 'chat' context — the session's bound profile */
  boundProfileId?: string
  /** For 'chat' context — the session's runtime kind */
  boundRuntimeKind?: RuntimeKind
}

export interface ComposerStateResult {
  selection: ComposerSelection
  setProfileId: (id: string) => void
  setModelId: (id: string) => void
  setThinkingEffort: (effort: ThinkingEffort) => void
  setRuntimeKind: (kind: RuntimeKind) => void
  profiles: AgentProfile[]
  models: ModelDescriptor[]
  isLoadingModels: boolean
  effectiveProfile: AgentProfile | null
  effectiveModel: ModelDescriptor | null
}

export function useComposerState(config: ComposerStateConfig): ComposerStateResult {
  const { context, boundProfileId, boundRuntimeKind } = config

  // Persisted state
  const lastProfileId = useNewChatStore(s => s.lastAgentProfileId)
  const setLastProfileId = useNewChatStore(s => s.setLastAgentProfileId)
  const setLastModelForProfile = useNewChatStore(s => s.setLastModelForProfile)
  const lastModelByProfile = useNewChatStore(s => s.lastModelByProfile)

  // Data
  const { profiles } = useAgentProfiles()

  // Local non-persisted state
  const [manualModelId, setManualModelId] = useState<string | null>(null)
  const [thinkingEffort, setThinkingEffortState] = useState<ThinkingEffort>(null)
  const [runtimeKind, setRuntimeKindState] = useState<RuntimeKind>(boundRuntimeKind ?? 'standard')

  // Resolve effective profile
  const profileId = useMemo(() => {
    if (context === 'chat') return boundProfileId ?? null
    const persisted = lastProfileId && profiles.some(p => p.id === lastProfileId) ? lastProfileId : null
    return persisted ?? profiles[0]?.id ?? null
  }, [context, boundProfileId, lastProfileId, profiles])

  // Load models for effective profile
  const { models, isLoading: isLoadingModels } = useAgentModels(profileId)

  // Resolve effective model
  const modelId = useMemo(() => {
    if (manualModelId && models.some(m => m.id === manualModelId)) return manualModelId
    const persisted = profileId ? lastModelByProfile[profileId] : undefined
    if (persisted && models.some(m => m.id === persisted)) return persisted
    return models[0]?.id ?? null
  }, [manualModelId, models, profileId, lastModelByProfile])

  // Resolved objects
  const effectiveProfile = useMemo(
    () => profiles.find(p => p.id === profileId) ?? null,
    [profiles, profileId],
  )
  const effectiveModel = useMemo(
    () => models.find(m => m.id === modelId) ?? null,
    [models, modelId],
  )

  const selection = useMemo((): ComposerSelection => ({
    profileId,
    modelId,
    thinkingEffort,
    runtimeKind,
  }), [profileId, modelId, thinkingEffort, runtimeKind])

  const setProfileId = (id: string) => {
    if (context === 'chat') return // bound, immutable
    setLastProfileId(id)
    setManualModelId(null) // reset manual model when profile changes
  }

  const setModelId = (id: string) => {
    setManualModelId(id)
    if (profileId) {
      setLastModelForProfile(profileId, id)
    }
  }

  const setThinkingEffort = (effort: ThinkingEffort) => {
    setThinkingEffortState(effort)
  }

  return {
    selection,
    setProfileId,
    setModelId,
    setThinkingEffort,
    setRuntimeKind: setRuntimeKindState,
    profiles,
    models,
    isLoadingModels,
    effectiveProfile,
    effectiveModel,
  }
}
