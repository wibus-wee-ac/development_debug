// Input: ProviderModelMenu, selected provider/model/thinking state
// Output: ProviderModelPicker — unified trigger and cascading menu for model selection surfaces
// Position: Shared picker used by composer toolbar and Jarvis settings

import { CpuIcon } from 'lucide-react'
import { useMemo } from 'react'

import { Button } from '~/components/ui/button'
import { Menu, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { presetForProfile } from '~/features/agent-management/agent-runtime-settings'
import { ProviderIcon } from '~/features/agent-management/provider-icons'
import type { AgentProfile, ModelDescriptor } from '~/lib/types'

import { ProviderModelMenu, type ThinkingOption } from './provider-model-menu'
import type { ModelsByProfileId } from './types'

interface ProviderModelPickerProps<TThinking extends string | null> {
  profiles: AgentProfile[]
  selectedProfileId: string | null
  selectedModelId: string | null
  selectedModel: ModelDescriptor | null
  modelsByProfileId: ModelsByProfileId
  loadingProfileIds: Set<string>
  thinkingValue: TThinking
  thinkingOptions: Array<ThinkingOption<TThinking>>
  isLoadingSelectedModels?: boolean
  emptyProfilesLabel?: string
  loadingLabel?: string
  emptySelectionLabel?: string
  menuSide?: 'top' | 'bottom' | 'left' | 'right'
  menuAlign?: 'start' | 'center' | 'end'
  triggerTestId?: string
  disabled?: boolean
  getThinkingOptionsForModel?: (model: ModelDescriptor | null) => Array<ThinkingOption<TThinking>>
  onSelectProfile: (id: string) => void
  onSelectModel: (id: string | null, profileId: string) => void
  onSelectThinking: (value: TThinking) => void
}

export function ProviderModelPicker<TThinking extends string | null>({
  profiles,
  selectedProfileId,
  selectedModelId,
  selectedModel,
  modelsByProfileId,
  loadingProfileIds,
  thinkingValue,
  thinkingOptions,
  isLoadingSelectedModels = false,
  emptyProfilesLabel,
  loadingLabel = 'Loading…',
  emptySelectionLabel = 'Model',
  menuSide = 'top',
  menuAlign = 'start',
  triggerTestId = 'provider-model-selector',
  disabled = false,
  getThinkingOptionsForModel,
  onSelectProfile,
  onSelectModel,
  onSelectThinking,
}: ProviderModelPickerProps<TThinking>) {
  const selectedProfile = profiles.find(profile => profile.id === selectedProfileId) ?? null
  const effectiveLoadingProfileIds = useMemo(() => {
    if (!selectedProfileId || !isLoadingSelectedModels || loadingProfileIds.has(selectedProfileId)) {
      return loadingProfileIds
    }

    const next = new Set(loadingProfileIds)
    next.add(selectedProfileId)
    return next
  }, [isLoadingSelectedModels, loadingProfileIds, selectedProfileId])

  const triggerThinkingOptions = getThinkingOptionsForModel
    ? getThinkingOptionsForModel(selectedModel)
    : thinkingOptions
  const hasAdjustableThinking = triggerThinkingOptions.some(option => option.value !== null && option.value !== 'auto')
  const thinkingLabel = hasAdjustableThinking
    ? triggerThinkingOptions.find(option => option.value === thinkingValue)?.label ?? null
    : null
  const modelLabel = selectedModel?.label
    ?? (isLoadingSelectedModels ? loadingLabel : emptySelectionLabel)

  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="xs" data-testid={triggerTestId} disabled={disabled} />}>
        {selectedProfile
          ? <ProviderIcon iconSlug={selectedProfile.iconSlug} presetId={presetForProfile(selectedProfile).id} className="size-3.5 shrink-0" />
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
          profiles={profiles}
          selectedProfileId={selectedProfileId}
          selectedModelId={selectedModelId}
          modelsByProfileId={modelsByProfileId}
          loadingProfileIds={effectiveLoadingProfileIds}
          thinkingValue={thinkingValue}
          thinkingOptions={thinkingOptions}
          getThinkingOptionsForModel={getThinkingOptionsForModel}
          emptyProfilesLabel={emptyProfilesLabel}
          onSelectProfile={onSelectProfile}
          onSelectModel={onSelectModel}
          onSelectThinking={onSelectThinking}
        />
      </MenuPopup>
    </Menu>
  )
}
