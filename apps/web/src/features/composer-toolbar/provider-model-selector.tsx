// Input: Menu, MenuSub, MenuSubTrigger, MenuSubPopup, provider icons, agent profiles/models
// Output: ProviderModelSelector — cascading menu: Provider > Model > Thinking with icons
// Position: The core selector UI replacing 3 separate pill buttons

import { useState } from 'react'
import { CheckIcon, CpuIcon } from 'lucide-react'

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
          <div className="px-2 py-1.5">
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
        {filteredModels.map(model => {
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
  const family = model.capabilities?.family
  const ctxK = model.capabilities?.contextWindow
    ? model.capabilities.contextWindow >= 1000000
      ? `${Math.round(model.capabilities.contextWindow / 1000000)}M`
      : `${model.capabilities.contextWindow / 1000}K`
    : null

  return (
    <MenuSub>
      <MenuSubTrigger
        onClick={() => onSelectModel(model.id)}
        className={cn(isModelSelected && 'text-primary font-medium')}
      >
        <CheckIcon className={cn('size-3.5 shrink-0', isModelSelected ? 'text-primary' : 'text-transparent')} />
        <span className="truncate">{model.label}</span>
        {model.capabilities?.reasoning && (
          <span className="shrink-0 rounded-sm bg-muted px-1 text-[9px] text-muted-foreground">推理</span>
        )}
        {ctxK && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/40">{ctxK}</span>
        )}
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
