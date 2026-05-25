import {
  BotIcon,
  ChevronRightIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareCheckIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { AgentRuntimeConfigJsonSchema } from '~/features/agent-runtime/agent-config-schema'
import { useAgentModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { useAgents } from '~/features/agent-runtime/use-agents'
import {
  filterThinkingOptionsForModel,
  selectSupportedThinkingValue,
  THINKING_EFFORTS,
} from '~/features/composer-toolbar/constants'
import type { ThinkingOption } from '~/features/composer-toolbar/provider-model-menu'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import { cn } from '~/lib/cn'
import type { Agent, AgentProfile, ModelDescriptor, ProviderTarget } from '~/lib/types'

import type { AgentBatchThinkingEffort, AgentProviderBatchSelection } from './agent-batch-configuration'
import {
  buildAgentProviderBatchPatches,
} from './agent-batch-configuration'
import { AgentDetailPage } from './agent-detail'
import { StatusDot } from './agent-status-dot'
import { buildAvatarUrl } from './avatar-url'
import {
  applyVisibleRangeSelection,
  mergeVisibleSelection,
  pruneSelectedIds,
  removeVisibleSelection,
  selectedIdFromSet,
  selectedRecords,
  visibleRecordsAreSelected,
} from './settings-multi-selection'
import { useSettingsSelectionShortcuts } from './settings-selection-shortcuts'

const DRAFT_ID = '__agent-draft__'

type AgentManagementKey = keyof typeof import('~/locales/default').default.agentManagement

const thinkingLabelKeys = {
  auto: 'detail.thinking.auto.label',
  low: 'detail.thinking.low.label',
  medium: 'detail.thinking.medium.label',
  high: 'detail.thinking.high.label',
} satisfies Record<AgentBatchThinkingEffort, AgentManagementKey>

const thinkingDescriptionKeys = {
  auto: 'detail.thinking.auto.description',
  low: 'detail.thinking.low.description',
  medium: 'detail.thinking.medium.description',
  high: 'detail.thinking.high.description',
} satisfies Record<AgentBatchThinkingEffort, AgentManagementKey>

function providerTargetFromAgent(agent: Agent): ProviderTarget | null {
  return agent.providerTargetId ? { kind: 'manual', id: agent.providerTargetId } : null
}

function providerTargetKey(target: ProviderTarget | null): string | null {
  return target ? `${target.kind}:${target.id}` : null
}

function providerTargetFromKey(key: string | null): ProviderTarget | null {
  if (!key) {
    return null
  }
  const separatorIndex = key.indexOf(':')
  if (separatorIndex < 0) {
    return null
  }
  const kind = key.slice(0, separatorIndex)
  const id = key.slice(separatorIndex + 1)
  if ((kind !== 'manual' && kind !== 'external') || !id) {
    return null
  }
  return { kind, id } as ProviderTarget
}

function commonString(values: Array<string | null>): string | null {
  if (values.length === 0) {
    return null
  }
  const first = values[0] ?? null
  return values.every(value => value === first) ? first : null
}

function defaultBatchProviderTarget(agents: Agent[], profiles: AgentProfile[]): ProviderTarget | null {
  const enabledProfileIds = new Set(
    profiles.filter(profile => profile.enabled).map(profile => profile.id),
  )
  const providerAgents = agents.filter(agent => agent.runtimeKind !== 'cli-tui')
  const commonTarget = providerTargetFromKey(commonString(
    providerAgents.map(agent => providerTargetKey(providerTargetFromAgent(agent))),
  ))
  if (commonTarget?.kind === 'manual' && enabledProfileIds.has(commonTarget.id)) {
    return commonTarget
  }
  if (commonTarget?.kind === 'external') {
    return commonTarget
  }
  const fallbackProfileId = profiles.find(profile => profile.enabled)?.id ?? null
  return fallbackProfileId ? { kind: 'manual', id: fallbackProfileId } : null
}

function defaultBatchModelId(agents: Agent[], providerTarget: ProviderTarget | null): string | null {
  if (!providerTarget) {
    return null
  }
  const matchingAgents = agents.filter(
    agent =>
      agent.runtimeKind !== 'cli-tui'
      && providerTargetKey(providerTargetFromAgent(agent)) === providerTargetKey(providerTarget),
  )
  return commonString(matchingAgents.map(agent => agent.modelId))
}

function defaultBatchThinkingEffort(agents: Agent[]): AgentBatchThinkingEffort {
  const providerAgents = agents.filter(agent => agent.runtimeKind !== 'cli-tui')
  if (providerAgents.length === 0) {
    return 'auto'
  }
  const first = providerAgents[0]?.thinkingEffort ?? 'auto'
  return providerAgents.every(agent => agent.thinkingEffort === first) ? first : 'auto'
}

function AgentSidebarRow({
  agent,
  profiles,
  active,
  selected,
  onClick,
  onToggleSelected,
}: {
  agent: Agent
  profiles: AgentProfile[]
  active: boolean
  selected: boolean
  onClick: (shiftKey: boolean) => void
  onToggleSelected: (checked: boolean, shiftKey: boolean) => void
}) {
  const checkboxShiftKeyRef = useRef(false)
  const avatarUrl = agent.avatarUrl || buildAvatarUrl(agent.avatarStyle, agent.avatarSeed)
  const providerTarget = providerTargetFromAgent(agent)
  const profile = providerTarget?.kind === 'manual'
    ? profiles.find(p => p.id === providerTarget.id)
    : null
  const cliTuiLaunch
    = agent.runtimeKind === 'cli-tui'
      ? AgentRuntimeConfigJsonSchema.parse(agent.configJson).cliTui
      : null
  const subtitle
    = agent.runtimeKind === 'cli-tui'
      ? ['CLI TUI', cliTuiLaunch?.preset ?? cliTuiLaunch?.executable]
          .filter(Boolean)
          .join(' ·\n') || 'CLI TUI'
      : [profile?.name, agent.modelId].filter(Boolean).join(' ·\n') || undefined

  return (
    <div
      data-testid={`agent-sidebar-row-${agent.id}`}
      className={cn(
        'group/sidebar-row flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none',
        'transition-[background-color,opacity,scale] duration-150',
        'focus-within:ring-2 focus-within:ring-ring/50',
        active
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-foreground/[0.035] active:bg-foreground/6',
        !agent.enabled && !active && 'opacity-60',
      )}
    >
      <Checkbox
        checked={selected}
        onClickCapture={(event) => {
          checkboxShiftKeyRef.current = event.shiftKey
        }}
        onCheckedChange={(value) => {
          onToggleSelected(!!value, checkboxShiftKeyRef.current)
          checkboxShiftKeyRef.current = false
        }}
      />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
        onClick={event => onClick(event.shiftKey)}
      >
        <div className="size-7 shrink-0 overflow-hidden rounded-lg bg-foreground/5">
          <img
            src={avatarUrl}
            alt={agent.name}
            className="size-full object-cover"
            crossOrigin="anonymous"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'block truncate text-[12.5px] leading-tight',
                active ? 'font-medium text-foreground' : 'text-foreground/90',
              )}
            >
              {agent.name}
            </span>
            <StatusDot tone={agent.enabled ? 'active' : 'muted'} />
          </div>
          {subtitle && (
            <span className="block truncate whitespace-pre text-[10.5px] leading-tight text-muted-foreground/70">
              {subtitle}
            </span>
          )}
        </div>
        <ChevronRightIcon
          className={cn(
            'size-3 shrink-0 text-muted-foreground/40 transition-[opacity,transform] duration-150',
            active
              ? 'opacity-100 translate-x-0'
              : 'opacity-0 -translate-x-1 group-hover/sidebar-row:opacity-60 group-hover/sidebar-row:translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

function AgentBatchProviderPanel({
  selectedAgents,
  profiles,
  busy,
  onApply,
  onClear,
}: {
  selectedAgents: Agent[]
  profiles: AgentProfile[]
  busy: boolean
  onApply: (selection: AgentProviderBatchSelection) => void
  onClear: () => void
}) {
  const { t } = useTranslation('agentManagement')
  const providerAgents = selectedAgents.filter(agent => agent.runtimeKind !== 'cli-tui')
  const skippedCliTuiCount = selectedAgents.length - providerAgents.length
  const enabledProfiles = useMemo(() => profiles.filter(profile => profile.enabled), [profiles])
  const thinkingOptions: Array<ThinkingOption<AgentBatchThinkingEffort>> = useMemo(() => THINKING_EFFORTS.map((option) => {
    const value = option.value ?? 'auto'
    return {
      value,
      label: t(thinkingLabelKeys[value]),
      description: t(thinkingDescriptionKeys[value]),
    }
  }), [t])
  const defaultSelection = useMemo((): AgentProviderBatchSelection | null => {
    const providerTarget = defaultBatchProviderTarget(selectedAgents, profiles)
    if (!providerTarget) {
      return null
    }
    return {
      providerTarget,
      modelId: defaultBatchModelId(selectedAgents, providerTarget),
      thinkingEffort: defaultBatchThinkingEffort(selectedAgents),
    }
  }, [profiles, selectedAgents])
  const [selectionOverride, setSelectionOverride] = useState<AgentProviderBatchSelection | null>(
    null,
  )
  const selection = selectionOverride ?? defaultSelection
  const initialProfileIds = useMemo(
    () => [selection?.providerTarget.kind === 'manual' ? selection.providerTarget.id : null],
    [selection?.providerTarget],
  )
  const { modelsByProfileId, loadingProfileIds, requestProfileModels } = useAgentModelMap(
    enabledProfiles,
    initialProfileIds,
  )
  const selectedProfileId = selection?.providerTarget.kind === 'manual'
    ? selection.providerTarget.id
    : null
  const selectedModels = selectedProfileId
    ? (modelsByProfileId[selectedProfileId] ?? [])
    : []
  const selectedModel = selectedModels.find(model => model.id === selection?.modelId) ?? null
  const isLoadingSelectedModels = selectedProfileId
    ? loadingProfileIds.has(selectedProfileId)
    : false

  const resolveThinkingForModel = (
    model: ModelDescriptor | null,
    current: AgentBatchThinkingEffort,
  ): AgentBatchThinkingEffort =>
    selectSupportedThinkingValue(model, thinkingOptions, current, 'auto')

  const applyProfileSelection = (nextProfileId: string) => {
    requestProfileModels(nextProfileId)
    const nextModel = (modelsByProfileId[nextProfileId] ?? [])[0] ?? null
    setSelectionOverride({
      providerTarget: { kind: 'manual', id: nextProfileId },
      modelId: nextModel?.id ?? null,
      thinkingEffort: resolveThinkingForModel(nextModel, selection?.thinkingEffort ?? 'auto'),
    })
  }

  const applyModelSelection = (nextModelId: string | null, nextProfileId: string) => {
    const nextModel = nextModelId
      ? ((modelsByProfileId[nextProfileId] ?? []).find(model => model.id === nextModelId) ?? null)
      : null
    setSelectionOverride({
      providerTarget: { kind: 'manual', id: nextProfileId },
      modelId: nextModelId,
      thinkingEffort: resolveThinkingForModel(nextModel, selection?.thinkingEffort ?? 'auto'),
    })
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex w-full max-w-xl flex-col items-center gap-5 text-center">
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground">
          <SlidersHorizontalIcon className="size-4" />
        </div>
        <div className="space-y-2">
          <h4 className="font-heading text-sm font-medium tracking-tight text-foreground">
            {t('batch.provider.selected', { count: selectedAgents.length })}
          </h4>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {t('batch.provider.description')}
            {skippedCliTuiCount > 0 && (
              <>
                {' '}
                {t('batch.provider.skippedCliTui', { count: skippedCliTuiCount })}
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <ProviderModelPicker
            profiles={enabledProfiles}
            selectedProfileId={selectedProfileId}
            selectedModelId={selection?.modelId ?? null}
            selectedModel={selectedModel}
            modelsByProfileId={modelsByProfileId}
            loadingProfileIds={loadingProfileIds}
            thinkingValue={selection?.thinkingEffort ?? 'auto'}
            thinkingOptions={thinkingOptions}
            isLoadingSelectedModels={isLoadingSelectedModels}
            emptyProfilesLabel={t('batch.provider.emptyProfiles')}
            emptySelectionLabel={t('batch.provider.emptySelection')}
            menuSide="bottom"
            menuAlign="center"
            triggerTestId="agent-batch-provider-model-selector"
            disabled={providerAgents.length === 0}
            getThinkingOptionsForModel={model =>
              filterThinkingOptionsForModel(model, thinkingOptions)}
            onRequestProfileModels={requestProfileModels}
            onSelectProfile={applyProfileSelection}
            onSelectModel={applyModelSelection}
            onSelectThinking={(thinkingEffort) => {
              if (!selection) {
                return
              }
              setSelectionOverride({ ...selection, thinkingEffort })
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              if (selection) {
                onApply(selection)
              }
            }}
            disabled={busy || !selection || providerAgents.length === 0}
          >
            {t('batch.provider.apply')}
          </Button>
          <Button size="sm" variant="outline" onClick={onClear} disabled={busy}>
            <XIcon />
            {t('batch.provider.clearSelection')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function AgentList() {
  const { agents, isLoading, isSuccess: agentsReady, updateAgent, removeAgent } = useAgents()
  const { profiles, isSuccess: profilesReady } = useAgentProfiles()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const selectionAnchorIdRef = useRef<string | null>(null)
  const [isDrafting, setIsDrafting] = useState(false)
  const [filter, setFilter] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const agentFocusTargetId = useSettingsOverlayStore(state => state.agentFocusTarget?.id ?? null)
  const clearAgentFocusTarget = useSettingsOverlayStore(state => state.clearAgentFocusTarget)
  const settingsAgentsReady = agentsReady && profilesReady

  const visibleAgents = useMemo(() => {
    if (!filter.trim()) {
      return agents
    }
    const q = filter.trim().toLowerCase()
    return agents.filter(
      a => a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q),
    )
  }, [agents, filter])

  const selectedAgentId = selectedIdFromSet(selectedIds)
  const selectedAgent = useMemo(
    () => (selectedAgentId ? agents.find(a => a.id === selectedAgentId) : undefined),
    [agents, selectedAgentId],
  )
  const selectedAgents = useMemo(() => selectedRecords(agents, selectedIds), [agents, selectedIds])
  const isDraftSelected = isDrafting && selectedIds.has(DRAFT_ID)
  const allVisibleSelected = visibleRecordsAreSelected(visibleAgents, selectedIds)

  useEffect(() => {
    if (isDraftSelected) {
      return
    }
    const available = new Set(agents.map(agent => agent.id))
    setSelectedIds(prev => pruneSelectedIds(prev, available))
    if (selectionAnchorIdRef.current && !available.has(selectionAnchorIdRef.current)) {
      selectionAnchorIdRef.current = null
    }
  }, [agents, isDraftSelected])

  useEffect(() => {
    if (!agentFocusTargetId) {
      return
    }

    const focusedAgent = agents.find(agent => agent.id === agentFocusTargetId)
    if (focusedAgent) {
      setSelectedIds(new Set([focusedAgent.id]))
      selectionAnchorIdRef.current = focusedAgent.id
      setIsDrafting(false)
      setFilter('')
      clearAgentFocusTarget()
      return
    }

    if (agentsReady) {
      clearAgentFocusTarget()
    }
  }, [agentFocusTargetId, agents, agentsReady, clearAgentFocusTarget])

  const startDraft = useCallback(() => {
    setIsDrafting(true)
    setSelectedIds(new Set([DRAFT_ID]))
    selectionAnchorIdRef.current = null
  }, [])

  const handleCreated = useCallback((newAgentId: string) => {
    setIsDrafting(false)
    setSelectedIds(new Set([newAgentId]))
    selectionAnchorIdRef.current = newAgentId
  }, [])

  const handleDeleted = useCallback(() => {
    setSelectedIds(new Set())
    selectionAnchorIdRef.current = null
  }, [])

  const toggleVisibleSelected = useCallback(() => {
    setSelectedIds(prev =>
      allVisibleSelected
        ? removeVisibleSelection(prev, visibleAgents)
        : mergeVisibleSelection(prev, visibleAgents))
  }, [allVisibleSelected, visibleAgents])

  const selectVisibleAgents = useCallback(() => {
    setIsDrafting(false)
    setSelectedIds(prev => mergeVisibleSelection(prev, visibleAgents))
    selectionAnchorIdRef.current = visibleAgents.at(-1)?.id ?? null
  }, [visibleAgents])

  const clearSelection = useCallback(() => {
    setIsDrafting(false)
    setSelectedIds(new Set())
    selectionAnchorIdRef.current = null
  }, [])

  const selectAgent = useCallback(
    (agentId: string, selected: boolean, shiftKey: boolean) => {
      setIsDrafting(false)
      setSelectedIds((prev) => {
        if (shiftKey) {
          return applyVisibleRangeSelection(
            prev,
            visibleAgents,
            selectionAnchorIdRef.current,
            agentId,
            selected,
          )
        }

        const next = new Set(prev)
        next.delete(DRAFT_ID)
        if (selected) {
          next.add(agentId)
        }
 else {
          next.delete(agentId)
        }
        return next
      })
      selectionAnchorIdRef.current = agentId
    },
    [visibleAgents],
  )

  const openAgent = useCallback(
    (agentId: string, shiftKey: boolean) => {
      if (shiftKey) {
        selectAgent(agentId, true, true)
        return
      }

      setSelectedIds(new Set([agentId]))
      selectionAnchorIdRef.current = agentId
      setIsDrafting(false)
    },
    [selectAgent],
  )

  const handleBatchToggle = useCallback(
    async (enabled: boolean) => {
      if (selectedAgents.length === 0) {
        return
      }
      setBatchBusy(true)
      try {
        await Promise.all(
          selectedAgents.map(async (agent) => {
            await updateAgent.mutateAsync({
              id: agent.id,
              patch: {
                name: agent.name,
                description: agent.description,
                avatarStyle: agent.avatarStyle,
                avatarSeed: agent.avatarSeed,
                avatarUrl: agent.avatarUrl,
                providerTargetId: agent.providerTargetId,
                modelId: agent.modelId,
                thinkingEffort: agent.thinkingEffort,
                runtimeKind: agent.runtimeKind,
                configJson: agent.configJson,
                enabled,
              },
            })
          }),
        )
        setSelectedIds(new Set())
        selectionAnchorIdRef.current = null
      }
 finally {
        setBatchBusy(false)
      }
    },
    [selectedAgents, updateAgent],
  )

  const handleBatchDelete = useCallback(async () => {
    if (selectedAgents.length === 0) {
      return
    }
    setBatchBusy(true)
    try {
      await Promise.all(selectedAgents.map(agent => removeAgent.mutateAsync(agent.id)))
      setSelectedIds(new Set())
      selectionAnchorIdRef.current = null
    }
 finally {
      setBatchBusy(false)
    }
  }, [removeAgent, selectedAgents])

  const handleBatchConfigureProvider = useCallback(
    async (selection: AgentProviderBatchSelection) => {
      const { patches } = buildAgentProviderBatchPatches(selectedAgents, selection)
      if (patches.length === 0) {
        return
      }

      setBatchBusy(true)
      try {
        await Promise.all(
          patches.map(({ id, patch }) =>
            updateAgent.mutateAsync({
              id,
              patch,
            })),
        )
        setSelectedIds(new Set())
        selectionAnchorIdRef.current = null
      }
 finally {
        setBatchBusy(false)
      }
    },
    [selectedAgents, updateAgent],
  )

  const selectionShortcutScopeRef = useSettingsSelectionShortcuts({
    hasVisibleRecords: visibleAgents.length > 0,
    hasSelection: selectedIds.size > 0,
    hasDraft: isDrafting,
    canDeleteSelection: !batchBusy && selectedAgents.length > 0,
    onSelectVisible: selectVisibleAgents,
    onClearSelection: clearSelection,
    onDeleteSelection: () => {
      void handleBatchDelete()
    },
  })

  return (
    <div
      data-testid="agent-list"
      data-settings-agents-ready={settingsAgentsReady ? 'true' : 'false'}
      className="flex h-full flex-col overflow-hidden"
    >
      <header className="flex items-end justify-between gap-6 pb-5">
        <div className="space-y-1">
          <h3 className="font-heading text-[15px] font-medium tracking-tight text-foreground text-balance">
            Agents
          </h3>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Create AI agents with unique identities, personas, and runtime profiles.
          </p>
        </div>
        <Button data-testid="new-agent-btn" size="sm" onClick={startDraft} disabled={isDrafting}>
          <PlusIcon />
          Add agent
        </Button>
      </header>

      <Separator className="bg-foreground/6" />

      {!isDraftSelected && selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 border-b border-foreground/6 py-2">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <button
              type="button"
              onClick={toggleVisibleSelected}
              className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-foreground/[0.035]"
            >
              {allVisibleSelected
? (
                <SquareCheckIcon className="size-3.5" />
              )
: (
                <SquareIcon className="size-3.5" />
              )}
              <span>
{selectedIds.size}
{' '}
selected
              </span>
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="text-muted-foreground/70 hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleBatchToggle(true)}
              disabled={batchBusy || selectedAgents.length === 0}
            >
              Enable
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleBatchToggle(false)}
              disabled={batchBusy || selectedAgents.length === 0}
            >
              Disable
            </Button>
            <Button
              size="xs"
              variant="destructive"
              onClick={() => void handleBatchDelete()}
              disabled={batchBusy || selectedAgents.length === 0}
            >
              <Trash2Icon className="size-3" />
              Delete
            </Button>
          </div>
        </div>
      )}

      <div className="grid flex-1 grid-cols-[260px_1fr] gap-0 overflow-hidden">
        <aside
          className="flex flex-col gap-3 overflow-y-auto border-r border-foreground/6 py-4 pr-4"
          ref={selectionShortcutScopeRef}
        >
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search agents"
              className="h-8 pl-8 pr-2 text-[12.5px]"
            />
          </div>

          <ScrollArea className="-mx-1 flex-1">
            <div className="flex flex-col gap-0.5 px-1">
              {isDrafting && (
                <div
                  className={cn(
                    'group/sidebar-row relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none',
                    'transition-[background-color] duration-150',
                    'focus-within:ring-2 focus-within:ring-ring/50',
                    isDraftSelected
                      ? 'bg-accent text-accent-foreground'
                      : 'opacity-90 hover:bg-foreground/[0.035]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set([DRAFT_ID]))}
                    aria-pressed={isDraftSelected}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                  >
                    <span className="flex size-7 items-center justify-center rounded-lg border border-dashed border-foreground/15 text-muted-foreground">
                      <SparklesIcon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] leading-tight text-foreground/70">
                        New agent
                      </span>
                      <span className="block truncate text-[10.5px] leading-tight text-muted-foreground/60">
                        Set up identity
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="shrink-0 rounded p-0.5 text-muted-foreground/40 hover:text-muted-foreground"
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              )}

              {visibleAgents.length > 0 && (
                <div className="mb-1 flex items-center justify-between gap-2 px-2 py-0.5 text-[10.5px] text-muted-foreground/60">
                  <span>
{visibleAgents.length}
{' '}
visible
                  </span>
                  <button
                    type="button"
                    onClick={toggleVisibleSelected}
                    className="text-muted-foreground/70 hover:text-foreground"
                  >
                    {allVisibleSelected ? 'Unselect visible' : 'Select visible'}
                  </button>
                </div>
              )}

              {!isLoading
                && visibleAgents.map(agent => (
                  <AgentSidebarRow
                    key={agent.id}
                    agent={agent}
                    profiles={profiles}
                    active={selectedAgentId === agent.id && !isDraftSelected}
                    selected={selectedIds.has(agent.id)}
                    onClick={shiftKey => openAgent(agent.id, shiftKey)}
                    onToggleSelected={(checked, shiftKey) =>
                      selectAgent(agent.id, checked, shiftKey)}
                  />
                ))}

              {!isLoading && visibleAgents.length === 0 && !isDrafting && (
                <div className="px-2 py-6 text-center">
                  <p className="text-[11.5px] text-muted-foreground/70">
                    {filter ? 'No matches' : 'No agents yet'}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>

          {agents.length > 0 && (
            <div className="px-1 pt-1 text-[10.5px] tabular-nums text-muted-foreground/60">
              {agents.length}
{' '}
agent
{agents.length === 1 ? '' : 's'}
{' '}
·
{agents.filter(a => a.enabled).length}
{' '}
active
            </div>
          )}
        </aside>

        <section className="flex flex-col overflow-y-auto py-4 pl-6 pr-2">
          {isDraftSelected
? (
            <div key={DRAFT_ID} className="flex-1">
              <AgentDetailPage
                profiles={profiles}
                onCreated={handleCreated}
                onDeleted={handleDeleted}
              />
            </div>
          )
: selectedAgents.length > 1
? (
            <AgentBatchProviderPanel
              key={selectedAgents.map(agent => agent.id).join('|')}
              selectedAgents={selectedAgents}
              profiles={profiles}
              busy={batchBusy}
              onApply={selection => void handleBatchConfigureProvider(selection)}
              onClear={clearSelection}
            />
          )
: selectedAgent
? (
            <div key={selectedAgent.id} className="flex-1">
              <AgentDetailPage
                agent={selectedAgent}
                profiles={profiles}
                onDeleted={handleDeleted}
              />
            </div>
          )
: (
            <div className="flex flex-1 items-center justify-center">
              <Empty className="border-none">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BotIcon />
                  </EmptyMedia>
                  <EmptyTitle>No agent selected</EmptyTitle>
                  <EmptyDescription>
                    Pick an agent on the left to view its configuration, or add a new one to get
                    started.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm" variant="outline" onClick={startDraft} disabled={isDrafting}>
                    <PlusIcon />
                    Add agent
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
