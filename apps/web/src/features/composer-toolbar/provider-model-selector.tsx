// Input: ProviderModelPicker, selected composer runtime state
// Output: ProviderModelSelector — composer toolbar adapter for the shared provider/model picker
// Position: Composer-specific state adapter around the reusable provider/model selector core

import type { AgentProfile, ModelDescriptor } from '~/lib/types'

import { filterThinkingOptionsForModel, selectSupportedThinkingValue, THINKING_EFFORTS } from './constants'
import { ProviderModelPicker } from './provider-model-picker'
import type { ModelsByProfileId, ThinkingEffort } from './types'

interface ProviderModelSelectorProps {
  profiles: AgentProfile[]
  selectedProfileId: string | null
  selectedModelId: string | null
  models: ModelDescriptor[]
  modelsByProfileId: ModelsByProfileId
  loadingProfileIds: Set<string>
  thinkingEffort: ThinkingEffort
  isLoadingModels: boolean
  onSelectProfile: (id: string) => void
  onSelectModel: (id: string, profileId: string) => void
  onSelectThinkingEffort: (effort: ThinkingEffort) => void
}

export function ProviderModelSelector({
  profiles,
  selectedProfileId,
  selectedModelId,
  models,
  modelsByProfileId,
  loadingProfileIds,
  thinkingEffort,
  isLoadingModels,
  onSelectProfile,
  onSelectModel,
  onSelectThinkingEffort,
}: ProviderModelSelectorProps) {
  const selectedModel = models.find(model => model.id === selectedModelId) ?? null
  const selectThinkingForModel = (model: ModelDescriptor | null): ThinkingEffort =>
    selectSupportedThinkingValue(model, THINKING_EFFORTS, thinkingEffort, null)

  return (
    <ProviderModelPicker
      profiles={profiles}
      selectedProfileId={selectedProfileId}
      selectedModelId={selectedModelId}
      selectedModel={selectedModel}
      modelsByProfileId={modelsByProfileId}
      loadingProfileIds={loadingProfileIds}
      thinkingValue={thinkingEffort}
      thinkingOptions={THINKING_EFFORTS}
      isLoadingSelectedModels={isLoadingModels}
      emptyProfilesLabel="No providers available"
      getThinkingOptionsForModel={model => filterThinkingOptionsForModel(model, THINKING_EFFORTS)}
      onSelectProfile={(id) => {
        onSelectProfile(id)
        const nextModels = modelsByProfileId[id] ?? []
        onSelectThinkingEffort(selectThinkingForModel(nextModels[0] ?? null))
      }}
      onSelectModel={(id, profileId) => {
        if (id) {
          onSelectModel(id, profileId)
          const nextModel = (modelsByProfileId[profileId] ?? []).find(model => model.id === id) ?? null
          onSelectThinkingEffort(selectThinkingForModel(nextModel))
        }
      }}
      onSelectThinking={onSelectThinkingEffort}
    />
  )
}
