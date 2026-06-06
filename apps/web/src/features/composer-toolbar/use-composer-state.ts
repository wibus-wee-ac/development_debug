import { useCallback, useEffect, useMemo, useState } from 'react'

import { useProviderTargetModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgents } from '~/features/agent-runtime/use-agents'
import type { Agent } from '~/features/agent-runtime/use-agents'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { listRuntimeCatalogForSurface, useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import type { ModelDescriptor, RuntimeKind } from '~/lib/types'
import { useNewChatStore } from '~/store/new-chat'

import { listSelectableComposerProfiles, pickComposerProfileId } from './composer-profile-selection'
import { filterThinkingOptionsForModel, THINKING_EFFORTS } from './constants'
import type { RuntimeKindOption } from './constants'
import type { ThinkingOption } from './provider-model-menu'
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
  /** For 'chat' context — clears local manual overrides when the owning session changes */
  resetKey?: string
}

export interface ComposerStateResult {
  selection: ComposerSelection
  setAgentId: (id: string) => void
  setProfileId: (id: string) => void
  setModelId: (id: string, profileId?: string) => void
  setThinkingEffort: (effort: ThinkingEffort) => void
  setRuntimeKind: (kind: RuntimeKind) => void
  resetManualSelection: () => void
  runtimeOptions: RuntimeKindOption[]
  agents: Agent[]
  profiles: ProviderModelOption[]
  models: ModelDescriptor[]
  modelsByProfileId: ModelsByProfileId
  loadingProfileIds: Set<string>
  successfulProfileIds: Set<string>
  requestProfileModels: (id: string) => void
  isLoadingAgents: boolean
  isLoadingModels: boolean
  isLoadingProfiles: boolean
  effectiveAgent: Agent | null
  effectiveProfile: ProviderModelOption | null
  effectiveModel: ModelDescriptor | null
}

const EMPTY_MODELS: ModelDescriptor[] = []

function readChatThinkingEffort(value: Agent['thinkingEffort'] | ThinkingEffort | null | undefined): ThinkingEffort {
  switch (value) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value
    default:
      return null
  }
}

export function resolveChatModelId(input: {
  boundAgentModelId: string | null | undefined
  boundAgentProviderTargetId: string | null | undefined
  boundModelId: string | null | undefined
  boundProviderTargetId: string | null | undefined
  manualProfileId: string | null
  models: ModelDescriptor[]
}): string | null {
  const {
    boundAgentModelId,
    boundAgentProviderTargetId,
    boundModelId,
    boundProviderTargetId,
    manualProfileId,
    models,
  } = input
  const canUseBoundAgentModel = !manualProfileId || manualProfileId === boundAgentProviderTargetId
  const canUseBoundSessionModel = !manualProfileId || manualProfileId === boundProviderTargetId

  if (canUseBoundAgentModel && boundAgentModelId && models.some(model => model.id === boundAgentModelId)) {
    return boundAgentModelId
  }
  if (canUseBoundSessionModel && boundModelId && models.some(model => model.id === boundModelId)) {
    return boundModelId
  }
  if (canUseBoundSessionModel && boundModelId) {
    return boundModelId
  }
  return models[0]?.id ?? null
}

export function selectChatThinkingEffort(input: {
  effectiveModel: ModelDescriptor | null
  preferredThinkingEffort: ThinkingEffort
  thinkingOptions?: Array<ThinkingOption<ThinkingEffort>>
}): ThinkingEffort {
  const thinkingOptions = input.thinkingOptions ?? THINKING_EFFORTS
  const supportedOptions = filterThinkingOptionsForModel(input.effectiveModel, thinkingOptions)
  if (supportedOptions.some(option => option.value === input.preferredThinkingEffort)) {
    return input.preferredThinkingEffort
  }
  return supportedOptions.some(option => option.value === 'high') ? 'high' : null
}

export function useComposerState(config: ComposerStateConfig): ComposerStateResult {
  const { context, boundAgentId, boundProviderTargetId, boundModelId, boundRuntimeKind, resetKey } = config

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
  const [manualSelectionResetKey, setManualSelectionResetKey] = useState<string | undefined>(resetKey)

  const resetManualSelection = useCallback(() => {
    setManualAgentId(null)
    setManualProfileId(null)
    setManualModelId(null)
    setManualThinkingEffort(undefined)
    setManualRuntimeKind(null)
    setManualSelectionResetKey(resetKey)
  }, [resetKey])

  useEffect(() => {
    if (context !== 'chat') {
      return
    }
    resetManualSelection()
  }, [context, resetKey, resetManualSelection])
  const canUseManualSelection = context !== 'chat' || manualSelectionResetKey === resetKey
  const effectiveManualAgentId = canUseManualSelection ? manualAgentId : null
  const effectiveManualProfileId = canUseManualSelection ? manualProfileId : null
  const effectiveManualModelId = canUseManualSelection ? manualModelId : null
  const effectiveManualThinkingEffort = canUseManualSelection ? manualThinkingEffort : undefined
  const effectiveManualRuntimeKind = canUseManualSelection ? manualRuntimeKind : null

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
      return boundRuntimeKind ?? 'codex'
    }
    const fallbackRuntimeKind = runtimeOptions[0]?.value ?? 'codex'
    const candidate = effectiveManualRuntimeKind ?? lastRuntimeKind ?? fallbackRuntimeKind
    return runtimeOptions.some(option => option.value === candidate) ? candidate : fallbackRuntimeKind
  }, [context, boundRuntimeKind, effectiveManualRuntimeKind, lastRuntimeKind, runtimeOptions])
  const selectableProfiles = useMemo(
    () => listSelectableComposerProfiles({ profiles: providerOptions, runtimeKind, runtimes }),
    [providerOptions, runtimeKind, runtimes],
  )

  const thinkingEffort = effectiveManualThinkingEffort === undefined
    ? readChatThinkingEffort(lastThinkingEffort)
    : effectiveManualThinkingEffort

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
    if (effectiveManualAgentId && cliTuiAgents.some(agent => agent.id === effectiveManualAgentId)) {
      return effectiveManualAgentId
    }
    if (lastCliTuiAgentId && cliTuiAgents.some(agent => agent.id === lastCliTuiAgentId)) {
      return lastCliTuiAgentId
    }
    return cliTuiAgents[0]?.id ?? null
  }, [runtimeKind, context, boundAgent, effectiveManualAgentId, lastCliTuiAgentId, cliTuiAgents])

  // Resolve effective profile
  const profileId = useMemo(() => {
    if (runtimeKind === 'cli-tui') {
      return null
    }
    if (effectiveManualProfileId && selectableProfiles.some(p => p.id === effectiveManualProfileId)) {
      return effectiveManualProfileId
    }
    if (context === 'chat' && boundAgent?.providerTargetId) {
      return boundAgent.providerTargetId
    }
    if (context === 'chat') {
      return boundProviderTargetId ?? null
    }
    return pickComposerProfileId({ profiles: selectableProfiles, lastProfileId })
  }, [runtimeKind, effectiveManualProfileId, context, boundAgent, boundProviderTargetId, lastProfileId, selectableProfiles])

  const initialModelProfileIds = useMemo(() => [profileId], [profileId])
  const {
    modelsByProviderTargetId,
    loadingProviderTargetIds,
    successfulProviderTargetIds,
    requestProviderTargetModels,
  } = useProviderTargetModelMap(selectableProfiles, initialModelProfileIds)
  const modelsByProfileId = modelsByProviderTargetId
  const loadingProfileIds = loadingProviderTargetIds
  const successfulProfileIds = successfulProviderTargetIds
  const requestProfileModels = requestProviderTargetModels
  const models = profileId ? modelsByProfileId[profileId] ?? EMPTY_MODELS : EMPTY_MODELS
  const isLoadingModels = profileId ? loadingProfileIds.has(profileId) : false

  // Resolve effective model
  const modelId = useMemo(() => {
    if (runtimeKind === 'cli-tui') {
      return null
    }
    if (effectiveManualModelId && models.some(m => m.id === effectiveManualModelId)) {
      return effectiveManualModelId
    }
    if (context === 'chat') {
      return resolveChatModelId({
        boundAgentModelId: boundAgent?.modelId,
        boundAgentProviderTargetId: boundAgent?.providerTargetId,
        boundModelId,
        boundProviderTargetId,
        manualProfileId: effectiveManualProfileId,
        models,
      })
    }
    const persisted = profileId ? lastModelByProfile[profileId] : undefined
    if (persisted && models.some(m => m.id === persisted)) {
      return persisted
    }
    return models[0]?.id ?? null
  }, [runtimeKind, effectiveManualModelId, models, context, boundModelId, boundAgent, effectiveManualProfileId, boundProviderTargetId, profileId, lastModelByProfile])

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
    const preferredThinkingEffort = context === 'chat' && boundAgent?.thinkingEffort
      ? readChatThinkingEffort(boundAgent.thinkingEffort)
      : thinkingEffort
    return selectChatThinkingEffort({
      effectiveModel,
      preferredThinkingEffort,
    })
  }, [boundAgent, context, effectiveModel, thinkingEffort])

  const selection = useMemo((): ComposerSelection => ({
    agentId,
    profileId,
    modelId,
    thinkingEffort: runtimeKind === 'cli-tui' ? null : effectiveThinkingEffort,
    runtimeKind,
  }), [agentId, profileId, modelId, effectiveThinkingEffort, runtimeKind])

  const setAgentId = (id: string) => {
    setManualSelectionResetKey(resetKey)
    setManualAgentId(id)
    setLastCliTuiAgentId(id)
  }

  const setProfileId = (id: string) => {
    if (!selectableProfiles.some(profile => profile.id === id)) {
      return
    }
    setManualSelectionResetKey(resetKey)
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
    setManualSelectionResetKey(resetKey)
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
    setManualSelectionResetKey(resetKey)
    setManualThinkingEffort(effort)
    setLastThinkingEffort(effort)
  }

  const setRuntimeKind = (kind: RuntimeKind) => {
    if (context === 'chat') {
      return
    }
    setManualSelectionResetKey(resetKey)
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
    resetManualSelection,
    runtimeOptions,
    agents: cliTuiAgents,
    profiles: selectableProfiles,
    models,
    modelsByProfileId,
    loadingProfileIds,
    successfulProfileIds,
    requestProfileModels,
    isLoadingAgents,
    isLoadingModels,
    isLoadingProfiles: isLoadingProviders,
    effectiveAgent,
    effectiveProfile,
    effectiveModel,
  }
}
