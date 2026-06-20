import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { ClaudeMatrixMenuSlot } from './provider-model-menu'

import { AgentSelector } from './agent-selector'
import { ChatAgentIdentity } from './chat-agent-identity'
import { ProviderModelSelector } from './provider-model-selector'
import { RuntimeSelector } from './runtime-selector'
import type { ComposerContext } from './types'
import type { ComposerStateResult } from './use-composer-state'

const AGENTS_RUNTIME_SELECTOR_VALUE = 'agents'

interface ComposerToolbarProps {
  context: ComposerContext
  state: ComposerStateResult
  claudeMatrix?: ClaudeMatrixMenuSlot | null
}

export function ComposerToolbar({ context, state, claudeMatrix }: ComposerToolbarProps) {
  const {
    selection,
    setAgentId,
    setProfileId,
    setModelId,
    setThinkingEffort,
    setRuntimeKind,
    setTargetMode,
    runtimeOptions,
    agents,
    profiles,
    models,
    modelsByProfileId,
    loadingProfileIds,
    requestProfileModels,
    isLoadingModels,
  } = state
  const { t } = useTranslation('common')
  const boundChatAgent = context === 'chat' ? state.effectiveAgent : null
  const runtimeSelectorOptions = useMemo(() => {
    if (context !== 'new-chat' || !state.agentSelectionEnabled) {
      return runtimeOptions
    }
    return [
      ...runtimeOptions.filter(option => option.value !== 'cli-tui'),
      {
        value: AGENTS_RUNTIME_SELECTOR_VALUE,
        label: t('runtime.agents.label'),
        description: t('runtime.agents.description'),
        iconKey: 'agents',
      },
    ]
  }, [context, runtimeOptions, state.agentSelectionEnabled, t])
  const runtimeSelectorValue = context === 'new-chat' && selection.targetMode === 'agent'
    ? AGENTS_RUNTIME_SELECTOR_VALUE
    : selection.runtimeKind
  const handleRuntimeChange = (kind: RuntimeKind) => {
    if (kind === AGENTS_RUNTIME_SELECTOR_VALUE) {
      setTargetMode('agent')
      return
    }
    setRuntimeKind(kind)
  }

  return (
    <div className="flex items-center gap-1">
      <RuntimeSelector
        value={runtimeSelectorValue}
        onChange={handleRuntimeChange}
        readOnly={context === 'chat'}
        options={runtimeSelectorOptions}
        occludeNativeBrowserSurface
      />
      {boundChatAgent && <ChatAgentIdentity agent={boundChatAgent} />}
      {context === 'new-chat' && selection.targetMode === 'agent' && (
        <AgentSelector
          agents={agents}
          selectedAgentId={selection.agentId}
          runtimeOptions={runtimeOptions}
          onSelectAgent={setAgentId}
          occludeNativeBrowserSurface
        />
      )}
      {selection.targetMode === 'provider' && selection.runtimeKind !== 'cli-tui' && (
        <ProviderModelSelector
          profiles={profiles}
          selectedProfileId={selection.profileId}
          selectedModelId={selection.modelId}
          models={models}
          modelsByProfileId={modelsByProfileId}
          loadingProfileIds={loadingProfileIds}
          thinkingEffort={selection.thinkingEffort}
          isLoadingModels={isLoadingModels}
          requestProfileModels={requestProfileModels}
          onSelectProfile={setProfileId}
          onSelectModel={setModelId}
          onSelectThinkingEffort={setThinkingEffort}
          claudeMatrix={claudeMatrix}
        />
      )}
    </div>
  )
}
