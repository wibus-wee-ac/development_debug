import { useTranslation } from 'react-i18next'

import type { ModelDescriptor } from '~/lib/types'

import { filterThinkingOptionsForModel, selectSupportedThinkingValue, THINKING_EFFORTS } from './constants'
import { ProviderModelPicker } from './provider-model-picker'
import type { ThinkingOption } from './provider-model-menu'
import type { ModelsByProfileId, ProviderModelOption, ThinkingEffort } from './types'

type CommonKey = keyof typeof import('~/locales/default').default.common
type ThinkingOptionKey = NonNullable<ThinkingEffort> | 'auto'

const thinkingLabelKeys = {
  auto: 'thinking.auto.label',
  low: 'thinking.low.label',
  medium: 'thinking.medium.label',
  high: 'thinking.high.label',
} satisfies Record<ThinkingOptionKey, CommonKey>

const thinkingDescriptionKeys = {
  auto: 'thinking.auto.description',
  low: 'thinking.low.description',
  medium: 'thinking.medium.description',
  high: 'thinking.high.description',
} satisfies Record<ThinkingOptionKey, CommonKey>

interface ProviderModelSelectorProps {
  profiles: ProviderModelOption[]
  selectedProfileId: string | null
  selectedModelId: string | null
  models: ModelDescriptor[]
  modelsByProfileId: ModelsByProfileId
  loadingProfileIds: Set<string>
  thinkingEffort: ThinkingEffort
  isLoadingModels: boolean
  requestProfileModels: (id: string) => void
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
  requestProfileModels,
  onSelectProfile,
  onSelectModel,
  onSelectThinkingEffort,
}: ProviderModelSelectorProps) {
  const { t } = useTranslation('common')
  const selectedModel = models.find(model => model.id === selectedModelId) ?? null
  const thinkingOptions: Array<ThinkingOption<ThinkingEffort>> = THINKING_EFFORTS.map((option) => {
    const key = option.value ?? 'auto'
    return {
      value: option.value,
      label: t(thinkingLabelKeys[key]),
      description: t(thinkingDescriptionKeys[key]),
    }
  })
  const selectThinkingForModel = (model: ModelDescriptor | null): ThinkingEffort =>
    selectSupportedThinkingValue(model, thinkingOptions, thinkingEffort, null)

  return (
    <ProviderModelPicker
      profiles={profiles}
      selectedProfileId={selectedProfileId}
      selectedModelId={selectedModelId}
      selectedModel={selectedModel}
      modelsByProfileId={modelsByProfileId}
      loadingProfileIds={loadingProfileIds}
      thinkingValue={thinkingEffort}
      thinkingOptions={thinkingOptions}
      isLoadingSelectedModels={isLoadingModels}
      emptyProfilesLabel={t('model.noProviderTargets')}
      getThinkingOptionsForModel={model => filterThinkingOptionsForModel(model, thinkingOptions)}
      onRequestProfileModels={requestProfileModels}
      onSelectProfile={(id) => {
        requestProfileModels(id)
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
