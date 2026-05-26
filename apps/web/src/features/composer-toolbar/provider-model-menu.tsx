import { BrainIcon, CheckIcon, HammerIcon, ScanEyeIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MenuItem, MenuSub, MenuSubPopup, MenuSubTrigger } from '~/components/ui/menu'
import { ProviderIcon } from '~/features/agent-management/provider-icons'
import { cn } from '~/lib/cn'
import type { ModelDescriptor } from '~/lib/types'

import { presetForProviderKind } from '../agent-management/provider-settings-utils'
import type { ProviderModelOption } from './types'

export interface ThinkingOption<TThinking extends string | null> {
  value: TThinking
  label: string
  description: string
}

export type ModelsByProviderTargetId = Record<string, ModelDescriptor[]>

interface ProviderModelMenuProps<TThinking extends string | null> {
  providerTargets: ProviderModelOption[]
  selectedProviderTargetId: string | null
  selectedModelId: string | null
  modelsByProviderTargetId: ModelsByProviderTargetId
  loadingProviderTargetIds: Set<string>
  thinkingValue: TThinking
  thinkingOptions: Array<ThinkingOption<TThinking>>
  getThinkingOptionsForModel?: (model: ModelDescriptor | null) => Array<ThinkingOption<TThinking>>
  emptyProviderTargetsLabel?: string
  isProviderTargetSelectionDisabled?: boolean
  onRequestProviderTargetModels?: (id: string) => void
  onSelectProviderTarget: (id: string) => void
  onSelectModel: (id: string | null, providerTargetId: string) => void
  onSelectThinking: (value: TThinking) => void
}

interface ProviderTargetGroupProps<TThinking extends string | null> {
  providerTarget: ProviderModelOption
  isActive: boolean
  models: ModelDescriptor[]
  selectedModelId: string | null
  thinkingValue: TThinking
  getThinkingOptionsForModel: (model: ModelDescriptor | null) => Array<ThinkingOption<TThinking>>
  isLoadingModels: boolean
  isProviderTargetSelectionDisabled: boolean
  onRequestProviderTargetModels?: (id: string) => void
  onSelectProviderTarget: (id: string) => void
  onSelectModel: (id: string | null, providerTargetId: string) => void
  onSelectThinking: (value: TThinking) => void
}

interface CurrentProviderModelListProps<TThinking extends string | null> {
  models: ModelDescriptor[]
  selectedModelId: string | null
  thinkingValue: TThinking
  getThinkingOptionsForModel: (model: ModelDescriptor | null) => Array<ThinkingOption<TThinking>>
  isLoadingModels: boolean
  leadingContent?: ReactNode
  onSelectModel: (id: string) => void
  onSelectThinking: (value: TThinking) => void
}

const INITIAL_BATCH = 20

function occurrenceKey(id: string, counts: Map<string, number>): string {
  const count = counts.get(id) ?? 0
  counts.set(id, count + 1)
  return `${id}:${count}`
}

// eslint-disable-next-line react-refresh/only-export-components
export function filterModelsBySearch(models: ModelDescriptor[], search: string): ModelDescriptor[] {
  const normalizedSearch = search.trim().toLowerCase()
  if (!normalizedSearch) {
    return models
  }

  return models.filter(model =>
    model.label.toLowerCase().includes(normalizedSearch)
    || model.id.toLowerCase().includes(normalizedSearch))
}

export function CurrentProviderModelList<TThinking extends string | null>({
  models,
  selectedModelId,
  thinkingValue,
  getThinkingOptionsForModel,
  isLoadingModels,
  leadingContent,
  onSelectModel,
  onSelectThinking,
}: CurrentProviderModelListProps<TThinking>) {
  const { t } = useTranslation('common')
  const [modelSearch, setModelSearch] = useState('')
  const filteredModels = filterModelsBySearch(models, modelSearch)

  const [renderCount, setRenderCount] = useState(INITIAL_BATCH)

  useEffect(() => {
    if (filteredModels.length <= INITIAL_BATCH) {
      return
    }
    const id = requestAnimationFrame(() => {
      setRenderCount(filteredModels.length)
    })
    return () => cancelAnimationFrame(id)
  }, [filteredModels.length])

  useEffect(() => {
    setRenderCount(INITIAL_BATCH)
  }, [modelSearch])

  const visibleModels = filteredModels.slice(0, renderCount)
  const modelKeyCounts = new Map<string, number>()

  return (
    <>
      {models.length > 0 && (
        <div className="px-1 pt-1 pb-1.5">
          <input
            value={modelSearch}
            onChange={event => setModelSearch(event.target.value)}
            placeholder={t('model.searchPlaceholder')}
            className="w-full rounded-md border border-border/50 bg-input/30 px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-border"
            onClick={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
          />
        </div>
      )}
      {leadingContent}
      {isLoadingModels && models.length === 0 && (
        <MenuItem disabled>{t('status.loading')}</MenuItem>
      )}
      <div className="max-h-80 overflow-y-auto">
        {visibleModels.map((model) => {
          const isModelSelected = model.id === selectedModelId
          return (
            <ModelSubmenu
              key={occurrenceKey(model.id, modelKeyCounts)}
              model={model}
              isModelSelected={isModelSelected}
              thinkingValue={thinkingValue}
              thinkingOptions={getThinkingOptionsForModel(model)}
              onSelectModel={() => onSelectModel(model.id)}
              onSelectThinking={onSelectThinking}
            />
          )
        })}
      </div>
      {renderCount < filteredModels.length && (
        <MenuItem disabled>{t('status.loading')}</MenuItem>
      )}
      {filteredModels.length === 0 && models.length > 0 && (
        <MenuItem disabled>{t('model.noMatchingModels')}</MenuItem>
      )}
      {models.length === 0 && !isLoadingModels && (
        <MenuItem disabled>{t('model.noModelsAvailable')}</MenuItem>
      )}
    </>
  )
}

function ProviderTargetGroup<TThinking extends string | null>({
  providerTarget,
  isActive,
  models,
  selectedModelId,
  thinkingValue,
  getThinkingOptionsForModel,
  isLoadingModels,
  isProviderTargetSelectionDisabled,
  onRequestProviderTargetModels,
  onSelectProviderTarget,
  onSelectModel,
  onSelectThinking,
}: ProviderTargetGroupProps<TThinking>) {
  const preset = presetForProviderKind(providerTarget.providerKind)

  return (
    <MenuSub onOpenChange={open => open && onRequestProviderTargetModels?.(providerTarget.id)}>
      <MenuSubTrigger
        onClick={() => {
          onRequestProviderTargetModels?.(providerTarget.id)
          if (!isProviderTargetSelectionDisabled) {
            onSelectProviderTarget(providerTarget.id)
          }
        }}
        onFocus={() => onRequestProviderTargetModels?.(providerTarget.id)}
        onPointerEnter={() => onRequestProviderTargetModels?.(providerTarget.id)}
        className={cn(isActive && 'font-medium')}
      >
        <CheckIcon className={cn('size-3.5 shrink-0', isActive ? 'text-primary' : 'text-transparent')} />
        <ProviderIcon iconSlug={providerTarget.iconSlug} presetId={preset.id} className="size-3.5 shrink-0" />
        <span>{providerTarget.name}</span>
      </MenuSubTrigger>
      <MenuSubPopup>
        <CurrentProviderModelList
          models={models}
          selectedModelId={selectedModelId}
          thinkingValue={thinkingValue}
          getThinkingOptionsForModel={getThinkingOptionsForModel}
          isLoadingModels={isLoadingModels}
          onSelectModel={modelId => onSelectModel(modelId, providerTarget.id)}
          onSelectThinking={onSelectThinking}
        />
      </MenuSubPopup>
    </MenuSub>
  )
}

function ModelSubmenu<TThinking extends string | null>({
  model,
  description,
  isModelSelected,
  thinkingValue,
  thinkingOptions,
  onSelectModel,
  onSelectThinking,
}: {
  model: ModelDescriptor
  description?: string
  isModelSelected: boolean
  thinkingValue: TThinking
  thinkingOptions: Array<ThinkingOption<TThinking>>
  onSelectModel: () => void
  onSelectThinking: (value: TThinking) => void
}) {
  const { t } = useTranslation('common')
  const caps = model.capabilities
  const registryMatch = caps?.registryMatch
  const ctxK = caps?.contextWindow
    ? caps.contextWindow >= 1000000
      ? `${Math.round(caps.contextWindow / 1000000)}M`
      : `${Math.round(caps.contextWindow / 1000)}K`
    : null
  const hasAdjustableThinking = thinkingOptions.some(option => option.value !== null && option.value !== 'auto')
  const content = (
    <>
      <CheckIcon className={cn('size-3.5 shrink-0 self-start mt-0.5', isModelSelected ? 'text-primary' : 'text-transparent')} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{model.label}</span>
          {registryMatch === 'fuzzy' && (
            <span className="shrink-0 text-[9px] text-muted-foreground/50" title={t('model.fuzzyMatchTitle')}>≈</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 leading-tight">
          <span className="max-w-35 truncate">{description ?? model.id}</span>
          {ctxK && (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{ctxK}</span>
            </>
          )}
          {(caps?.reasoning || caps?.inputModalities?.includes('image') || caps?.toolCall) && (
            <>
              <span className="shrink-0">·</span>
              <span className="flex items-center gap-1 shrink-0">
                {caps?.reasoning && <BrainIcon className="size-2.5" />}
                {caps?.inputModalities?.includes('image') && <ScanEyeIcon className="size-2.5" />}
                {caps?.toolCall && <HammerIcon className="size-2.5" />}
              </span>
            </>
          )}
        </div>
      </div>
    </>
  )

  if (!hasAdjustableThinking) {
    return (
      <MenuItem
        onClick={onSelectModel}
        className={cn('items-start', isModelSelected && 'text-primary font-medium')}
      >
        {content}
      </MenuItem>
    )
  }

  return (
    <MenuSub>
      <MenuSubTrigger
        onClick={onSelectModel}
        className={cn(isModelSelected && 'text-primary font-medium')}
      >
        {content}
      </MenuSubTrigger>
      <MenuSubPopup>
        {thinkingOptions.map(option => (
          <MenuItem
            key={option.value ?? 'auto'}
            onClick={() => onSelectThinking(option.value)}
            className={cn('flex-col items-start', thinkingValue === option.value && 'text-primary font-medium')}
          >
            <div className="flex w-full items-center gap-2">
              <span className="font-medium">{option.label}</span>
              <CheckIcon className={cn('ml-auto size-3.5 shrink-0', thinkingValue === option.value ? 'text-primary' : 'text-transparent')} />
            </div>
            <span className="text-[11px] text-muted-foreground/60">{option.description}</span>
          </MenuItem>
        ))}
      </MenuSubPopup>
    </MenuSub>
  )
}

export function ProviderModelMenu<TThinking extends string | null>({
  providerTargets,
  selectedProviderTargetId,
  selectedModelId,
  modelsByProviderTargetId,
  loadingProviderTargetIds,
  thinkingValue,
  thinkingOptions,
  getThinkingOptionsForModel,
  emptyProviderTargetsLabel,
  isProviderTargetSelectionDisabled = false,
  onRequestProviderTargetModels,
  onSelectProviderTarget,
  onSelectModel,
  onSelectThinking,
}: ProviderModelMenuProps<TThinking>) {
  const { t } = useTranslation('common')
  const resolveThinkingOptions = getThinkingOptionsForModel ?? (() => thinkingOptions)

  return (
    <>
      {providerTargets.map(providerTarget => (
        <ProviderTargetGroup
          key={providerTarget.id}
          providerTarget={providerTarget}
          isActive={providerTarget.id === selectedProviderTargetId}
          models={modelsByProviderTargetId[providerTarget.id] ?? []}
          selectedModelId={providerTarget.id === selectedProviderTargetId ? selectedModelId : null}
          thinkingValue={thinkingValue}
          getThinkingOptionsForModel={resolveThinkingOptions}
          isLoadingModels={loadingProviderTargetIds.has(providerTarget.id)}
          isProviderTargetSelectionDisabled={isProviderTargetSelectionDisabled}
          onRequestProviderTargetModels={onRequestProviderTargetModels}
          onSelectProviderTarget={onSelectProviderTarget}
          onSelectModel={onSelectModel}
          onSelectThinking={onSelectThinking}
        />
      ))}
      {providerTargets.length === 0 && (
        <MenuItem disabled>{emptyProviderTargetsLabel ?? t('model.noProviderTargets')}</MenuItem>
      )}
    </>
  )
}
