import { ChatAgentIdentity } from './chat-agent-identity'
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
    runtimeOptions,
    agents,
    profiles,
    models,
    modelsByProfileId,
    loadingProfileIds,
    requestProfileModels,
    isLoadingModels,
  } = state
  const boundChatAgent = context === 'chat' ? state.effectiveAgent : null

  return (
    <div className="flex items-center gap-1">
      <RuntimeSelector
        value={selection.runtimeKind}
        onChange={setRuntimeKind}
        readOnly={context === 'chat'}
        options={runtimeOptions}
        occludeNativeBrowserSurface
      />
      {boundChatAgent
        ? <ChatAgentIdentity agent={boundChatAgent} />
        : selection.runtimeKind === 'cli-tui'
          ? (
              <CliTuiAgentSelector
                agents={agents}
                selectedAgentId={selection.agentId}
                onSelectAgent={setAgentId}
                occludeNativeBrowserSurface
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
