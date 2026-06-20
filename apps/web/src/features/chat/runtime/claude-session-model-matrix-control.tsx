import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { Settings2Line as SettingsIcon } from '@mingcute/react'
import { MenuSeparator, MenuSub, MenuSubPopup, MenuSubTrigger } from '~/components/ui/menu'
import { toastManager } from '~/components/ui/toast'
import { ClaudeModelMatrixEditor } from '~/features/agent-management/claude-model-matrix-editor'
import {
  claudeAgentAliasesFromConfig,
  loadProviderTargetModelSettings,
} from '~/features/agent-management/provider-target-model-settings'
import type { ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import {
  DEFAULT_CLAUDE_AGENT_ALIASES,
  hasClaudeAgentModelAliases,
} from '~/features/agent-runtime/claude-agent-config'
import type { ApiProviderKind, ModelDescriptor, RuntimeKind } from '~/features/agent-runtime/types'
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

/**
 * The matrix rendered as a sub-menu inside the provider model picker.
 * Trigger shows a summary (default / custom) and opens the editor flyout.
 */
export function ClaudeModelMatrixMenuSubmenu({
  slot,
  models,
  mainModelId,
  providerSettingsLoading,
}: {
  slot: ClaudeMatrixSlot
  models: ModelDescriptor[]
  mainModelId: string | null
  providerSettingsLoading?: boolean
}) {
  const { aliases, onChange, loading } = slot
  const [draftAliases, setDraftAliases] = useState<ClaudeAgentModelAliases>(aliases)

  useEffect(() => {
    setDraftAliases(aliases)
  }, [aliases])

  const isCustom = hasClaudeAgentModelAliases(draftAliases)
  const isLoading = loading || providerSettingsLoading

  const handleAliasesChange = (next: ClaudeAgentModelAliases) => {
    setDraftAliases(next)
    onChange(next)
  }

  return (
    <MenuSub>
      <MenuSubTrigger data-testid="claude-matrix-submenu-trigger">
        <SettingsIcon className="size-3.5 shrink-0" />
        <span>Claude matrix</span>
        <span
          className={cn(
            'ml-auto shrink-0 text-[10px] uppercase tracking-wide',
            isCustom ? 'text-primary/80' : 'text-muted-foreground/60',
          )}
        >
          {isCustom ? 'custom' : 'default'}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup side="right" align="start" className="w-[24rem] p-3">
        <ClaudeModelMatrixEditor
          aliases={draftAliases}
          models={models}
          mainModelId={mainModelId}
          loading={isLoading}
          onChange={handleAliasesChange}
        />
      </MenuSubPopup>
    </MenuSub>
  )
}

/**
 * Convenience wrapper rendered as a normal MenuItem-separated block inside
 * a MenuPopup. Callers just need to drop this in.
 */
export function ClaudeModelMatrixMenuBlock({
  slot,
  models,
  mainModelId,
  providerSettingsLoading,
}: {
  slot: ClaudeMatrixSlot
  models: ModelDescriptor[]
  mainModelId: string | null
  providerSettingsLoading?: boolean
}) {
  return (
    <>
      <MenuSeparator />
      <ClaudeModelMatrixMenuSubmenu
        slot={slot}
        models={models}
        mainModelId={mainModelId}
        providerSettingsLoading={providerSettingsLoading}
      />
    </>
  )
}
