import { CpuIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Menu, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { ProviderIcon } from '~/features/agent-management/provider-icons'
import type { ModelDescriptor } from '~/lib/types'

import { presetForProviderKind } from '../agent-management/provider-settings-utils'
import type { ModelsByProviderTargetId, ThinkingOption } from './provider-model-menu'
import { ProviderModelMenu } from './provider-model-menu'
import type { ProviderModelOption } from './types'

interface ProviderModelPickerProps<TThinking extends string | null> {
  providerTargets: ProviderModelOption[]
  selectedProviderTargetId: string | null
  selectedModelId: string | null
  selectedModel: ModelDescriptor | null
  modelsByProviderTargetId: ModelsByProviderTargetId
  loadingProviderTargetIds: Set<string>
  thinkingValue: TThinking
  thinkingOptions: Array<ThinkingOption<TThinking>>
  isLoadingSelectedModels?: boolean
  emptyProviderTargetsLabel?: string
  loadingLabel?: string
  emptySelectionLabel?: string
  menuSide?: 'top' | 'bottom' | 'left' | 'right'
  menuAlign?: 'start' | 'center' | 'end'
  triggerTestId?: string
  disabled?: boolean
  getThinkingOptionsForModel?: (model: ModelDescriptor | null) => Array<ThinkingOption<TThinking>>
  onRequestProviderTargetModels?: (id: string) => void
  onSelectProviderTarget: (id: string) => void
  onSelectModel: (id: string | null, providerTargetId: string) => void
  onSelectThinking: (value: TThinking) => void
}

export function ProviderModelPicker<TThinking extends string | null>({
  providerTargets,
  selectedProviderTargetId,
  selectedModelId,
  selectedModel,
  modelsByProviderTargetId,
  loadingProviderTargetIds,
  thinkingValue,
  thinkingOptions,
  isLoadingSelectedModels = false,
  emptyProviderTargetsLabel,
  loadingLabel,
  emptySelectionLabel,
  menuSide = 'top',
  menuAlign = 'start',
  triggerTestId = 'provider-model-selector',
  disabled = false,
  getThinkingOptionsForModel,
  onRequestProviderTargetModels,
  onSelectProviderTarget,
  onSelectModel,
  onSelectThinking,
}: ProviderModelPickerProps<TThinking>) {
  const { t } = useTranslation('common')
  const selectedProviderTarget = providerTargets.find(target => target.id === selectedProviderTargetId) ?? null
  const effectiveLoadingProviderTargetIds = useMemo(() => {
    if (!selectedProviderTargetId || !isLoadingSelectedModels || loadingProviderTargetIds.has(selectedProviderTargetId)) {
      return loadingProviderTargetIds
    }

    const next = new Set(loadingProviderTargetIds)
    next.add(selectedProviderTargetId)
    return next
  }, [isLoadingSelectedModels, loadingProviderTargetIds, selectedProviderTargetId])

  const triggerThinkingOptions = getThinkingOptionsForModel
    ? getThinkingOptionsForModel(selectedModel)
    : thinkingOptions
  const hasAdjustableThinking = triggerThinkingOptions.some(option => option.value !== null && option.value !== 'auto')
  const thinkingLabel = hasAdjustableThinking
    ? triggerThinkingOptions.find(option => option.value === thinkingValue)?.label ?? null
    : null
  const modelLabel = selectedModel?.label
    ?? selectedModelId
    ?? (isLoadingSelectedModels ? loadingLabel ?? t('status.loading') : emptySelectionLabel ?? t('model.emptySelection'))

  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="xs" data-testid={triggerTestId} disabled={disabled} />}>
        {selectedProviderTarget
          ? <ProviderIcon iconSlug={selectedProviderTarget.iconSlug} presetId={presetForProviderKind(selectedProviderTarget.providerKind).id} className="size-3.5 shrink-0" />
          : <CpuIcon className="size-3.5 shrink-0 text-muted-foreground/70" />}
        <span className="max-w-40 truncate">
          {modelLabel}
        </span>
        {thinkingLabel && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/70">{thinkingLabel}</span>
          </>
        )}
      </MenuTrigger>
      <MenuPopup side={menuSide} align={menuAlign}>
        <ProviderModelMenu
          providerTargets={providerTargets}
          selectedProviderTargetId={selectedProviderTargetId}
          selectedModelId={selectedModelId}
          modelsByProviderTargetId={modelsByProviderTargetId}
          loadingProviderTargetIds={effectiveLoadingProviderTargetIds}
          thinkingValue={thinkingValue}
          thinkingOptions={thinkingOptions}
          getThinkingOptionsForModel={getThinkingOptionsForModel}
          emptyProviderTargetsLabel={emptyProviderTargetsLabel}
          onRequestProviderTargetModels={onRequestProviderTargetModels}
          onSelectProviderTarget={onSelectProviderTarget}
          onSelectModel={onSelectModel}
          onSelectThinking={onSelectThinking}
        />
      </MenuPopup>
    </Menu>
  )
}
