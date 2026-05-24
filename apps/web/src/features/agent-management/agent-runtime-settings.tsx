import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  ServerIcon,
  SparklesIcon,
  SquareCheckIcon,
  SquareIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

import {
  getExternalProviderSourcesOptions,
  getExternalProviderSourcesRecordsOptions,
  postExternalProviderSourcesRefreshMutation
} from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { toastManager } from '~/components/ui/toast'
import { ProfileConfigJsonSchema } from '~/features/agent-runtime/profile-config-schema'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'
import type { AgentProfile } from '~/lib/types'

import { DraftSetupPanel } from './draft-setup-panel'
import { ExternalProviderRecordDetailPanel } from './external-provider-record-detail-panel'
import { ProfileDetailPanel } from './profile-detail-panel'
import { ProviderIcon } from './provider-icons'
import { collectProviderListGroups } from './provider-list-groups'
import type {
  DraftProvider,
  ExternalProviderRecordView,
  ExternalProviderSourceView,
  ProviderListEntry
} from './provider-settings-utils'
import {
  presetForProfile,
  presetForProviderKind,
  PROVIDER_KIND_LABELS,
  providerListEntryId
} from './provider-settings-utils'
import {
  applyVisibleRangeSelection,
  mergeVisibleSelection,
  pruneSelectedIds,
  removeVisibleSelection,
  selectedIdFromSet,
  selectedRecords,
  visibleRecordsAreSelected
} from './settings-multi-selection'
import { useSettingsSelectionShortcuts } from './settings-selection-shortcuts'

function parseProfileConfigForUpdate(configJson: string): Record<string, unknown> {
  const parsed = JSON.parse(configJson) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }
  return parsed as Record<string, unknown>
}

function defaultGroupOpen(groupKind: 'external-plugin' | 'external-source' | 'manual'): boolean {
  return groupKind === 'manual'
}

async function updateExternalRuntimeTargetEnabled(
  record: ExternalProviderRecordView,
  enabled: boolean
): Promise<void> {
  const response = await fetch(
    `${getServerUrl()}/external-provider-sources/${encodeURIComponent(record.sourceKey)}/records/${encodeURIComponent(record.externalId)}/runtime-target`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    }
  )
  if (!response.ok) {
    throw new Error('Failed to update external runtime target')
  }
}

const ProviderRow = memo(
  ({
    entry,
    active,
    selected,
    onOpenEntry,
    onSelectEntry
  }: {
    entry: ProviderListEntry
    active: boolean
    selected: boolean
    onOpenEntry: (entryId: string, shiftKey: boolean) => void
    onSelectEntry: (entryId: string, selected: boolean, shiftKey: boolean) => void
  }) => {
    const checkboxShiftKeyRef = useRef(false)
    const providerKind =
      entry.kind === 'manual-profile' ? entry.profile.providerKind : entry.record.providerKind
    const preset =
      entry.kind === 'manual-profile'
        ? presetForProfile(entry.profile)
        : presetForProviderKind(providerKind)
    const title = entry.kind === 'manual-profile' ? entry.profile.name : entry.record.name
    const subtitle =
      entry.kind === 'manual-profile'
        ? (() => {
            const cfg = ProfileConfigJsonSchema.parse(entry.profile.configJson)
            return cfg.model
              ? `${PROVIDER_KIND_LABELS[entry.profile.providerKind]} · ${cfg.model}`
              : PROVIDER_KIND_LABELS[entry.profile.providerKind]
          })()
        : `${PROVIDER_KIND_LABELS[entry.record.providerKind]} · ${entry.record.app}`
    const statusLabel =
      entry.kind === 'manual-profile'
        ? entry.profile.enabled
          ? null
          : 'Off'
        : !entry.record.runtimeTargetEnabled
          ? 'Off'
          : entry.record.status === 'active'
            ? null
            : entry.record.status
    const testId =
      entry.kind === 'manual-profile'
        ? `agent-profile-row-${entry.profile.id}`
        : `external-provider-record-row-${entry.record.id}`

    return (
      <div
        data-testid={testId}
        className={cn(
          'group/sidebar-row flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5 text-left outline-none',
          'transition-[background-color,opacity,scale] duration-150',
          active
            ? 'bg-foreground/[0.045] text-foreground'
            : 'hover:bg-foreground/[0.035] active:bg-foreground/6',
          entry.kind === 'manual-profile' && !entry.profile.enabled && !active && 'opacity-60',
          entry.kind === 'external-record' &&
            (!entry.record.runtimeTargetEnabled || entry.record.status !== 'active') &&
            !active &&
            'opacity-70'
        )}
      >
        <Checkbox
          checked={selected}
          onClickCapture={(event) => {
            checkboxShiftKeyRef.current = event.shiftKey
          }}
          onCheckedChange={(value) => {
            onSelectEntry(entry.id, !!value, checkboxShiftKeyRef.current)
            checkboxShiftKeyRef.current = false
          }}
        />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left outline-none"
          onClick={(event) => onOpenEntry(entry.id, event.shiftKey)}
        >
          <ProviderIcon
            iconSlug={entry.kind === 'manual-profile' ? entry.profile.iconSlug : null}
            presetId={preset.id}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  'block min-w-0 truncate text-[12.5px] leading-tight',
                  active ? 'font-medium text-foreground' : 'text-foreground/90'
                )}
              >
                {title}
              </span>
              {statusLabel && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  {statusLabel}
                </span>
              )}
            </div>
            <span className="block truncate text-[10.5px] leading-tight text-muted-foreground/70">
              {subtitle}
            </span>
          </div>
          <ChevronRightIcon
            className={cn(
              'size-3 shrink-0 text-muted-foreground/40 transition-[opacity,transform,width] duration-150',
              active
                ? 'w-3 opacity-100 translate-x-0'
                : 'w-0 opacity-0 -translate-x-1 group-hover/sidebar-row:w-3 group-hover/sidebar-row:opacity-60 group-hover/sidebar-row:translate-x-0'
            )}
          />
        </button>
      </div>
    )
  }
)
ProviderRow.displayName = 'ProviderRow'

export function AgentRuntimeSettings() {
  const {
    profiles,
    isSuccess: profilesReady,
    refetch,
    updateProfile,
    removeProfile
  } = useAgentProfiles()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const selectionAnchorIdRef = useRef<string | null>(null)
  const [draft, setDraft] = useState<DraftProvider | null>(null)
  const [filter, setFilter] = useState('')
  const deferredFilter = useDeferredValue(filter)
  const [batchBusy, setBatchBusy] = useState(false)
  const [groupOpenOverrides, setGroupOpenOverrides] = useState<Map<string, boolean>>(
    () => new Map()
  )
  const {
    data: externalSources = [],
    isSuccess: externalSourcesReady,
    refetch: refetchExternalSources
  } = useQuery({
    ...getExternalProviderSourcesOptions(),
    retry: false
  })
  const {
    data: externalRecords = [],
    isSuccess: externalRecordsReady,
    refetch: refetchExternalRecords
  } = useQuery({
    ...getExternalProviderSourcesRecordsOptions(),
    retry: false
  })
  const settingsProvidersReady = profilesReady && externalSourcesReady && externalRecordsReady

  const refreshExternalSources = useMutation({
    ...postExternalProviderSourcesRefreshMutation(),
    onSuccess: async (data) => {
      await Promise.all([refetch(), refetchExternalSources(), refetchExternalRecords()])

      const results = Array.isArray(data) ? data : [data]
      const errors = results.filter((r) => r.status === 'error')
      const ok = results.filter((r) => r.status !== 'error')

      if (errors.length > 0) {
        toastManager.add({
          type: 'error',
          title: `${errors.length} source(s) failed to sync`,
          description: errors.map((e) => e.message ?? e.sourceKey).join(', ') || undefined
        })
      }
      if (ok.length > 0) {
        toastManager.add({ type: 'success', title: `${ok.length} source(s) refreshed` })
      }
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: 'Refresh failed',
        description:
          error instanceof Error ? error.message : 'External sources could not be refreshed'
      })
    }
  })

  const externalSourcesById = useMemo(
    () =>
      new Map(
        (externalSources as ExternalProviderSourceView[]).map((source) => [source.id, source])
      ),
    [externalSources]
  )

  const providerGroups = useMemo(
    () =>
      collectProviderListGroups(
        profiles,
        externalRecords as unknown as ExternalProviderRecordView[],
        externalSources as ExternalProviderSourceView[]
      ),
    [profiles, externalRecords, externalSources]
  )
  const visibleProfileGroups = useMemo(() => {
    if (!deferredFilter.trim()) {
      return providerGroups
    }
    const q = deferredFilter.trim().toLowerCase()
    return providerGroups
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => {
          const source =
            entry.kind === 'external-record'
              ? externalSourcesById.get(entry.record.sourceKey)
              : null
          const label = entry.kind === 'manual-profile' ? entry.profile.name : entry.record.name
          const kindLabel =
            PROVIDER_KIND_LABELS[
              entry.kind === 'manual-profile'
                ? entry.profile.providerKind
                : entry.record.providerKind
            ] ?? ''
          const sourceLabel = source?.label ?? ''
          const app = entry.kind === 'external-record' ? entry.record.app : ''
          const externalId = entry.kind === 'external-record' ? entry.record.externalId : ''
          return (
            group.label.toLowerCase().includes(q) ||
            label.toLowerCase().includes(q) ||
            kindLabel.toLowerCase().includes(q) ||
            sourceLabel.toLowerCase().includes(q) ||
            app.toLowerCase().includes(q) ||
            externalId.toLowerCase().includes(q)
          )
        })
      }))
      .filter((group) => group.entries.length > 0)
  }, [externalSourcesById, providerGroups, deferredFilter])
  const providerEntries = useMemo(
    () => providerGroups.flatMap((group) => group.entries),
    [providerGroups]
  )
  const visibleEntries = useMemo(
    () => visibleProfileGroups.flatMap((group) => group.entries),
    [visibleProfileGroups]
  )

  const selectedEntryId = selectedIdFromSet(selectedIds)
  const selectedEntry = selectedEntryId
    ? (providerEntries.find((entry) => entry.id === selectedEntryId) ?? null)
    : null
  const selectedEntries = useMemo(
    () => selectedRecords(providerEntries, selectedIds),
    [providerEntries, selectedIds]
  )
  const selectedProfiles = useMemo(
    () =>
      selectedEntries.flatMap((entry) => (entry.kind === 'manual-profile' ? [entry.profile] : [])),
    [selectedEntries]
  )
  const selectedExternalRecords = useMemo(
    () =>
      selectedEntries.flatMap((entry) => (entry.kind === 'external-record' ? [entry.record] : [])),
    [selectedEntries]
  )
  const toggleableSelectedProfiles = selectedProfiles
  const toggleableSelectedExternalRecords = selectedExternalRecords.filter(
    (record) => record.status !== 'missing' && record.status !== 'unsupported'
  )
  const removableSelectedProfiles = selectedProfiles
  const toggleableSelectedCount =
    toggleableSelectedProfiles.length + toggleableSelectedExternalRecords.length
  const isDraftSelected = !!(draft && selectedIds.has(draft.id))
  const allVisibleSelected = visibleRecordsAreSelected(visibleEntries, selectedIds)
  const hasFilter = deferredFilter.trim().length > 0

  const toggleGroupCollapsed = useCallback((groupId: string, open: boolean) => {
    setGroupOpenOverrides((prev) => {
      const next = new Map(prev)
      next.set(groupId, open)
      return next
    })
  }, [])

  useEffect(() => {
    if (isDraftSelected) {
      return
    }
    const available = new Set(providerEntries.map((entry) => entry.id))
    setSelectedIds((prev) => pruneSelectedIds(prev, available))
    if (selectionAnchorIdRef.current && !available.has(selectionAnchorIdRef.current)) {
      selectionAnchorIdRef.current = null
    }
  }, [providerEntries, isDraftSelected])

  const startDraft = useCallback(() => {
    const id = `draft-${Date.now()}`
    setDraft({ id, presetId: null })
    setSelectedIds(new Set([id]))
    selectionAnchorIdRef.current = null
  }, [])

  const cancelDraft = useCallback(() => {
    setDraft(null)
    setSelectedIds(new Set())
    selectionAnchorIdRef.current = null
  }, [])

  const handleDraftComplete = useCallback(
    (newProfileId?: string) => {
      void refetch().finally(() => {
        refetchExternalRecords()
        setDraft(null)
        const nextId = newProfileId ? providerListEntryId('manual-profile', newProfileId) : null
        setSelectedIds(nextId ? new Set([nextId]) : new Set())
        selectionAnchorIdRef.current = nextId
      })
    },
    [refetch, refetchExternalRecords]
  )

  const handleRemoveProfile = useCallback(
    async (id: string) => {
      await removeProfile.mutateAsync(id)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(providerListEntryId('manual-profile', id))
        return next
      })
      if (selectionAnchorIdRef.current === providerListEntryId('manual-profile', id)) {
        selectionAnchorIdRef.current = null
      }
    },
    [removeProfile]
  )

  const handleToggleProfile = useCallback(
    async (profile: AgentProfile, enabled: boolean) => {
      await updateProfile.mutateAsync({
        id: profile.id,
        body: {
          name: profile.name,
          providerKind: profile.providerKind,
          enabled,
          config: parseProfileConfigForUpdate(profile.configJson),
          credentialRef: profile.credentialRef ?? null
        }
      })
    },
    [updateProfile]
  )

  const toggleVisibleSelected = useCallback(() => {
    setSelectedIds((prev) =>
      allVisibleSelected
        ? removeVisibleSelection(prev, visibleEntries)
        : mergeVisibleSelection(prev, visibleEntries)
    )
  }, [allVisibleSelected, visibleEntries])

  const selectVisibleProfiles = useCallback(() => {
    setDraft(null)
    setSelectedIds((prev) => mergeVisibleSelection(prev, visibleEntries))
    selectionAnchorIdRef.current = visibleEntries.at(-1)?.id ?? null
  }, [visibleEntries])

  const clearSelection = useCallback(() => {
    setDraft(null)
    setSelectedIds(new Set())
    selectionAnchorIdRef.current = null
  }, [])

  const selectEntry = useCallback(
    (entryId: string, selected: boolean, shiftKey: boolean) => {
      setDraft(null)
      setSelectedIds((prev) => {
        if (shiftKey) {
          return applyVisibleRangeSelection(
            prev,
            visibleEntries,
            selectionAnchorIdRef.current,
            entryId,
            selected
          )
        }

        const next = new Set(prev)
        next.delete(draft?.id ?? '')
        if (selected) {
          next.add(entryId)
        } else {
          next.delete(entryId)
        }
        return next
      })
      selectionAnchorIdRef.current = entryId
    },
    [draft?.id, visibleEntries]
  )

  const openEntry = useCallback(
    (entryId: string, shiftKey: boolean) => {
      if (shiftKey) {
        selectEntry(entryId, true, true)
        return
      }

      setSelectedIds(new Set([entryId]))
      selectionAnchorIdRef.current = entryId
      setDraft(null)
    },
    [selectEntry]
  )

  const handleBatchToggle = useCallback(
    async (enabled: boolean) => {
      if (toggleableSelectedCount === 0) {
        return
      }
      setBatchBusy(true)
      try {
        await Promise.all([
          ...toggleableSelectedProfiles.map((profile) => handleToggleProfile(profile, enabled)),
          ...toggleableSelectedExternalRecords.map((record) =>
            updateExternalRuntimeTargetEnabled(record, enabled)
          )
        ])
        if (toggleableSelectedExternalRecords.length > 0) {
          await refetchExternalRecords()
        }
        setSelectedIds(new Set())
        selectionAnchorIdRef.current = null
      } finally {
        setBatchBusy(false)
      }
    },
    [
      toggleableSelectedProfiles,
      toggleableSelectedExternalRecords,
      toggleableSelectedCount,
      handleToggleProfile,
      refetchExternalRecords
    ]
  )

  const handleBatchRemove = useCallback(async () => {
    if (removableSelectedProfiles.length === 0) {
      return
    }
    setBatchBusy(true)
    try {
      await Promise.all(
        removableSelectedProfiles.map((profile) => removeProfile.mutateAsync(profile.id))
      )
      setSelectedIds(new Set())
      selectionAnchorIdRef.current = null
    } finally {
      setBatchBusy(false)
    }
  }, [removeProfile, removableSelectedProfiles])

  const selectionShortcutScopeRef = useSettingsSelectionShortcuts({
    hasVisibleRecords: visibleEntries.length > 0,
    hasSelection: selectedIds.size > 0,
    hasDraft: !!draft,
    canDeleteSelection: !batchBusy && removableSelectedProfiles.length > 0,
    onSelectVisible: selectVisibleProfiles,
    onClearSelection: clearSelection,
    onDeleteSelection: () => {
      void handleBatchRemove()
    }
  })

  return (
    <div
      data-testid="agent-runtime-settings"
      data-settings-providers-ready={settingsProvidersReady ? 'true' : 'false'}
      className="flex h-full min-w-0 flex-col overflow-hidden"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3 pb-5">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-heading text-[15px] font-medium tracking-tight text-foreground text-balance">
            Provider targets
          </h3>
          <p className="max-w-full break-words text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            Manual profiles are editable provider targets. External source records stay source-owned
            and are shown in separate read-only groups.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refreshExternalSources.mutate({})}
            disabled={refreshExternalSources.isPending}
          >
            <RefreshCwIcon
              className={cn('size-3.5', refreshExternalSources.isPending && 'animate-spin')}
            />
            Refresh sources
          </Button>
          <Button data-testid="add-provider-btn" size="sm" onClick={startDraft} disabled={!!draft}>
            <PlusIcon />
            Add manual profile
          </Button>
        </div>
      </header>

      <Separator className="bg-foreground/6" />

      {!isDraftSelected && selectedIds.size > 0 && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-foreground/6 py-2">
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
            <button
              type="button"
              onClick={toggleVisibleSelected}
              className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-foreground/[0.035]"
            >
              {allVisibleSelected ? (
                <SquareCheckIcon className="size-3.5" />
              ) : (
                <SquareIcon className="size-3.5" />
              )}
              <span>{selectedIds.size} selected</span>
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="text-muted-foreground/70 hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleBatchToggle(true)}
              disabled={batchBusy || toggleableSelectedCount === 0}
            >
              Enable
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleBatchToggle(false)}
              disabled={batchBusy || toggleableSelectedCount === 0}
            >
              Disable
            </Button>
            <Button
              size="xs"
              variant="destructive"
              onClick={() => void handleBatchRemove()}
              disabled={batchBusy || removableSelectedProfiles.length === 0}
            >
              <Trash2Icon className="size-3" />
              Delete
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside
          className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden border-r border-foreground/6 py-4 pr-4"
          ref={selectionShortcutScopeRef}
          style={{ flex: '0 0 360px', maxWidth: '42%' }}
        >
          <div className="relative min-w-0">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search provider targets"
              className="h-8 pl-8 pr-2 text-[12.5px]"
            />
          </div>

          <ScrollArea className="-mx-1 min-h-0 flex-1">
            <div className="flex min-w-0 flex-col gap-0.5 px-1">
              {draft && (
                <div
                  className={cn(
                    'group/sidebar-row relative flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5 text-left outline-none',
                    'transition-[background-color] duration-150',
                    isDraftSelected
                      ? 'bg-foreground/[0.045] text-foreground'
                      : 'opacity-90 hover:bg-foreground/[0.035]'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set([draft.id]))}
                    aria-pressed={isDraftSelected}
                    className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left outline-none"
                  >
                    <span className="flex size-5 items-center justify-center rounded-sm border border-dashed border-foreground/15 text-muted-foreground -ml-0.5">
                      <SparklesIcon className="size-2.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] leading-tight text-foreground/70">
                        New provider
                      </span>
                      <span className="block truncate text-[10.5px] leading-tight text-muted-foreground/60">
                        Pick a template
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

              {visibleEntries.length > 0 && (
                <div className="mb-1 flex items-center justify-between gap-2 px-2 py-0.5 text-[10.5px] text-muted-foreground/60">
                  <span>{visibleEntries.length} visible</span>
                  <button
                    type="button"
                    onClick={toggleVisibleSelected}
                    className="text-muted-foreground/70 hover:text-foreground"
                  >
                    {allVisibleSelected ? 'Unselect visible' : 'Select visible'}
                  </button>
                </div>
              )}

              {visibleProfileGroups.map((group) => {
                const selectedInGroup =
                  !!selectedEntryId && group.entries.some((entry) => entry.id === selectedEntryId)
                const isOpen =
                  hasFilter ||
                  selectedInGroup ||
                  groupOpenOverrides.get(group.id) ||
                  (!groupOpenOverrides.has(group.id) && defaultGroupOpen(group.kind))
                return (
                  <Collapsible
                    key={group.id}
                    open={isOpen}
                    onOpenChange={(open) => toggleGroupCollapsed(group.id, open)}
                    className="flex min-w-0 flex-col gap-0.5"
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'flex min-w-0 items-center justify-between gap-2 rounded-md px-2 pb-0.5 pt-2 h-6 text-[10.5px] font-medium text-muted-foreground/60 outline-none',
                          'transition-colors hover:bg-foreground/[0.03] hover:text-foreground/80',
                          'pt-0'
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <ChevronDownIcon
                            className={cn(
                              'size-3 shrink-0 text-muted-foreground/45 transition-transform duration-200',
                              !isOpen && '-rotate-90'
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0 truncate">{group.label}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">{group.entries.length}</span>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="flex min-w-0 flex-col gap-0.5">
                      {group.entries.map((entry) => (
                        <ProviderRow
                          key={entry.id}
                          entry={entry}
                          active={selectedEntryId === entry.id && !isDraftSelected}
                          selected={selectedIds.has(entry.id)}
                          onOpenEntry={openEntry}
                          onSelectEntry={selectEntry}
                        />
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}

              {visibleEntries.length === 0 && !draft && (
                <div className="px-2 py-6 text-center">
                  <p className="text-[11.5px] text-muted-foreground/70">
                    {filter ? 'No matches' : 'No providers yet'}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>

          {(profiles.length > 0 || externalRecords.length > 0) && (
            <div className="px-1 pt-1 text-[10.5px] tabular-nums text-muted-foreground/60">
              {profiles.length} manual profiles · {externalRecords.length} external records
            </div>
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-y-auto py-4 pl-6 pr-2">
          {isDraftSelected && draft ? (
            <div className="min-w-0 flex-1">
              <DraftSetupPanel
                draft={draft}
                onSelectPreset={(presetId) =>
                  setDraft((prev) => (prev ? { ...prev, presetId } : prev))
                }
                onComplete={handleDraftComplete}
                onCancel={cancelDraft}
              />
            </div>
          ) : selectedEntries.length > 1 ? (
            <div className="flex flex-1 items-center justify-center">
              <Empty className="border-none">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ServerIcon />
                  </EmptyMedia>
                  <EmptyTitle>{selectedEntries.length} items selected</EmptyTitle>
                  <EmptyDescription>
                    Batch actions apply only to manual profiles. External records stay read-only.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm" variant="outline" onClick={clearSelection}>
                    <XIcon />
                    Clear selection
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          ) : selectedEntry?.kind === 'manual-profile' ? (
            <div key={selectedEntry.profile.id} className="min-w-0 flex-1">
              <ProfileDetailPanel
                profile={selectedEntry.profile}
                onRemove={() => void handleRemoveProfile(selectedEntry.profile.id)}
                onToggle={(enabled) => void handleToggleProfile(selectedEntry.profile, enabled)}
                onSaved={() => {
                  void refetch()
                  refetchExternalRecords()
                }}
              />
            </div>
          ) : selectedEntry?.kind === 'external-record' ? (
            <div key={selectedEntry.record.id} className="min-w-0 flex-1">
              <ExternalProviderRecordDetailPanel
                record={selectedEntry.record}
                source={externalSourcesById.get(selectedEntry.record.sourceKey) ?? null}
                onUpdated={() => {
                  refetchExternalRecords()
                }}
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Empty className="border-none">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ServerIcon />
                  </EmptyMedia>
                  <EmptyTitle>No provider selected</EmptyTitle>
                  <EmptyDescription>
                    Pick a provider on the left to view its configuration, or add a new one to get
                    started.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm" variant="outline" onClick={startDraft}>
                    <PlusIcon />
                    Add provider
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
