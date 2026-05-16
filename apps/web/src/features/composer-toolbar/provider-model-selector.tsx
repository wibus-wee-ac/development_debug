// Input: Menu, MenuSub, MenuSubTrigger, MenuSubPopup, agent profiles/models
// Output: ProviderModelSelector — cascading menu: Provider > Model > Thinking
// Position: The core selector UI replacing 3 separate pill buttons

import { CpuIcon } from 'lucide-react'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger, MenuSub, MenuSubTrigger, MenuSubPopup } from '~/components/ui/menu'
import type { AgentProfile, ModelDescriptor } from '~/lib/types'
import { cn } from '~/lib/cn'

import { THINKING_EFFORTS } from './constants'
import type { ThinkingEffort } from './types'

interface ProviderModelSelectorProps {
  profiles: AgentProfile[]
  selectedProfileId: string | null
  selectedModelId: string | null
  models: ModelDescriptor[]
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
  const profileModels = isActive ? models : []

  return (
    <MenuSub>
      <MenuSubTrigger
        onClick={() => onSelectProfile(profile.id)}
        className={cn(isActive && 'font-medium')}
      >
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            isActive ? 'bg-primary' : 'bg-muted-foreground/30',
          )}
        />
        <span>{profile.name}</span>
        <span className="ml-1 text-[10px] uppercase text-muted-foreground/50">
          {profile.providerKind === 'anthropic' ? 'Anthropic' : 'OpenAI'}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        {isLoadingModels && profileModels.length === 0 && (
          <MenuItem disabled>Loading models…</MenuItem>
        )}
        {profileModels.map(model => {
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
  return (
    <MenuSub>
      <MenuSubTrigger
        onClick={() => onSelectModel(model.id)}
        className={cn(isModelSelected && 'text-primary font-medium')}
      >
        <span
          className={cn(
            'size-1 shrink-0 rounded-full',
            isModelSelected ? 'bg-primary' : 'bg-transparent',
          )}
        />
        <span className="truncate">{model.label}</span>
        {model.capabilities?.contextWindow && (
          <span className="ml-1 shrink-0 text-[10px] text-muted-foreground/40">
            {model.capabilities.contextWindow >= 1000000
              ? `${Math.round(model.capabilities.contextWindow / 1000000)}M`
              : `${model.capabilities.contextWindow / 1000}K`}
          </span>
        )}
      </MenuSubTrigger>
      <MenuSubPopup>
        {THINKING_EFFORTS.map(te => (
          <MenuItem
            key={te.value ?? 'auto'}
            onClick={() => onSelectThinkingEffort(te.value)}
            className={cn(thinkingEffort === te.value && 'text-primary font-medium')}
          >
            <span>{te.label}</span>
            {thinkingEffort === te.value && (
              <span className="ml-auto size-1.5 rounded-full bg-primary" />
            )}
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

  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="xs" data-testid="provider-model-selector" />}>
        <CpuIcon className="size-3 shrink-0 text-muted-foreground/70" />
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
            models={models}
            selectedModelId={selectedModelId}
            thinkingEffort={thinkingEffort}
            isLoadingModels={isLoadingModels}
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
