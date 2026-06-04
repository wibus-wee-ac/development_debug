import { useMemo, useState } from 'react'

import { useProviderTargetModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { listRuntimeCatalogForSurface, useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import type { Agent, ModelDescriptor, RuntimeKind } from '~/lib/types'
import { useNewChatStore } from '~/store/new-chat'

import { listSelectableComposerProfiles, pickComposerProfileId } from './composer-profile-selection'
import { filterThinkingOptionsForModel, THINKING_EFFORTS } from './constants'
import type { RuntimeKindOption } from './constants'
import type { ComposerContext, ComposerSelection, ModelsByProfileId, ProviderModelOption, ThinkingEffort } from './types'

interface ComposerStateConfig {
  context: ComposerContext
  /** For 'chat' context — the session's bound agent identity */
  boundAgentId?: string | null
  /** For 'chat' context — the session's bound provider target */
  boundProviderTargetId?: string
  /** For 'chat' context — the session's bound requested model */
  boundModelId?: string | null
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
  runtimeOptions: RuntimeKindOption[]
  agents: Agent[]
  profiles: ProviderModelOption[]
  models: ModelDescriptor[]
  modelsByProfileId: ModelsByProfileId
  loadingProfileIds: Set<string>
  requestProfileModels: (id: string) => void
  isLoadingAgents: boolean
  isLoadingModels: boolean
  isLoadingProfiles: boolean
  effectiveAgent: Agent | null
  effectiveProfile: ProviderModelOption | null
  effectiveModel: ModelDescriptor | null
}

const EMPTY_MODELS: ModelDescriptor[] = []

export function useComposerState(config: ComposerStateConfig): ComposerStateResult {
  const { context, boundAgentId, boundProviderTargetId, boundModelId, boundRuntimeKind } = config

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
  const { agents, isLoading: isLoadingAgents } = useAgents()
  const { providerOptions, isLoading: isLoadingProviders } = useProviderTargets()
  const { runtimes } = useRuntimeCatalog()

  // Local non-persisted state
  const [manualAgentId, setManualAgentId] = useState<string | null>(null)
  const [manualProfileId, setManualProfileId] = useState<string | null>(null)
  const [manualModelId, setManualModelId] = useState<string | null>(null)
  const [manualThinkingEffort, setManualThinkingEffort] = useState<ThinkingEffort | undefined>(undefined)
  const [manualRuntimeKind, setManualRuntimeKind] = useState<RuntimeKind | null>(null)

  const runtimeOptions = useMemo<RuntimeKindOption[]>(
    () => listRuntimeCatalogForSurface(runtimes, 'chat').map(runtime => ({
      value: runtime.runtimeKind,
      label: runtime.label,
      description: runtime.description,
      iconKey: runtime.iconKey,
    })),
    [runtimes],
  )

  const runtimeKind = useMemo(() => {
    if (context === 'chat') {
      return boundRuntimeKind ?? 'standard'
    }
    const fallbackRuntimeKind = runtimeOptions.find(option => option.value === 'standard')?.value
      ?? runtimeOptions[0]?.value
      ?? 'standard'
    const candidate = manualRuntimeKind ?? lastRuntimeKind ?? fallbackRuntimeKind
    return runtimeOptions.some(option => option.value === candidate) ? candidate : fallbackRuntimeKind
  }, [context, boundRuntimeKind, manualRuntimeKind, lastRuntimeKind, runtimeOptions])
  const selectableProfiles = useMemo(
    () => listSelectableComposerProfiles({ profiles: providerOptions, runtimeKind, runtimes }),
    [providerOptions, runtimeKind, runtimes],
  )

  const thinkingEffort = manualThinkingEffort === undefined ? lastThinkingEffort : manualThinkingEffort

  const cliTuiAgents = useMemo(
    () => agents.filter(agent => agent.enabled && agent.runtimeKind === 'cli-tui'),
    [agents],
  )
  const boundAgent = useMemo(() => {
    if (context !== 'chat' || !boundAgentId) {
      return null
    }
    return agents.find(agent => agent.id === boundAgentId && agent.enabled) ?? null
  }, [agents, boundAgentId, context])

  const agentId = useMemo(() => {
    if (context === 'chat' && boundAgent?.runtimeKind === runtimeKind) {
      return boundAgent.id
    }
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
  }, [runtimeKind, context, boundAgent, manualAgentId, lastCliTuiAgentId, cliTuiAgents])

  // Resolve effective profile
  const profileId = useMemo(() => {
    if (runtimeKind === 'cli-tui') {
      return null
    }
    if (manualProfileId && selectableProfiles.some(p => p.id === manualProfileId)) {
      return manualProfileId
    }
    if (context === 'chat' && boundAgent?.providerTargetId) {
      return boundAgent.providerTargetId
    }
    if (context === 'chat') {
      return boundProviderTargetId ?? null
    }
    return pickComposerProfileId({ profiles: selectableProfiles, lastProfileId })
  }, [runtimeKind, manualProfileId, context, boundAgent, boundProviderTargetId, lastProfileId, selectableProfiles])

  const initialModelProfileIds = useMemo(() => [profileId], [profileId])
  const {
    modelsByProviderTargetId,
    loadingProviderTargetIds,
    requestProviderTargetModels,
  } = useProviderTargetModelMap(selectableProfiles, initialModelProfileIds)
  const modelsByProfileId = modelsByProviderTargetId
  const loadingProfileIds = loadingProviderTargetIds
  const requestProfileModels = requestProviderTargetModels
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
    if (context === 'chat') {
      if (boundAgent?.modelId) {
        return boundAgent.modelId
      }
      if (boundModelId && models.some(m => m.id === boundModelId)) {
        return boundModelId
      }
      if (boundModelId) {
        return boundModelId
      }
      return models[0]?.id ?? null
    }
    const persisted = profileId ? lastModelByProfile[profileId] : undefined
    if (persisted && models.some(m => m.id === persisted)) {
      return persisted
    }
    return models[0]?.id ?? null
  }, [runtimeKind, manualModelId, models, context, boundModelId, boundAgent, profileId, lastModelByProfile])

  const effectiveAgent = useMemo(
    () => boundAgent?.id === agentId
      ? boundAgent
      : cliTuiAgents.find(agent => agent.id === agentId) ?? null,
    [boundAgent, cliTuiAgents, agentId],
  )

  // Resolved objects
  const effectiveProfile = useMemo(
    () => selectableProfiles.find(p => p.id === profileId) ?? null,
    [selectableProfiles, profileId],
  )
  const effectiveModel = useMemo(
    () => models.find(m => m.id === modelId) ?? null,
    [models, modelId],
  )
  const effectiveThinkingEffort = useMemo((): ThinkingEffort => {
    if (context === 'chat' && boundAgent?.thinkingEffort && boundAgent.thinkingEffort !== 'auto') {
      return boundAgent.thinkingEffort
    }
    const options = filterThinkingOptionsForModel(effectiveModel, THINKING_EFFORTS)
    return options.some(option => option.value === thinkingEffort) ? thinkingEffort : null
  }, [boundAgent, context, effectiveModel, thinkingEffort])

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
    if (!selectableProfiles.some(profile => profile.id === id)) {
      return
    }
    setManualProfileId(id)
    if (context !== 'chat') {
      setLastProfileId(id)
    }
    setManualModelId(null) // reset manual model when profile changes
  }

  const setModelId = (id: string, nextProfileId?: string) => {
    const targetProfileId = nextProfileId ?? profileId
    if (!targetProfileId) {
      return
    }
    if (!selectableProfiles.some(profile => profile.id === targetProfileId)) {
      return
    }
    if (targetProfileId !== profileId) {
      setManualProfileId(targetProfileId)
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
    runtimeOptions,
    agents: cliTuiAgents,
    profiles: selectableProfiles,
    models,
    modelsByProfileId,
    loadingProfileIds,
    requestProfileModels,
    isLoadingAgents,
    isLoadingModels,
    isLoadingProfiles: isLoadingProviders,
    effectiveAgent,
    effectiveProfile,
    effectiveModel,
  }
}
