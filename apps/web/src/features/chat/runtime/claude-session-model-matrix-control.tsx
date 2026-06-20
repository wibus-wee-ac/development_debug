import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Settings2Line as SettingsIcon } from '@mingcute/react'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
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

import { useRuntimeSettings } from './use-runtime-settings'

function supportsClaudeAgentModelMatrix(providerKind: ApiProviderKind | null): boolean {
  return providerKind === 'anthropic' || providerKind === 'universal'
}

function providerTargetModelSettingsQueryKey(providerTargetId: string | null) {
  return ['provider-target-model-settings', providerTargetId ?? 'no-provider-target'] as const
}

export function ClaudeSessionModelMatrixControl({
  active,
  sessionId,
  runtimeKind,
  providerTargetId,
  providerKind,
  modelId,
  models,
}: {
  active: boolean
  sessionId: string
  runtimeKind: RuntimeKind | undefined
  providerTargetId: string | null
  providerKind: ApiProviderKind | null
  modelId: string | null
  models: ModelDescriptor[]
}) {
  const enabled = active
    && runtimeKind === 'claude-agent'
    && !!providerTargetId
    && supportsClaudeAgentModelMatrix(providerKind)
  const runtimeSettings = useRuntimeSettings(sessionId, enabled)
  const providerSettingsQuery = useQuery({
    queryKey: providerTargetModelSettingsQueryKey(providerTargetId),
    queryFn: () => loadProviderTargetModelSettings({ id: providerTargetId! }),
    enabled,
    staleTime: 10_000,
    retry: false,
  })
  const [draftAliases, setDraftAliases] = useState<ClaudeAgentModelAliases>(DEFAULT_CLAUDE_AGENT_ALIASES)

  const providerAliases = useMemo(
    () => providerSettingsQuery.data
      ? claudeAgentAliasesFromConfig(providerSettingsQuery.data.connectionConfigJson)
      : DEFAULT_CLAUDE_AGENT_ALIASES,
    [providerSettingsQuery.data],
  )
  const effectiveAliases = runtimeSettings.claudeAgent?.modelAliases ?? providerAliases

  useEffect(() => {
    setDraftAliases(effectiveAliases)
  }, [effectiveAliases])

  if (!enabled) {
    return null
  }

  const handleAliasesChange = (next: ClaudeAgentModelAliases) => {
    setDraftAliases(next)
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
  }

  return (
    <Popover>
      <PopoverTrigger
        render={(
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="gap-1 text-[11px] text-muted-foreground"
            disabled={!runtimeSettings.loaded || runtimeSettings.loading}
          >
            <SettingsIcon className="size-3" />
            Claude matrix
          </Button>
        )}
      />
      <PopoverContent align="start" className="w-[24rem]">
        <ClaudeModelMatrixEditor
          aliases={draftAliases}
          models={models}
          mainModelId={modelId}
          loading={providerSettingsQuery.isLoading}
          onChange={handleAliasesChange}
        />
      </PopoverContent>
    </Popover>
  )
}
