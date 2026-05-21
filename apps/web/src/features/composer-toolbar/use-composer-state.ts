import { useMemo, useState } from 'react'

import { useAgentModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { useAgents } from '~/features/agent-runtime/use-agents'
import type { Agent, AgentProfile, ModelDescriptor, RuntimeKind } from '~/lib/types'
import { useNewChatStore } from '~/store/new-chat'

import { filterThinkingOptionsForModel, THINKING_EFFORTS } from './constants'
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
  setModelId: (id: string, profileId?: string) => void
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

const EMPTY_MODELS: ModelDescriptor[] = []

export function useComposerState(config: ComposerStateConfig): ComposerStateResult {
  const { context, boundProfileId, boundRuntimeKind } = config

  // Persisted state
  const lastRuntimeKind = useNewChatStore(s => s.lastRuntimeKind)
  const setLastRuntimeKind = useNewChatStore(s => s.setLastRuntimeKind)
  const lastCliTuiAgentId = useNewChatStore(s => s.lastCliTuiAgentId)
  const setLastCliTuiAgentId = useNewChatStore(s => s.setLastCliTuiAgentId)
  const lastProfileId = useNewChatStore(s => s.lastAgentProfileId)
  const setLastProfileId = useNewChatStore(s => s.setLastAgentProfileId)
  const setLastModelForProfile = useNewChatStore(s => s.setLastModelForProfile)
  const lastModelByProfile = useNewChatStore(s => s.lastModelByProfile)
  const lastThinkingEffort = useNewChatStore(s => s.lastThinkingEffort)
  const setLastThinkingEffort = useNewChatStore(s => s.setLastThinkingEffort)

  // Data
  const { agents } = useAgents()
  const { profiles } = useAgentProfiles()

  // Local non-persisted state
  const [manualAgentId, setManualAgentId] = useState<string | null>(null)
  const [manualModelId, setManualModelId] = useState<string | null>(null)
  const [manualThinkingEffort, setManualThinkingEffort] = useState<ThinkingEffort | undefined>(undefined)
  const [manualRuntimeKind, setManualRuntimeKind] = useState<RuntimeKind | null>(null)

  const runtimeKind = useMemo(() => {
    if (context === 'chat') {
      return boundRuntimeKind ?? 'standard'
    }
    return manualRuntimeKind ?? lastRuntimeKind ?? 'standard'
  }, [context, boundRuntimeKind, manualRuntimeKind, lastRuntimeKind])

  const thinkingEffort = manualThinkingEffort === undefined ? lastThinkingEffort : manualThinkingEffort

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
    if (lastCliTuiAgentId && cliTuiAgents.some(agent => agent.id === lastCliTuiAgentId)) {
      return lastCliTuiAgentId
    }
    return cliTuiAgents[0]?.id ?? null
  }, [runtimeKind, manualAgentId, lastCliTuiAgentId, cliTuiAgents])

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
  const models = profileId ? modelsByProfileId[profileId] ?? EMPTY_MODELS : EMPTY_MODELS
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
  const effectiveThinkingEffort = useMemo((): ThinkingEffort => {
    const options = filterThinkingOptionsForModel(effectiveModel, THINKING_EFFORTS)
    return options.some(option => option.value === thinkingEffort) ? thinkingEffort : null
  }, [effectiveModel, thinkingEffort])

  const selection = useMemo((): ComposerSelection => ({
    agentId,
    profileId,
    modelId,
    thinkingEffort: runtimeKind === 'cli-tui' ? null : effectiveThinkingEffort,
    runtimeKind,
  }), [agentId, profileId, modelId, effectiveThinkingEffort, runtimeKind])

  const setAgentId = (id: string) => {
    setManualAgentId(id)
    setLastCliTuiAgentId(id)
  }

  const setProfileId = (id: string) => {
    if (context === 'chat') {
      return
    } // bound, immutable
    setLastProfileId(id)
    setManualModelId(null) // reset manual model when profile changes
  }

  const setModelId = (id: string, nextProfileId?: string) => {
    const targetProfileId = nextProfileId ?? profileId
    if (!targetProfileId) {
      return
    }
    if (context === 'chat' && targetProfileId !== profileId) {
      return
    }
    if (context !== 'chat' && targetProfileId !== profileId) {
      setLastProfileId(targetProfileId)
    }
    setManualModelId(id)
    setLastModelForProfile(targetProfileId, id)
  }

  const setThinkingEffort = (effort: ThinkingEffort) => {
    setManualThinkingEffort(effort)
    setLastThinkingEffort(effort)
  }

  const setRuntimeKind = (kind: RuntimeKind) => {
    if (context === 'chat') {
      return
    }
    setManualRuntimeKind(kind)
    setLastRuntimeKind(kind)
  }

  return {
    selection,
    setAgentId,
    setProfileId,
    setModelId,
    setThinkingEffort,
    setRuntimeKind,
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
