import {
  ActivityIcon,
  BrainIcon,
  CheckCircle2Icon,
  ClockIcon,
  CpuIcon,
  EyeIcon,
  HardDriveIcon,
  ImageIcon,
  KeyRoundIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import { useAgentModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import { SettingsDivider, SettingsRow, SettingsSectionHeader } from '~/features/settings/settings-row'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'

import type {
  ChronicleMessageSource,
  ChronicleModelResource,
  ChronicleSlackSourceDraft,
  MemoryEntry,
  TimelineEntry,
} from './use-chronicle'
import {
  useChronicleConfig,
  useChronicleMemories,
  useChronicleMemorySearch,
  useChronicleMessageSources,
  useChronicleModelResources,
  useChronicleSlackSourceActions,
  useChronicleStatus,
  useChronicleTimeline,
  useRefreshChronicleQueries,
} from './use-chronicle'

const MEMORY_SEARCH_LIMIT = 50

function formatDateTime(value: string | number | null): string {
  if (!value) {
    return 'Never'
  }

  const date = typeof value === 'number' ? new Date(toMilliseconds(value)) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Never'
  }

  return date.toLocaleString()
}

function formatRelativeTime(value: string | number | null): string {
  if (!value) {
    return 'Never'
  }

  const time = typeof value === 'number' ? toMilliseconds(value) : new Date(value).getTime()
  if (Number.isNaN(time)) {
    return 'Never'
  }

  const diff = Date.now() - time
  const seconds = Math.max(0, Math.floor(diff / 1000))
  if (seconds < 60) {
    return 'Just now'
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function toMilliseconds(value: number): number {
  return value < 1_000_000_000_000 ? value * 1000 : value
}

function getResourceTone(resource: ChronicleModelResource): 'ready' | 'optional' | 'warning' | 'error' | 'loading' {
  if (resource.state === 'available') {
    return 'ready'
  }
  if (resource.state === 'installing') {
    return 'loading'
  }
  if (resource.state === 'error') {
    return 'error'
  }
  if (resource.required) {
    return 'warning'
  }
  return 'optional'
}

function getResourceStateLabel(resource: ChronicleModelResource): string {
  if (resource.state === 'available') {
    return 'Ready'
  }
  if (resource.state === 'installing') {
    return 'Installing'
  }
  if (resource.state === 'error') {
    return 'Error'
  }
  if (resource.required) {
    return 'Missing'
  }
  return 'Optional'
}

export function ChronicleSettings() {
  const { config, loading: configLoading, saving, updateConfig } = useChronicleConfig()
  const { status, loading: statusLoading } = useChronicleStatus()
  const { resources, loading: resourcesLoading } = useChronicleModelResources()
  const { sources: messageSources, loading: messageSourcesLoading } = useChronicleMessageSources()
  const { entries: timelineEntries, loading: timelineLoading } = useChronicleTimeline()
  const { entries: memoryEntries, loading: memoriesLoading } = useChronicleMemories(MEMORY_SEARCH_LIMIT)
  const [searchQuery, setSearchQuery] = useState('')
  const {
    entries: searchedMemoryEntries,
    hasQuery: hasSearchQuery,
    searching: searchingMemories,
  } = useChronicleMemorySearch(searchQuery, MEMORY_SEARCH_LIMIT)
  const refreshChronicle = useRefreshChronicleQueries()
  const { profiles } = useAgentProfiles()
  const { modelsByProfileId, loadingProfileIds } = useAgentModelMap(profiles)

  const selectedProfile = useMemo(
    () => profiles.find(profile => profile.id === config?.profileId) ?? null,
    [config?.profileId, profiles],
  )
  const selectedModels = selectedProfile ? modelsByProfileId[selectedProfile.id] ?? [] : []
  const selectedModel = selectedModels.find(model => model.id === config?.modelId) ?? null
  const visibleMemoryEntries = hasSearchQuery ? searchedMemoryEntries : memoryEntries
  const modelLabel = status?.configuredModel ?? selectedModel?.id ?? config?.modelId ?? null
  const canEnable = Boolean(config?.profileId && config?.modelId)

  if (configLoading) {
    return null
  }

  return (
    <div className="flex flex-col gap-0">
      <SettingsSectionHeader
        title="Chronicle"
        description="Local screen activity capture, model-backed summaries, and searchable activity memories."
        action={(
          <Button type="button" variant="outline" size="sm" onClick={refreshChronicle}>
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
        )}
      />
      <SettingsDivider />

      <SettingsRow
        label="Capture"
        description={canEnable ? 'Start or stop the local Chronicle daemon' : 'Select a model before enabling Chronicle'}
      >
        <Switch
          checked={config?.enabled ?? false}
          onCheckedChange={enabled => void updateConfig({ enabled })}
          disabled={saving || !canEnable}
        />
      </SettingsRow>
      <SettingsDivider />

      <SettingsRow label="Model" description="Choose the profile and model used to crystallize activity memories">
        <ProviderModelPicker
          profiles={profiles}
          selectedProfileId={config?.profileId ?? null}
          selectedModelId={config?.modelId ?? null}
          selectedModel={selectedModel}
          modelsByProfileId={modelsByProfileId}
          loadingProfileIds={loadingProfileIds}
          thinkingValue={null}
          thinkingOptions={[]}
          emptyProfilesLabel="No agent profiles configured"
          emptySelectionLabel="Select a model"
          menuSide="bottom"
          menuAlign="end"
          triggerTestId="chronicle-provider-model-selector"
          disabled={saving}
          onSelectProfile={(profileId) => {
            const nextModel = (modelsByProfileId[profileId] ?? [])[0] ?? null
            void updateConfig({ profileId, modelId: nextModel?.id ?? '' })
          }}
          onSelectModel={(model, profileId) => {
            if (!model) {
              return
            }
            void updateConfig({ profileId, modelId: model })
          }}
          onSelectThinking={() => {}}
        />
      </SettingsRow>
      <SettingsDivider />

      <section className="py-4">
        <StatusPanel
          loading={statusLoading}
          running={status?.running ?? false}
          available={status?.available ?? false}
          pid={status?.pid ?? null}
          lastSummaryAt={status?.lastSummaryAt ?? null}
          lastExitAt={status?.lastExitAt ?? null}
          lastExitCode={status?.lastExitCode ?? null}
          totalSummaries={status?.totalSummaries ?? 0}
          totalMessages={status?.totalMessages ?? 0}
          lastMessageAt={status?.lastMessageAt ?? null}
          modelLabel={modelLabel}
          storageRoot={config?.storageRoot ?? null}
        />
      </section>

      <SettingsDivider />
      <SettingsSectionHeader
        title="Slack"
        description="Import selected Slack channel history into Chronicle memories."
        className="pt-4"
      />
      <section className="pb-4">
        <SlackSourcePanel loading={messageSourcesLoading} sources={messageSources} />
      </section>

      <SettingsDivider />
      <SettingsSectionHeader
        title="Local Model Resources"
        description="Chronicle-owned local resources used for sensing, audio, speakers, and embeddings."
        className="pt-4"
      />
      <section className="pb-4">
        <ResourceGrid loading={resourcesLoading} resources={resources} />
      </section>

      <SettingsDivider />
      <SettingsSectionHeader
        title="Timeline"
        description="Recent local captures with OCR context."
        className="pt-4"
      />
      <section className="pb-4">
        {timelineLoading
          ? <EmptyState icon={<ImageIcon className="size-4" />} title="Loading captures" />
          : timelineEntries.length === 0
            ? <EmptyState icon={<ImageIcon className="size-4" />} title="No captures yet" />
            : <TimelineScrubber entries={timelineEntries} />}
      </section>

      <SettingsDivider />
      <SettingsSectionHeader
        title="Memories"
        description="Generated activity memories and local memory search."
        className="pt-4"
      />
      <section className="flex flex-col gap-3 pb-4">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Search memories"
            className="h-9 pl-8 text-[13px]"
          />
        </div>
        {memoriesLoading || searchingMemories
          ? <EmptyState icon={<BrainIcon className="size-4" />} title="Loading memories" />
          : visibleMemoryEntries.length === 0
            ? (
                <EmptyState
                  icon={<BrainIcon className="size-4" />}
                  title={hasSearchQuery ? 'No matching memories' : 'No memories yet'}
                />
              )
            : <MemoryList entries={visibleMemoryEntries} />}
      </section>
    </div>
  )
}

interface StatusPanelProps {
  loading: boolean
  running: boolean
  available: boolean
  pid: number | null
  lastSummaryAt: string | number | null
  lastExitAt: string | number | null
  lastExitCode: number | null
  totalSummaries: number
  totalMessages: number
  lastMessageAt: string | number | null
  modelLabel: string | null
  storageRoot: string | null
}

function StatusPanel({
  loading,
  running,
  available,
  pid,
  lastSummaryAt,
  lastExitAt,
  lastExitCode,
  totalSummaries,
  totalMessages,
  lastMessageAt,
  modelLabel,
  storageRoot,
}: StatusPanelProps) {
  if (loading) {
    return <EmptyState icon={<ActivityIcon className="size-4" />} title="Loading status" />
  }

  return (
    <div className="rounded-lg border border-foreground/5 bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ActivityIcon className="size-3.5 text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">Runtime Status</span>
        <StatusBadge running={running} available={available} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatusItem
          icon={<EyeIcon className="size-3.5" />}
          label="Daemon"
          value={running ? `PID ${pid ?? 'unknown'}` : 'Stopped'}
        />
        <StatusItem
          icon={<ClockIcon className="size-3.5" />}
          label="Last memory"
          value={formatRelativeTime(lastSummaryAt)}
          detail={formatDateTime(lastSummaryAt)}
        />
        <StatusItem
          icon={<BrainIcon className="size-3.5" />}
          label="Memories"
          value={String(totalSummaries)}
        />
        <StatusItem
          icon={<MessageSquareIcon className="size-3.5" />}
          label="Slack"
          value={String(totalMessages)}
          detail={formatRelativeTime(lastMessageAt)}
        />
        <StatusItem
          icon={<CpuIcon className="size-3.5" />}
          label="Model"
          value={modelLabel ?? 'Not selected'}
        />
      </div>

      <div className="mt-3 grid gap-2 border-t border-foreground/5 pt-3 text-[12px] text-muted-foreground md:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2">
          <HardDriveIcon className="size-3.5 shrink-0" />
          <span className="truncate">{storageRoot ?? 'Storage root unavailable'}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 md:justify-end">
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {lastExitCode === null ? 'No daemon exit recorded' : `Last exit ${lastExitCode} at ${formatDateTime(lastExitAt)}`}
          </span>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ running, available }: { running: boolean, available: boolean }) {
  if (running) {
    return <Badge className="ml-auto bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Running</Badge>
  }
  if (available) {
    return <Badge variant="secondary" className="ml-auto">Ready</Badge>
  }
  return <Badge variant="outline" className="ml-auto">Not configured</Badge>
}

function SlackSourcePanel({ loading, sources }: { loading: boolean, sources: ChronicleMessageSource[] }) {
  const { saveSource, syncSource, saving, syncing } = useChronicleSlackSourceActions()
  const [draft, setDraft] = useState<ChronicleSlackSourceDraft>({
    label: 'Slack',
    token: '',
    channelIds: '',
    enabled: true,
  })
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null)
  const canSave = draft.label.trim().length > 0 && draft.token.trim().length > 0 && draft.channelIds.trim().length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-foreground/5 bg-background p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <MessageSquareIcon className="size-3.5 text-muted-foreground" />
          <span className="text-[13px] font-medium text-foreground">Slack Source</span>
          <Badge variant="outline" className="ml-auto text-[11px]">
            {sources.length === 0 ? 'Not connected' : `${sources.length} source${sources.length === 1 ? '' : 's'}`}
          </Badge>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <Input
            value={draft.label}
            onChange={event => setDraft(current => ({ ...current, label: event.target.value }))}
            placeholder="Source label"
            className="h-9 text-[13px]"
          />
          <Input
            value={draft.channelIds}
            onChange={event => setDraft(current => ({ ...current, channelIds: event.target.value }))}
            placeholder="Channel IDs, separated by comma"
            className="h-9 font-mono text-[13px]"
          />
        </div>

        <div className="mt-2 flex gap-2">
          <div className="relative min-w-0 flex-1">
            <KeyRoundIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={draft.token}
              type="password"
              onChange={event => setDraft(current => ({ ...current, token: event.target.value }))}
              placeholder="xoxb- Slack bot token"
              className="h-9 pl-8 font-mono text-[13px]"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canSave || saving}
            onClick={() => {
              void saveSource(draft).then(() => {
                setDraft({ label: 'Slack', token: '', channelIds: '', enabled: true })
              })
            }}
          >
            Save
          </Button>
        </div>

        <p className="mt-2 text-[12px] text-muted-foreground">
          Token values are stored in Cradle secrets; Chronicle stores only the secret reference and channel allowlist.
        </p>
      </div>

      {loading
        ? <EmptyState icon={<MessageSquareIcon className="size-4" />} title="Loading Slack sources" />
        : sources.length === 0
          ? <EmptyState icon={<MessageSquareIcon className="size-4" />} title="No Slack source configured" />
          : (
              <div className="flex flex-col gap-2">
                {sources.map(source => (
                  <div key={source.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-[13px] font-medium text-foreground">{source.label}</span>
                      <Badge variant="outline" className="ml-auto text-[11px]">{source.status}</Badge>
                    </div>
                    <div className="mt-2 grid gap-1 text-[12px] text-muted-foreground md:grid-cols-2">
                      <span className="truncate font-mono">{source.channelIds.join(', ') || 'No channels'}</span>
                      <span className="truncate md:text-right">
                        Last message
                        {' '}
                        {formatRelativeTime(source.lastMessageAt)}
                      </span>
                      {source.lastError && <span className="truncate text-destructive md:col-span-2">{source.lastError}</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={syncing || source.status === 'syncing'}
                        onClick={() => {
                          void syncSource(source.id).then((result) => {
                            setLastSyncMessage(`${result.message}; ${result.ingested} imported`)
                          })
                        }}
                      >
                        <RefreshCwIcon className="size-3.5" />
                        Sync
                      </Button>
                      <span className="text-[12px] text-muted-foreground">
                        Last sync
                        {' '}
                        {formatRelativeTime(source.lastSyncAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

      {lastSyncMessage && <p className="text-[12px] text-muted-foreground">{lastSyncMessage}</p>}
    </div>
  )
}

function ResourceGrid({ loading, resources }: { loading: boolean, resources: ChronicleModelResource[] }) {
  if (loading) {
    return <EmptyState icon={<CpuIcon className="size-4" />} title="Loading resources" />
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {resources.map(resource => (
        <ResourceItem key={resource.category} resource={resource} />
      ))}
    </div>
  )
}

function ResourceItem({ resource }: { resource: ChronicleModelResource }) {
  const tone = getResourceTone(resource)

  return (
    <div className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <ResourceIcon tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">{resource.label}</span>
            <ResourceBadge resource={resource} />
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
            {resource.message ?? resource.provider ?? 'Resource status is available from Chronicle runtime.'}
          </p>
          {resource.path && (
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70">{resource.path}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function ResourceIcon({ tone }: { tone: ReturnType<typeof getResourceTone> }) {
  return (
    <span
      className={cn(
        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md',
        {
          'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300': tone === 'ready',
          'bg-muted text-muted-foreground': tone === 'optional',
          'bg-amber-500/10 text-amber-700 dark:text-amber-300': tone === 'warning' || tone === 'loading',
          'bg-destructive/10 text-destructive': tone === 'error',
        },
      )}
    >
      {tone === 'ready' ? <CheckCircle2Icon className="size-3.5" /> : <CpuIcon className="size-3.5" />}
    </span>
  )
}

function ResourceBadge({ resource }: { resource: ChronicleModelResource }) {
  const tone = getResourceTone(resource)

  return (
    <Badge
      variant="outline"
      className={cn(
        'ml-auto text-[11px]',
        {
          'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300': tone === 'ready',
          'border-foreground/10 bg-muted text-muted-foreground': tone === 'optional',
          'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300': tone === 'warning' || tone === 'loading',
          'border-destructive/20 bg-destructive/10 text-destructive': tone === 'error',
        },
      )}
    >
      {getResourceStateLabel(resource)}
    </Badge>
  )
}

function TimelineScrubber({ entries }: { entries: TimelineEntry[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const seekRef = useRef<HTMLDivElement>(null)
  const serverUrl = getServerUrl()

  const frameUrl = useCallback(
    (entry: TimelineEntry) => `${serverUrl}/chronicle/snapshots/${encodeURIComponent(entry.id)}/frame`,
    [serverUrl],
  )

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      setSelectedIndex(index => Math.min(index + 1, entries.length - 1))
    }
    else if (event.key === 'ArrowRight') {
      setSelectedIndex(index => Math.max(index - 1, 0))
    }
  }, [entries.length])

  const getIndexFromMouseEvent = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const element = seekRef.current
    if (!element) {
      return null
    }

    const rect = element.getBoundingClientRect()
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width))
    const ratio = x / rect.width
    const index = Math.round((1 - ratio) * (entries.length - 1))
    return Math.max(0, Math.min(entries.length - 1, index))
  }, [entries.length])

  const selected = entries[selectedIndex]
  if (!selected) {
    return null
  }

  const displayEntry = hoverIndex !== null ? entries[hoverIndex] : selected
  const startTime = new Date(entries.at(-1)?.capturedAt ?? selected.capturedAt)
  const endTime = new Date(entries[0].capturedAt)

  return (
    <div className="flex flex-col gap-3 outline-none" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="overflow-hidden rounded-lg bg-black shadow-sm">
        {displayEntry?.sourceType === 'message'
          ? (
              <div className="flex aspect-video items-center justify-center bg-background px-6 text-foreground">
                <div className="max-w-xl rounded-lg border border-foreground/5 bg-muted/40 p-4">
                  <div className="mb-2 flex min-w-0 items-center gap-2">
                    <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-[13px] font-medium">
                      {displayEntry.channelName ? `#${displayEntry.channelName}` : displayEntry.channelId ?? 'Slack'}
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{displayEntry.userName ?? 'unknown'}</span>
                  </div>
                  <p className="line-clamp-5 text-[14px] leading-6">{displayEntry.ocrText}</p>
                </div>
              </div>
            )
          : displayEntry?.framePath
          ? (
              <img
                src={frameUrl(displayEntry)}
                alt={`Capture at ${formatDateTime(displayEntry.capturedAt)}`}
                className="aspect-video w-full object-contain outline outline-1 -outline-offset-1 outline-white/10"
              />
            )
          : (
              <div className="flex aspect-video items-center justify-center text-[13px] text-white/60">
                Frame unavailable
              </div>
            )}
      </div>

      <div className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
        <div className="mb-3 flex min-w-0 items-center gap-2">
          {displayEntry?.sourceType === 'message'
            ? <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
            : <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate text-[13px] font-medium text-foreground">
            {displayEntry?.sourceType === 'message'
              ? displayEntry.channelName ? `#${displayEntry.channelName}` : displayEntry.channelId ?? 'Slack message'
              : displayEntry?.appName ?? displayEntry?.windowTitle ?? 'Screen capture'}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
            {formatDateTime(displayEntry?.capturedAt ?? selected.capturedAt)}
          </span>
        </div>

        <div
          ref={seekRef}
          className="relative h-10 cursor-pointer overflow-visible"
          onClick={(event) => {
            const index = getIndexFromMouseEvent(event)
            if (index !== null) {
              setSelectedIndex(index)
            }
          }}
          onMouseMove={(event) => {
            setHoverIndex(getIndexFromMouseEvent(event))
          }}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <div className="absolute inset-x-0 bottom-2 h-2 overflow-hidden rounded-full bg-foreground/15">
            <div
              className="h-full rounded-full bg-foreground/40 transition-[width] duration-150"
              style={{ width: `${entries.length > 1 ? ((entries.length - 1 - selectedIndex) / (entries.length - 1)) * 100 : 100}%` }}
            />
          </div>

          {hoverIndex !== null && (
            <div
              className="absolute bottom-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground/60"
              style={{ left: `${entries.length > 1 ? ((entries.length - 1 - hoverIndex) / (entries.length - 1)) * 100 : 50}%` }}
            />
          )}

          <div
            className="absolute bottom-1 -translate-x-1/2 transition-[left] duration-150"
            style={{ left: `${entries.length > 1 ? ((entries.length - 1 - selectedIndex) / (entries.length - 1)) * 100 : 50}%` }}
          >
            <div className="size-3.5 rounded-full bg-foreground shadow-sm" />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-muted-foreground/50">{startTime.toLocaleTimeString()}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{endTime.toLocaleTimeString()}</span>
        </div>

        {displayEntry?.ocrText && (
          <p className="mt-3 line-clamp-3 rounded-md bg-muted/50 px-2 py-1.5 text-[12px] text-muted-foreground">
            {displayEntry.ocrText}
          </p>
        )}
      </div>
    </div>
  )
}

function MemoryList({ entries }: { entries: MemoryEntry[] }) {
  return (
    <div className="flex flex-col gap-2">
      {entries.map(entry => (
        <MemoryCard key={entry.id} entry={entry} />
      ))}
    </div>
  )
}

function MemoryCard({ entry }: { entry: MemoryEntry }) {
  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <BrainIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">{entry.title ?? 'Activity memory'}</span>
        <Badge variant="secondary" className="ml-auto text-[11px]">{entry.type}</Badge>
      </div>
      <p className="line-clamp-4 text-[13px] leading-5 text-foreground">{entry.content}</p>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="font-mono">{formatDateTime(entry.createdAt)}</span>
        {entry.sourceCount !== null && (
<span>
{entry.sourceCount}
{' '}
sources
</span>
)}
      </div>
    </article>
  )
}

function StatusItem({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <span className="mt-1 block truncate text-[13px] font-medium tabular-nums text-foreground">{value}</span>
      {detail && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/70">{detail}</span>}
    </div>
  )
}

function EmptyState({ icon, title }: { icon: ReactNode, title: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-foreground/10 bg-muted/20 px-4 py-6 text-muted-foreground">
      <div className="flex items-center gap-2 text-[13px]">
        {icon}
        <span>{title}</span>
      </div>
    </div>
  )
}
