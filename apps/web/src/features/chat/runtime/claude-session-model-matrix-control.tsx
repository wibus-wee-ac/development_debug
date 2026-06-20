import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import {
  CheckLine as CheckLineIcon,
} from '@mingcute/react'
import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '~/components/ui/menu'
import { toastManager } from '~/components/ui/toast'
import { ProviderIcon } from '~/components/common/provider-icons'
import { ClaudeModelMatrixEditor } from '~/features/agent-management/claude-model-matrix-editor'
import {
  claudeAgentAliasesFromConfig,
  loadProviderTargetModelSettings,
} from '~/features/agent-management/provider-target-model-settings'
import { presetForProviderKind, providerTargetDisplayIconSlug } from '~/features/agent-management/provider-settings-utils'
import type { ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import {
  DEFAULT_CLAUDE_AGENT_ALIASES,
  hasClaudeAgentModelAliases,
} from '~/features/agent-runtime/claude-agent-config'
import type { ApiProviderKind, ModelDescriptor, RuntimeKind } from '~/features/agent-runtime/types'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'
import { cn } from '~/lib/cn'

import { useRuntimeSettings } from './use-runtime-settings'

export function supportsClaudeAgentModelMatrix(providerKind: ApiProviderKind | null): boolean {
  return providerKind === 'anthropic' || providerKind === 'universal'
}

function providerTargetModelSettingsQueryKey(providerTargetId: string | null) {
  return ['provider-target-model-settings', providerTargetId ?? 'no-provider-target'] as const
}

/**
 * Shape consumed by the provider model picker to render the matrix as a sub-menu.
 * Models + mainModelId are sourced from the picker context itself, so the slot
 * only carries the alias state + change handler.
 */
export interface ClaudeMatrixSlot {
  aliases: ClaudeAgentModelAliases
  onChange: (next: ClaudeAgentModelAliases) => void
  loading?: boolean
}

/**
 * Matrix slot for an existing chat session — reads/writes the session's
 * runtime settings via useRuntimeSettings.
 */
export function useSessionClaudeMatrix(args: {
  active: boolean
  sessionId: string
  runtimeKind: RuntimeKind | undefined
  providerTargetId: string | null
  providerKind: ApiProviderKind | null
}): ClaudeMatrixSlot | null {
  const { active, sessionId, runtimeKind, providerTargetId, providerKind } = args
  const enabled = active
    && runtimeKind === 'claude-agent'
    && !!providerTargetId
    && !!sessionId
    && supportsClaudeAgentModelMatrix(providerKind)
  const runtimeSettings = useRuntimeSettings(sessionId, enabled)

  return useMemo<ClaudeMatrixSlot | null>(() => {
    if (!enabled) {
      return null
    }
    return {
      aliases: runtimeSettings.claudeAgent?.modelAliases ?? DEFAULT_CLAUDE_AGENT_ALIASES,
      loading: !runtimeSettings.loaded || runtimeSettings.loading,
      onChange: (next) => {
        void runtimeSettings
          .update({
            claudeAgent: hasClaudeAgentModelAliases(next)
              ? { modelAliases: next }
              : null,
          })
          .catch((error: unknown) => {
            toastManager.add({
              type: 'error',
              title: 'Save Claude matrix failed',
              description: error instanceof Error ? error.message : 'Unknown error',
            })
          })
      },
    }
  }, [enabled, runtimeSettings])
}

/**
 * Matrix slot for the new-chat composer — reads/writes the per-profile
 * alias override stored in the new-chat store.
 */
export function useDraftClaudeMatrix(args: {
  active: boolean
  runtimeKind: RuntimeKind | undefined
  providerTargetId: string | null
  providerKind: ApiProviderKind | null
  aliases: ClaudeAgentModelAliases | null
  loading?: boolean
  onChange: (next: ClaudeAgentModelAliases) => void
}): ClaudeMatrixSlot | null {
  const { active, runtimeKind, providerTargetId, providerKind, aliases, loading, onChange } = args
  const enabled = active
    && runtimeKind === 'claude-agent'
    && !!providerTargetId
    && supportsClaudeAgentModelMatrix(providerKind)

  return useMemo<ClaudeMatrixSlot | null>(() => {
    if (!enabled) {
      return null
    }
    return {
      aliases: aliases ?? DEFAULT_CLAUDE_AGENT_ALIASES,
      loading,
      onChange,
    }
  }, [enabled, aliases, loading, onChange])
}

/**
 * Internal — also used by the settings panel when editing a provider target's
 * default matrix. Returns the aliases + loading flag for a given provider target.
 */
export function useProviderTargetClaudeMatrix(args: {
  providerTargetId: string | null
  providerKind: ApiProviderKind | null
  enabled: boolean
}): {
  aliases: ClaudeAgentModelAliases
  isLoading: boolean
} {
  const { providerTargetId, providerKind, enabled } = args
  const isClaudeMatrixProvider = supportsClaudeAgentModelMatrix(providerKind)
  const providerSettingsQuery = useQuery({
    queryKey: providerTargetModelSettingsQueryKey(providerTargetId),
    queryFn: () => loadProviderTargetModelSettings({ id: providerTargetId! }),
    enabled: enabled && isClaudeMatrixProvider && !!providerTargetId,
    staleTime: 10_000,
    retry: false,
  })

  const aliases = useMemo(
    () => providerSettingsQuery.data
      ? claudeAgentAliasesFromConfig(providerSettingsQuery.data.connectionConfigJson)
      : DEFAULT_CLAUDE_AGENT_ALIASES,
    [providerSettingsQuery.data],
  )

  return {
    aliases,
    isLoading: providerSettingsQuery.isLoading,
  }
}

export interface ClaudeAgentMatrixProviderOption {
  id: string
  name: string
  providerKind: ApiProviderKind
  iconSlug: string | null
}

/**
 * The single model-selection trigger for the Claude Agent runtime.
 *
 * Replaces the regular ProviderModelSelector when runtimeKind === 'claude-agent'.
 * Trigger mirrors ProviderModelPicker's layout (icon + provider + '/' + model +
 * '·' + label) so it visually reads as the same control. The popover lists
 * providers as menu rows (same pattern as the model picker) with the matrix
 * editor as a section below.
 */
export function ClaudeAgentMatrixSelector({
  profiles,
  selectedProfileId,
  models,
  selectedModelId,
  matrix,
  loadingModels,
  onSelectProfile,
  occludeNativeBrowserSurface,
}: {
  profiles: ClaudeAgentMatrixProviderOption[]
  selectedProfileId: string | null
  models: ModelDescriptor[]
  selectedModelId: string | null
  matrix: ClaudeMatrixSlot | null
  loadingModels?: boolean
  onSelectProfile: (id: string) => void
  occludeNativeBrowserSurface?: boolean
}) {
  const selectedProfile = profiles.find(p => p.id === selectedProfileId) ?? null
  const preset = selectedProfile ? presetForProviderKind(selectedProfile.providerKind) : null
  const isCustom = matrix ? hasClaudeAgentModelAliases(matrix.aliases) : false

  const selectedModel = models.find(m => m.id === selectedModelId) ?? null
  const modelLabel = selectedModel?.label
    ?? selectedModelId
    ?? (loadingModels ? 'Loading…' : 'Matrix')

  return (
    <Menu>
      <MenuTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="claude-agent-matrix-trigger"
            data-selected-provider-target-id={selectedProfileId ?? ''}
            data-selected-model-id={selectedModelId ?? ''}
            className="min-w-0 max-w-full shrink"
          />
        )}
      >
        {selectedProfile && preset
          ? (
              <ProviderIcon
                iconSlug={providerTargetDisplayIconSlug(selectedProfile)}
                presetId={preset.id}
                className="size-3.5 shrink-0"
              />
            )
          : null}
        <span className="flex min-w-0 max-w-64 items-center gap-1">
          <span className="min-w-0 max-w-[7.5rem] truncate text-muted-foreground/80">
            {selectedProfile?.name ?? 'Select provider'}
          </span>
          <span className="shrink-0 text-muted-foreground/40">/</span>
          <span className="min-w-0 max-w-40 truncate">{modelLabel}</span>
        </span>
        <span className="shrink-0 text-muted-foreground/40">·</span>
        <span
          className={cn(
            'shrink-0 text-[11px]',
            isCustom ? 'text-primary/80' : 'text-muted-foreground/70',
          )}
        >
          matrix
        </span>
      </MenuTrigger>
      <MenuPopup
        side="top"
        align="start"
        {...(occludeNativeBrowserSurface ? BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS : {})}
        className="w-[28rem]"
      >
        {/* Provider list — same shape as ProviderModelMenu's top section */}
        <div className="max-h-52 overflow-y-auto">
          {profiles.map(profile => {
            const isActive = profile.id === selectedProfileId
            const profilePreset = presetForProviderKind(profile.providerKind)
            return (
              <MenuItem
                key={profile.id}
                closeOnClick={false}
                onClick={() => onSelectProfile(profile.id)}
                className={cn(isActive && 'font-medium')}
              >
                <CheckLineIcon className={cn('size-3.5 shrink-0', isActive ? '!text-primary' : '!text-transparent')} />
                <ProviderIcon
                  iconSlug={providerTargetDisplayIconSlug(profile)}
                  presetId={profilePreset.id}
                  className="size-3.5 shrink-0"
                />
                <span className="truncate">{profile.name}</span>
              </MenuItem>
            )
          })}
          {profiles.length === 0 && (
            <MenuItem disabled>No providers configured</MenuItem>
          )}
        </div>

        {matrix && selectedProfile && (
          <>
            <MenuSeparator />
            <div className="p-2">
              <ClaudeModelMatrixEditor
                aliases={matrix.aliases}
                models={models}
                mainModelId={selectedModelId}
                loading={loadingModels || matrix.loading}
                onChange={matrix.onChange}
              />
            </div>
          </>
        )}
      </MenuPopup>
    </Menu>
  )
}
