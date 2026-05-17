// Input: Menu, MenuSub, MenuSubTrigger, MenuSubPopup, provider icons, agent profiles/models
// Output: ProviderModelSelector — cascading menu: Provider > Model > Thinking with icons
// Position: The core selector UI replacing 3 separate pill buttons

import { useEffect, useState } from 'react'
import { BrainIcon, CheckIcon, CpuIcon, HammerIcon, ScanEyeIcon } from 'lucide-react'

import { Button } from '~/components/ui/button'
import { providerVisuals } from '~/features/agent-management/agent-runtime-settings'
import { presetForProfile } from '~/features/agent-management/agent-runtime-settings'
import type { AgentProfile, ModelDescriptor } from '~/lib/types'
import { cn } from '~/lib/cn'

import { THINKING_EFFORTS } from './constants'
import type { ModelsByProfileId, ThinkingEffort } from './types'
import { Menu, MenuItem, MenuPopup, MenuTrigger, MenuSub, MenuSubTrigger, MenuSubPopup } from '~/components/ui/menu'

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
  onSelectModel: (id: string) => void
  onSelectThinkingEffort: (effort: ThinkingEffort) => void
}

function ProviderGroup({
  profile,
  isActive,
  models,
  selectedModelId,
  thinkingEffort,
  isLoadingModels,
  onSelectProfile,
  onSelectModel,
  onSelectThinkingEffort,
}: {
  profile: AgentProfile
  isActive: boolean
  models: ModelDescriptor[]
  selectedModelId: string | null
  thinkingEffort: ThinkingEffort
  isLoadingModels: boolean
  onSelectProfile: (id: string) => void
  onSelectModel: (id: string) => void
  onSelectThinkingEffort: (effort: ThinkingEffort) => void
}) {
  const preset = presetForProfile(profile)
  const { Icon } = providerVisuals(preset.id)
  const profileModels = models
  const [modelSearch, setModelSearch] = useState('')
  const filteredModels = profileModels.filter(m =>
    !modelSearch || m.label.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase()),
  )

  // Progressive rendering: show first batch immediately, rest after idle
  const INITIAL_BATCH = 20
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
  // Reset when search changes
  useEffect(() => {
    setRenderCount(INITIAL_BATCH)
  }, [modelSearch])

  const visibleModels = filteredModels.slice(0, renderCount)

  return (
    <MenuSub>
      <MenuSubTrigger
        onClick={() => onSelectProfile(profile.id)}
        className={cn(isActive && 'font-medium')}
      >
        <CheckIcon className={cn('size-3.5 shrink-0', isActive ? 'text-primary' : 'text-transparent')} />
        <Icon className="size-3.5 shrink-0" />
        <span>{profile.name}</span>
      </MenuSubTrigger>
      <MenuSubPopup>
        {profileModels.length > 0 && (
          <div className="px-1 pt-1 pb-1.5">
            <input
              value={modelSearch}
              onChange={e => setModelSearch(e.target.value)}
              placeholder="Search models..."
              className="w-full rounded-md border border-border/50 bg-input/30 px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-border"
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
            />
          </div>
        )}
        {isLoadingModels && profileModels.length === 0 && (
          <MenuItem disabled>Loading models…</MenuItem>
        )}
        <div className="max-h-80 overflow-y-auto">
        {visibleModels.map((model) => {
          const isModelSelected = model.id === selectedModelId
          return (
            <ModelSubmenu
              key={model.id}
              model={model}
              isModelSelected={isModelSelected}
              thinkingEffort={thinkingEffort}
              onSelectModel={onSelectModel}
              onSelectThinkingEffort={onSelectThinkingEffort}
            />
          )
        })}
        </div>
        {renderCount < filteredModels.length && (
          <MenuItem disabled>Loading more…</MenuItem>
        )}
        {filteredModels.length === 0 && profileModels.length > 0 && (
          <MenuItem disabled>No matching models</MenuItem>
        )}
        {profileModels.length === 0 && !isLoadingModels && (
          <MenuItem disabled>No models available</MenuItem>
        )}
      </MenuSubPopup>
    </MenuSub>
  )
}

function ModelSubmenu({
  model,
  isModelSelected,
  thinkingEffort,
  onSelectModel,
  onSelectThinkingEffort,
}: {
  model: ModelDescriptor
  isModelSelected: boolean
  thinkingEffort: ThinkingEffort
  onSelectModel: (id: string) => void
  onSelectThinkingEffort: (effort: ThinkingEffort) => void
}) {
  const caps = model.capabilities
  const registryMatch = caps?.registryMatch
  const ctxK = caps?.contextWindow
    ? caps.contextWindow >= 1000000
      ? `${Math.round(caps.contextWindow / 1000000)}M`
      : `${Math.round(caps.contextWindow / 1000)}K`
    : null

  return (
    <MenuSub>
      <MenuSubTrigger
        onClick={() => onSelectModel(model.id)}
        className={cn(isModelSelected && 'text-primary font-medium')}
      >
        <CheckIcon className={cn('size-3.5 shrink-0 self-start mt-0.5', isModelSelected ? 'text-primary' : 'text-transparent')} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{model.label}</span>
            {registryMatch === 'fuzzy' && (
              <span className="shrink-0 text-[9px] text-muted-foreground/50" title="模糊匹配 models.dev">≈</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 leading-tight">
            <span className="max-w-35 truncate">{model.id}</span>
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
      </MenuSubTrigger>
      <MenuSubPopup>
        {THINKING_EFFORTS.map(te => (
          <MenuItem
            key={te.value ?? 'auto'}
            onClick={() => onSelectThinkingEffort(te.value)}
            className={cn('flex-col items-start', thinkingEffort === te.value && 'text-primary font-medium')}
          >
            <div className="flex w-full items-center gap-2">
              <span className="font-medium">{te.label}</span>
              <CheckIcon className={cn('ml-auto size-3.5 shrink-0', thinkingEffort === te.value ? 'text-primary' : 'text-transparent')} />
            </div>
            <span className="text-[11px] text-muted-foreground/60">{te.description}</span>
          </MenuItem>
        ))}
      </MenuSubPopup>
    </MenuSub>
  )
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
  const selectedModel = models.find(m => m.id === selectedModelId)
  const thinkingLabel = thinkingEffort
    ? THINKING_EFFORTS.find(t => t.value === thinkingEffort)?.label
    : null

  // Icon for the trigger button — from the selected profile
  const selectedProfile = profiles.find(p => p.id === selectedProfileId)
  const TriggerIcon = selectedProfile
    ? providerVisuals(presetForProfile(selectedProfile).id).Icon
    : null

  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="xs" data-testid="provider-model-selector" />}>
        {TriggerIcon
          ? <TriggerIcon className="size-3.5 shrink-0" />
          : <CpuIcon className="size-3.5 shrink-0 text-muted-foreground/70" />}
        <span className="max-w-40 truncate">
          {selectedModel?.label ?? (isLoadingModels ? 'Loading…' : 'Model')}
        </span>
        {thinkingLabel && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/70">{thinkingLabel}</span>
          </>
        )}
      </MenuTrigger>
      <MenuPopup side="top" align="start">
        {profiles.map(profile => (
          <ProviderGroup
            key={profile.id}
            profile={profile}
            isActive={profile.id === selectedProfileId}
            models={modelsByProfileId[profile.id] ?? []}
            selectedModelId={selectedModelId}
            thinkingEffort={thinkingEffort}
            isLoadingModels={loadingProfileIds.has(profile.id) || (profile.id === selectedProfileId && isLoadingModels)}
            onSelectProfile={onSelectProfile}
            onSelectModel={onSelectModel}
            onSelectThinkingEffort={onSelectThinkingEffort}
          />
        ))}
        {profiles.length === 0 && (
          <MenuItem disabled>暂无可用的 Provider</MenuItem>
        )}
      </MenuPopup>
    </Menu>
  )
}
