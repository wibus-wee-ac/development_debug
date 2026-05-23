import { CliTuiAgentSelector } from './cli-tui-agent-selector'
import { ProviderModelSelector } from './provider-model-selector'
import { RuntimeSelector } from './runtime-selector'
import type { ComposerContext } from './types'
import type { ComposerStateResult } from './use-composer-state'

interface ComposerToolbarProps {
  context: ComposerContext
  state: ComposerStateResult
}

export function ComposerToolbar({ context, state }: ComposerToolbarProps) {
  const {
    selection,
    setAgentId,
    setProfileId,
    setModelId,
    setThinkingEffort,
    setRuntimeKind,
    agents,
    profiles,
    models,
    modelsByProfileId,
    loadingProfileIds,
    requestProfileModels,
    isLoadingModels,
  } = state

  // In 'chat' context, only show the model selector (provider is bound)
  // In 'new-chat' and 'capsule', show both runtime and provider/model selectors
  const showRuntime = context !== 'chat'

  return (
    <div className="flex items-center gap-1">
      {showRuntime && (
        <RuntimeSelector
          value={selection.runtimeKind}
          onChange={setRuntimeKind}
        />
      )}
      {selection.runtimeKind === 'cli-tui'
        ? (
            <CliTuiAgentSelector
              agents={agents}
              selectedAgentId={selection.agentId}
              onSelectAgent={setAgentId}
            />
          )
        : (
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
            />
          )}
    </div>
  )
}
