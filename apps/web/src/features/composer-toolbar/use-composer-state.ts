// Input: useNewChatStore, useAgentProfiles, useAgentModels, useAgents, ComposerContext
// Output: useComposerState — unified state hook for all composer contexts
// Position: Replaces duplicated useReducer logic across NewChat and Capsule composers

import { useMemo, useState } from 'react'

import { useAgentModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { useAgents } from '~/features/agent-runtime/use-agents'
import type { Agent, AgentProfile, ModelDescriptor, RuntimeKind } from '~/lib/types'
import { useNewChatStore } from '~/store/new-chat'

import type { ComposerContext, ComposerSelection, ModelsByProfileId, ThinkingEffort } from './types'

interface ComposerStateConfig {
  context: ComposerContext
  /** For 'chat' context — the session's bound profile */
  boundProfileId?: string
  /** For 'chat' context — the session's runtime kind */
  boundRuntimeKind?: RuntimeKind
}

export interface ComposerStateResult {
  selection: ComposerSelection
  setAgentId: (id: string) => void
  setProfileId: (id: string) => void
  setModelId: (id: string) => void
  setThinkingEffort: (effort: ThinkingEffort) => void
  setRuntimeKind: (kind: RuntimeKind) => void
  agents: Agent[]
  profiles: AgentProfile[]
  models: ModelDescriptor[]
  modelsByProfileId: ModelsByProfileId
  loadingProfileIds: Set<string>
  isLoadingModels: boolean
  effectiveAgent: Agent | null
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
  const { agents } = useAgents()
  const { profiles } = useAgentProfiles()

  // Local non-persisted state
  const [manualAgentId, setManualAgentId] = useState<string | null>(null)
  const [manualModelId, setManualModelId] = useState<string | null>(null)
  const [thinkingEffort, setThinkingEffortState] = useState<ThinkingEffort>(null)
  const [runtimeKind, setRuntimeKindState] = useState<RuntimeKind>(boundRuntimeKind ?? 'standard')

  const cliTuiAgents = useMemo(
    () => agents.filter(agent => agent.enabled && agent.runtimeKind === 'cli-tui'),
    [agents],
  )

  const agentId = useMemo(() => {
    if (runtimeKind !== 'cli-tui') {
      return null
    }
    if (manualAgentId && cliTuiAgents.some(agent => agent.id === manualAgentId)) {
      return manualAgentId
    }
    return cliTuiAgents[0]?.id ?? null
  }, [runtimeKind, manualAgentId, cliTuiAgents])

  // Resolve effective profile
  const profileId = useMemo(() => {
    if (runtimeKind === 'cli-tui') {
      return null
    }
    if (context === 'chat') {
      return boundProfileId ?? null
    }
    const persisted = lastProfileId && profiles.some(p => p.id === lastProfileId) ? lastProfileId : null
    return persisted ?? profiles[0]?.id ?? null
  }, [runtimeKind, context, boundProfileId, lastProfileId, profiles])

  const { modelsByProfileId, loadingProfileIds } = useAgentModelMap(profiles)
  const models = profileId ? modelsByProfileId[profileId] ?? [] : []
  const isLoadingModels = profileId ? loadingProfileIds.has(profileId) : false

  // Resolve effective model
  const modelId = useMemo(() => {
    if (runtimeKind === 'cli-tui') {
      return null
    }
    if (manualModelId && models.some(m => m.id === manualModelId)) {
      return manualModelId
    }
    const persisted = profileId ? lastModelByProfile[profileId] : undefined
    if (persisted && models.some(m => m.id === persisted)) {
      return persisted
    }
    return models[0]?.id ?? null
  }, [runtimeKind, manualModelId, models, profileId, lastModelByProfile])

  const effectiveAgent = useMemo(
    () => cliTuiAgents.find(agent => agent.id === agentId) ?? null,
    [cliTuiAgents, agentId],
  )

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
    agentId,
    profileId,
    modelId,
    thinkingEffort: runtimeKind === 'cli-tui' ? null : thinkingEffort,
    runtimeKind,
  }), [agentId, profileId, modelId, thinkingEffort, runtimeKind])

  const setAgentId = (id: string) => {
    setManualAgentId(id)
  }

  const setProfileId = (id: string) => {
    if (context === 'chat') {
      return
    } // bound, immutable
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
    setAgentId,
    setProfileId,
    setModelId,
    setThinkingEffort,
    setRuntimeKind: setRuntimeKindState,
    agents: cliTuiAgents,
    profiles,
    models,
    modelsByProfileId,
    loadingProfileIds,
    isLoadingModels,
    effectiveAgent,
    effectiveProfile,
    effectiveModel,
  }
}
