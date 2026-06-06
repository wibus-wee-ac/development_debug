import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelDescriptor } from '~/lib/types'

import { filterThinkingOptionsForModel, selectSupportedThinkingValue, THINKING_EFFORTS } from './constants'
import type { ThinkingOption } from './provider-model-menu'
import { ProviderModelPicker } from './provider-model-picker'
import type { ModelsByProfileId, ProviderModelOption, ThinkingEffort } from './types'

type CommonKey = keyof typeof import('~/locales/default').default.common
type ThinkingOptionKey = NonNullable<ThinkingEffort>

const thinkingLabelKeys = {
  low: 'thinking.low.label',
  medium: 'thinking.medium.label',
  high: 'thinking.high.label',
  xhigh: 'thinking.xhigh.label',
} satisfies Record<ThinkingOptionKey, CommonKey>

const thinkingDescriptionKeys = {
  low: 'thinking.low.description',
  medium: 'thinking.medium.description',
  high: 'thinking.high.description',
  xhigh: 'thinking.xhigh.description',
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
  const thinkingOptions: Array<ThinkingOption<ThinkingEffort>> = useMemo(
    () => THINKING_EFFORTS.map((option) => {
      const key = option.value
      return {
        value: key,
        label: t(thinkingLabelKeys[key]),
        description: t(thinkingDescriptionKeys[key]),
      }
    }),
    [t],
  )
  const selectThinkingForModel = useCallback(
    (model: ModelDescriptor | null): ThinkingEffort =>
      selectSupportedThinkingValue(model, thinkingOptions, thinkingEffort, 'high'),
    [thinkingEffort, thinkingOptions],
  )

  // Track pending provider selection to auto-select first model after load
  const pendingProviderSelectionRef = useRef<string | null>(null)

  // Auto-select first model when a new provider's models finish loading
  useEffect(() => {
    const pendingProfileId = pendingProviderSelectionRef.current
    if (!pendingProfileId) {
      return
    }

    // Check if this provider's models have finished loading
    const isLoading = loadingProfileIds.has(pendingProfileId)
    if (isLoading) {
      return
    }

    // Clear the pending selection
    pendingProviderSelectionRef.current = null

    // Auto-select the first model if available
    const loadedModels = modelsByProfileId[pendingProfileId] ?? []
    if (loadedModels.length > 0) {
      const firstModel = loadedModels[0]
      onSelectModel(firstModel.id, pendingProfileId)
      onSelectThinkingEffort(selectThinkingForModel(firstModel))
    }
  }, [loadingProfileIds, modelsByProfileId, onSelectModel, onSelectThinkingEffort, selectThinkingForModel])

  return (
    <ProviderModelPicker
      providerTargets={profiles}
      selectedProviderTargetId={selectedProfileId}
      selectedModelId={selectedModelId}
      selectedModel={selectedModel}
      modelsByProviderTargetId={modelsByProfileId}
      loadingProviderTargetIds={loadingProfileIds}
      thinkingValue={thinkingEffort}
      thinkingOptions={thinkingOptions}
      isLoadingSelectedModels={isLoadingModels}
      emptyProviderTargetsLabel={t('model.noProviderTargets')}
      showProviderLabel
      getThinkingOptionsForModel={model => filterThinkingOptionsForModel(model, thinkingOptions)}
      onRequestProviderTargetModels={requestProfileModels}
      onSelectProviderTarget={(id) => {
        requestProfileModels(id)
        onSelectProfile(id)
        // Mark this provider as pending - will auto-select first model after load
        pendingProviderSelectionRef.current = id
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
