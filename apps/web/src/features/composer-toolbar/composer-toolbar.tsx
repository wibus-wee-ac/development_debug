import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { ClaudeAgentModelAliasesSlot } from '~/features/chat/runtime/claude-session-model-matrix-control'
import { ClaudeAgentModelAliasesButton } from '~/features/chat/runtime/claude-session-model-matrix-control'

import { AgentSelector } from './agent-selector'
import { ChatAgentIdentity } from './chat-agent-identity'
import { ProviderModelSelector, useProviderThinkingOptions } from './provider-model-selector'
import { RuntimeSelector } from './runtime-selector'
import { ThinkingEffortButton } from './thinking-effort-button'
import type { ComposerContext } from './types'
import type { ComposerStateResult } from './use-composer-state'

const AGENTS_RUNTIME_SELECTOR_VALUE = 'agents'

interface ComposerToolbarProps {
  context: ComposerContext
  state: ComposerStateResult
  claudeModelAliases?: { slot: ClaudeAgentModelAliasesSlot, providerSettingsLoading?: boolean } | null
}

export function ComposerToolbar({ context, state, claudeModelAliases }: ComposerToolbarProps) {
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

  const isClaudeAgent = selection.targetMode === 'provider'
    && selection.runtimeKind === 'claude-agent'
    && !!claudeModelAliases
  const thinkingOptions = useProviderThinkingOptions()

  const runtimeControl = (
    <RuntimeSelector
      value={runtimeSelectorValue}
      onChange={handleRuntimeChange}
      readOnly={context === 'chat'}
      options={runtimeSelectorOptions}
      occludeNativeBrowserSurface
    />
  )
  const agentIdentity = boundChatAgent ? <ChatAgentIdentity agent={boundChatAgent} /> : null
  const agentSelector = context === 'new-chat' && selection.targetMode === 'agent'
    ? (
        <AgentSelector
          agents={agents}
          selectedAgentId={selection.agentId}
          runtimeOptions={runtimeOptions}
          onSelectAgent={setAgentId}
          occludeNativeBrowserSurface
        />
      )
    : null
  const providerSelector = selection.targetMode === 'provider' && selection.runtimeKind !== 'cli-tui'
    ? (
        <ProviderModelSelector
          profiles={profiles}
          selectedProfileId={selection.profileId}
          selectedModelId={selection.modelId}
          models={models}
          modelsByProfileId={modelsByProfileId}
          loadingProfileIds={loadingProfileIds}
          thinkingEffort={selection.thinkingEffort}
          isLoadingModels={isLoadingModels}
          showThinkingInModelMenu={!isClaudeAgent}
          requestProfileModels={requestProfileModels}
          onSelectProfile={setProfileId}
          onSelectModel={setModelId}
          onSelectThinkingEffort={setThinkingEffort}
        />
      )
    : null
  const claudeAliasesControl = isClaudeAgent
    ? (
        <ClaudeAgentModelAliasesButton
          models={models}
          selectedModelId={selection.modelId}
          aliases={claudeModelAliases!.slot.aliases}
          loading={claudeModelAliases!.slot.loading}
          loadingModels={isLoadingModels || claudeModelAliases!.providerSettingsLoading}
          onChange={claudeModelAliases!.slot.onChange}
          occludeNativeBrowserSurface
        />
      )
    : null
  const thinkingControl = isClaudeAgent
    ? (
        <ThinkingEffortButton
          thinkingEffort={selection.thinkingEffort}
          thinkingOptions={thinkingOptions}
          onSelect={setThinkingEffort}
          occludeNativeBrowserSurface
        />
      )
    : null
  const targetControl = agentIdentity ?? agentSelector ?? providerSelector

  return (
    <div className="flex min-w-0 items-center gap-1">
      {runtimeControl}
      {targetControl}
      {claudeAliasesControl}
      {thinkingControl}
    </div>
  )
}
