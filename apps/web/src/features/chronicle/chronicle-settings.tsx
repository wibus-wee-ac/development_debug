import {
  ActivityIcon,
  BrainIcon,
  CheckCircle2Icon,
  ClockIcon,
  CpuIcon,
  DownloadIcon,
  EyeIcon,
  FileAudioIcon,
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
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { useAgentModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import { SettingsDivider, SettingsRow, SettingsSectionHeader } from '~/features/settings/settings-row'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'

import type {
  ChronicleAccessibilitySnapshot,
  ChronicleActivitySegment,
  ChronicleAudioRawSegment,
  ChronicleAudioTranscript,
  ChronicleDreamRun,
  ChronicleKnowledgeCard,
  ChronicleMessageSource,
  ChronicleModelResource,
  ChroniclePipelineRun,
  ChronicleSlackSourceDraft,
  ChronicleStatus,
  MemoryEntry,
  TimelineEntry,
} from './use-chronicle.ts'
import {
  useChronicleAccessibilitySnapshots,
  useChronicleActivityPipelineActions,
  useChronicleActivitySegments,
  useChronicleAudioRawSegments,
  useChronicleAudioTranscripts,
  useChronicleConfig,
  useChronicleDownloadProgress,
  useChronicleDreamActions,
  useChronicleDreamRuns,
  useChronicleKnowledgeCards,
  useChronicleMemories,
  useChronicleMemorySearch,
  useChronicleMessageSources,
  useChronicleModelResourceActions,
  useChronicleModelResources,
  useChroniclePipelineRuns,
  useChronicleSlackSourceActions,
  useChronicleStatus,
  useChronicleTimeline,
  useRefreshChronicleQueries,
} from './use-chronicle.ts'

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

function hasVerifiedManifestDownload(resource: ChronicleModelResource): boolean {
  const manifest = readRecord(resource.metadata?.manifest)
  const files = Array.isArray(manifest?.files) ? manifest.files : []
  return files.length > 0 && files.every((file) => {
    const item = readRecord(file)
    return typeof item?.sourceUrl === 'string'
  })
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
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
  const { snapshots: accessibilitySnapshots, loading: accessibilitySnapshotsLoading } = useChronicleAccessibilitySnapshots()
  const { transcripts: audioTranscripts, loading: audioTranscriptsLoading } = useChronicleAudioTranscripts()
  const { segments: audioRawSegments, loading: audioRawSegmentsLoading } = useChronicleAudioRawSegments()
  const { segments: activitySegments, loading: activitySegmentsLoading } = useChronicleActivitySegments()
  const { runs: pipelineRuns, loading: pipelineRunsLoading } = useChroniclePipelineRuns()
  const { cards: knowledgeCards, loading: knowledgeCardsLoading } = useChronicleKnowledgeCards()
  const { runs: dreamRuns, loading: dreamRunsLoading } = useChronicleDreamRuns()
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

      <SettingsRow
        label="Activity Pipeline"
        description={config?.enabled
          ? 'Automatically triage, summarize, and crystallize activity segments'
          : 'Enable Chronicle before starting automatic activity processing'}
      >
        <Switch
          checked={config?.activityPipelineEnabled ?? true}
          onCheckedChange={activityPipelineEnabled => void updateConfig({ activityPipelineEnabled })}
          disabled={saving || !config?.enabled}
        />
      </SettingsRow>
      <SettingsDivider />

      <SettingsRow
        label="Background Audio"
        description={config?.enabled
          ? 'Capture local microphone segments as Chronicle artifacts; transcripts still require ASR runtime'
          : 'Enable Chronicle before starting background audio capture'}
      >
        <Switch
          checked={config?.audioCaptureEnabled ?? false}
          onCheckedChange={audioCaptureEnabled => void updateConfig({ audioCaptureEnabled })}
          disabled={saving || !config?.enabled}
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
          totalAccessibilitySnapshots={status?.totalAccessibilitySnapshots ?? 0}
          lastAccessibilitySnapshotAt={status?.lastAccessibilitySnapshotAt ?? null}
          totalAudioTranscripts={status?.totalAudioTranscripts ?? 0}
          lastAudioTranscriptAt={status?.lastAudioTranscriptAt ?? null}
          totalAudioRawSegments={status?.totalAudioRawSegments ?? 0}
          lastAudioRawSegmentAt={status?.lastAudioRawSegmentAt ?? null}
          totalActivitySegments={status?.totalActivitySegments ?? 0}
          totalPipelineRuns={status?.totalPipelineRuns ?? 0}
          totalKnowledgeCards={status?.totalKnowledgeCards ?? 0}
          totalDreamRuns={status?.totalDreamRuns ?? 0}
          activityPipelineEnabled={status?.activityPipelineEnabled ?? config?.activityPipelineEnabled ?? true}
          activityPipelineRunning={status?.activityPipelineRunning ?? false}
          activityPipelineIntervalMs={status?.activityPipelineIntervalMs ?? config?.activityPipelineIntervalMs ?? 120_000}
          activityPipelineBatchSize={status?.activityPipelineBatchSize ?? config?.activityPipelineBatchSize ?? 3}
          audioCaptureEnabled={status?.audioCaptureEnabled ?? config?.audioCaptureEnabled ?? false}
          audioRuntimeStatus={status?.audioRuntimeStatus ?? 'disabled'}
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
        title="Accessibility"
        description="Recent local window and accessibility evidence captured with screen frames."
        className="pt-4"
      />
      <section className="pb-4">
        {accessibilitySnapshotsLoading
          ? <EmptyState icon={<EyeIcon className="size-4" />} title="Loading accessibility evidence" />
          : accessibilitySnapshots.length === 0
            ? <EmptyState icon={<EyeIcon className="size-4" />} title="No accessibility evidence yet" />
            : <AccessibilitySnapshotList snapshots={accessibilitySnapshots} />}
      </section>

      <SettingsDivider />
      <SettingsSectionHeader
        title="Audio Segments"
        description="Recent microphone segment artifacts captured before VAD, ASR, or speaker processing."
        className="pt-4"
      />
      <section className="pb-4">
        {audioRawSegmentsLoading
          ? <EmptyState icon={<FileAudioIcon className="size-4" />} title="Loading audio segments" />
          : audioRawSegments.length === 0
            ? <EmptyState icon={<FileAudioIcon className="size-4" />} title="No raw audio segments yet" />
            : <AudioRawSegmentList segments={audioRawSegments} />}
      </section>

      <SettingsDivider />
      <SettingsSectionHeader
        title="Meeting Transcripts"
        description="Audio transcript reports imported into Chronicle memory."
        className="pt-4"
      />
      <section className="pb-4">
        {audioTranscriptsLoading
          ? <EmptyState icon={<FileAudioIcon className="size-4" />} title="Loading transcripts" />
          : audioTranscripts.length === 0
            ? <EmptyState icon={<FileAudioIcon className="size-4" />} title="No transcripts yet" />
            : <AudioTranscriptList transcripts={audioTranscripts} />}
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
        title="Activity Segments"
        description="Grouped activity windows and the pipeline runs that created them."
        className="pt-4"
      />
      <section className="pb-4">
        {activitySegmentsLoading || pipelineRunsLoading
          ? <EmptyState icon={<ActivityIcon className="size-4" />} title="Loading activity pipeline" />
          : activitySegments.length === 0
            ? <EmptyState icon={<ActivityIcon className="size-4" />} title="No activity segments yet" />
            : <ActivityPipelinePanel segments={activitySegments} runs={pipelineRuns} />}
      </section>

      <SettingsDivider />
      <SettingsSectionHeader
        title="Knowledge Cards"
        description="Durable cards crystallized from summarized activity segments."
        className="pt-4"
      />
      <section className="pb-4">
        {knowledgeCardsLoading
          ? <EmptyState icon={<BrainIcon className="size-4" />} title="Loading knowledge cards" />
          : knowledgeCards.length === 0
            ? <EmptyState icon={<BrainIcon className="size-4" />} title="No knowledge cards yet" />
            : <KnowledgeCardList cards={knowledgeCards} />}
      </section>

      <SettingsDivider />
      <SettingsSectionHeader
        title="Dream Merge Dry Run"
        description="Recorded lexical merge candidates for knowledge cards; this does not mutate cards."
        className="pt-4"
      />
      <section className="pb-4">
        <DreamRunPanel loading={dreamRunsLoading} runs={dreamRuns} />
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
  totalAccessibilitySnapshots: number
  lastAccessibilitySnapshotAt: string | number | null
  totalAudioTranscripts: number
  lastAudioTranscriptAt: string | number | null
  totalAudioRawSegments: number
  lastAudioRawSegmentAt: string | number | null
  totalActivitySegments: number
  totalPipelineRuns: number
  totalKnowledgeCards: number
  totalDreamRuns: number
  activityPipelineEnabled: boolean
  activityPipelineRunning: boolean
  activityPipelineIntervalMs: number
  activityPipelineBatchSize: number
  audioCaptureEnabled: boolean
  audioRuntimeStatus: ChronicleStatus['audioRuntimeStatus']
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
  totalAccessibilitySnapshots,
  lastAccessibilitySnapshotAt,
  totalAudioTranscripts,
  lastAudioTranscriptAt,
  totalAudioRawSegments,
  lastAudioRawSegmentAt,
  totalActivitySegments,
  totalPipelineRuns,
  totalKnowledgeCards,
  totalDreamRuns,
  activityPipelineEnabled,
  activityPipelineRunning,
  activityPipelineIntervalMs,
  activityPipelineBatchSize,
  audioCaptureEnabled,
  audioRuntimeStatus,
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-10 xl:grid-cols-11">
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
          icon={<EyeIcon className="size-3.5" />}
          label="AX"
          value={String(totalAccessibilitySnapshots)}
          detail={formatRelativeTime(lastAccessibilitySnapshotAt)}
        />
        <StatusItem
          icon={<FileAudioIcon className="size-3.5" />}
          label="Transcripts"
          value={String(totalAudioTranscripts)}
          detail={formatRelativeTime(lastAudioTranscriptAt)}
        />
        <StatusItem
          icon={<FileAudioIcon className="size-3.5" />}
          label="Audio"
          value={String(totalAudioRawSegments)}
          detail={audioCaptureEnabled ? formatRelativeTime(lastAudioRawSegmentAt) : formatAudioRuntimeStatus(audioRuntimeStatus)}
        />
        <StatusItem
          icon={<ActivityIcon className="size-3.5" />}
          label="Activity"
          value={String(totalActivitySegments)}
        />
        <StatusItem
          icon={<CpuIcon className="size-3.5" />}
          label="Pipeline"
          value={String(totalPipelineRuns)}
        />
        <StatusItem
          icon={<BrainIcon className="size-3.5" />}
          label="Knowledge"
          value={String(totalKnowledgeCards)}
        />
        <StatusItem
          icon={<ClockIcon className="size-3.5" />}
          label="Dream"
          value={String(totalDreamRuns)}
        />
      </div>

      <div className="mt-3 grid gap-2 border-t border-foreground/5 pt-3 text-[12px] text-muted-foreground md:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2">
          <HardDriveIcon className="size-3.5 shrink-0" />
          <span className="truncate">{storageRoot ?? 'Storage root unavailable'}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 md:justify-end">
          <CpuIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {activityPipelineEnabled
              ? `Pipeline ${activityPipelineRunning ? 'running' : 'ready'} · ${Math.round(activityPipelineIntervalMs / 1000)}s · ${activityPipelineBatchSize}/tick`
              : 'Pipeline disabled'}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <CpuIcon className="size-3.5 shrink-0" />
          <span className="truncate">{modelLabel ?? 'No model selected'}</span>
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

function formatAudioRuntimeStatus(status: ChronicleStatus['audioRuntimeStatus']): string {
  if (status === 'armed') {
    return 'Armed'
  }
  if (status === 'unavailable') {
    return 'Unavailable'
  }
  return 'Disabled'
}

function formatSlackRealtimeMode(mode: ChronicleMessageSource['realtimeMode']): string {
  if (mode === 'events-api') {
    return 'Events API'
  }
  if (mode === 'socket-mode') {
    return 'Socket Mode'
  }
  return 'Polling'
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
    signingSecret: '',
    channelIds: '',
    enabled: true,
    realtimeMode: 'events-api',
  })
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null)
  const canSave = draft.label.trim().length > 0
    && draft.token.trim().length > 0
    && draft.channelIds.trim().length > 0
    && (draft.realtimeMode !== 'events-api' || draft.signingSecret.trim().length > 0)

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

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={draft.realtimeMode}
            onValueChange={(value) => {
              if (value === 'polling' || value === 'events-api') {
                setDraft(current => ({ ...current, realtimeMode: value }))
              }
            }}
            variant="outline"
            size="sm"
            spacing={0}
          >
            <ToggleGroupItem value="events-api" aria-label="Slack Events API" className="h-8 px-2 text-[12px]">
              Events API
            </ToggleGroupItem>
            <ToggleGroupItem value="polling" aria-label="Slack polling" className="h-8 px-2 text-[12px]">
              Polling
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="text-[12px] text-muted-foreground">
            {draft.realtimeMode === 'events-api' ? 'Realtime events with polling fallback' : 'Background polling only'}
          </span>
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
          {draft.realtimeMode === 'events-api' && (
            <div className="relative min-w-0 flex-1">
              <KeyRoundIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={draft.signingSecret}
                type="password"
                onChange={event => setDraft(current => ({ ...current, signingSecret: event.target.value }))}
                placeholder="Slack signing secret"
                className="h-9 pl-8 font-mono text-[13px]"
              />
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canSave || saving}
            onClick={() => {
              void saveSource(draft).then(() => {
                setDraft({ label: 'Slack', token: '', signingSecret: '', channelIds: '', enabled: true, realtimeMode: 'events-api' })
              })
            }}
          >
            Save
          </Button>
        </div>

        <p className="mt-2 text-[12px] text-muted-foreground">
          Token and signing secret values are stored in Cradle secrets; Chronicle stores only secret references and channel allowlist.
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
                      <span className="truncate">
                        Mode
                        {' '}
                        {formatSlackRealtimeMode(source.realtimeMode)}
                      </span>
                      <span className="truncate font-mono md:text-right">
                        {source.realtimeMode === 'events-api'
                          ? `${getServerUrl()}/chronicle/message-sources/${source.id}/slack/events`
                          : 'Polling fallback active'}
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
  const {
    reconcileResources,
    installAllResources,
    verifyResource,
    installResource,
    reconciling,
    installingAll,
    verifying,
    installing,
  } = useChronicleModelResourceActions()
  const downloadProgress = useChronicleDownloadProgress(installingAll || installing)

  if (loading) {
    return <EmptyState icon={<CpuIcon className="size-4" />} title="Loading resources" />
  }

  const busy = reconciling || installingAll || verifying || installing

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-1.5">
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={busy}
          onClick={() => void installAllResources()}
        >
          <DownloadIcon className="size-3.5" />
          Install All
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void reconcileResources()}
        >
          <RefreshCwIcon className="size-3.5" />
          Reconcile
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {resources.map(resource => (
          <ResourceItem
            key={resource.category}
            resource={resource}
            busy={busy || resource.state === 'installing'}
            installResource={installResource}
            verifyResource={verifyResource}
            downloadProgress={downloadProgress}
          />
        ))}
      </div>
    </div>
  )
}

function ResourceItem({
  resource,
  busy,
  installResource,
  verifyResource,
  downloadProgress,
}: {
  resource: ChronicleModelResource
  busy: boolean
  installResource: ReturnType<typeof useChronicleModelResourceActions>['installResource']
  verifyResource: ReturnType<typeof useChronicleModelResourceActions>['verifyResource']
  downloadProgress: ReturnType<typeof useChronicleDownloadProgress>
}) {
  const tone = getResourceTone(resource)
  const [message, setMessage] = useState<string | null>(null)
  const canInstall = resource.category !== 'ocr'
  const canDownload = canInstall && hasVerifiedManifestDownload(resource)

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
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {resource.version && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{resource.version}</span>
            )}
            {resource.sizeBytes !== null && resource.sizeBytes > 0 && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {(resource.sizeBytes / 1024 / 1024).toFixed(1)}
                {' '}
                MB
              </span>
            )}
          </div>
          {canInstall && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {canDownload && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={busy}
                  onClick={() => {
                    setMessage(null)
                    void installResource({ category: resource.category, source: 'manifest' }).then((updated) => {
                      setMessage(updated?.message ?? 'Resource downloaded')
                    })
                  }}
                >
                  <DownloadIcon className="size-3" />
                  Download
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => {
                  setMessage(null)
                  void verifyResource(resource.category).then((updated) => {
                    setMessage(updated?.message ?? 'Resource verified')
                  })
                }}
              >
                <RefreshCwIcon className="size-3" />
                Verify
              </Button>
            </div>
          )}
          {message && <p className="mt-1 text-[11px] text-muted-foreground">{message}</p>}
          {downloadProgress[resource.category] && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Download progress:
{' '}
{downloadProgress[resource.category]}
%
            </p>
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
        {displayEntry?.sourceType === 'audio'
          ? (
              <div className="flex aspect-video items-center justify-center bg-background px-6 text-foreground">
                <div className="max-w-xl rounded-lg border border-foreground/5 bg-muted/40 p-4">
                  <div className="mb-2 flex min-w-0 items-center gap-2">
                    <FileAudioIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-[13px] font-medium">
                      {displayEntry.channelName ?? displayEntry.windowTitle ?? 'Audio transcript'}
                    </span>
                  </div>
                  <p className="line-clamp-5 text-[14px] leading-6">{displayEntry.ocrText}</p>
                </div>
              </div>
            )
          : displayEntry?.sourceType === 'message'
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
                className="aspect-video w-full object-contain outline-solid outline-1 -outline-offset-1 outline-white/10"
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
          {displayEntry?.sourceType === 'audio'
            ? <FileAudioIcon className="size-3.5 shrink-0 text-muted-foreground" />
            : displayEntry?.sourceType === 'message'
            ? <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
            : <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate text-[13px] font-medium text-foreground">
            {displayEntry?.sourceType === 'audio'
              ? displayEntry.channelName ?? displayEntry.windowTitle ?? 'Audio transcript'
              : displayEntry?.sourceType === 'message'
              ? displayEntry.channelName ? `#${displayEntry.channelName}` : displayEntry.channelId ?? 'Slack message'
              : displayEntry?.appBundleId ?? displayEntry?.windowTitle ?? 'Screen capture'}
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

function ActivityPipelinePanel({
  segments,
  runs,
}: {
  segments: ChronicleActivitySegment[]
  runs: ChroniclePipelineRun[]
}) {
  const { triageSegment, summarizeSegment, crystallizeSegment, runPipelineTick, triaging, summarizing, crystallizing, ticking } = useChronicleActivityPipelineActions()
  const busy = triaging || summarizing || crystallizing || ticking

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {segments.map(segment => (
          <ActivitySegmentCard
            key={segment.id}
            segment={segment}
            busy={busy}
            onTriage={() => void triageSegment(segment.id)}
            onSummarize={() => void summarizeSegment(segment.id)}
            onCrystallize={() => void crystallizeSegment(segment.id)}
          />
        ))}
      </div>
      <div className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <CpuIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[13px] font-medium text-foreground">Pipeline Runs</span>
          <Badge variant="outline" className="ml-auto text-[11px]">{runs.length}</Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void runPipelineTick()}
          >
            <RefreshCwIcon className="size-3.5" />
            Tick
          </Button>
        </div>
        {runs.length === 0
          ? (
              <p className="text-[12px] text-muted-foreground">No pipeline runs yet.</p>
            )
          : (
              <div className="flex flex-col gap-1.5">
                {runs.slice(0, 8).map(run => (
                  <div key={run.id} className="rounded-md bg-muted/40 px-2.5 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[12px] font-medium text-foreground">
                        {formatPipelineTrigger(run.trigger)}
                      </span>
                      <Badge
                        variant={run.status === 'success' ? 'secondary' : 'outline'}
                        className={cn(
                          'ml-auto text-[11px]',
                          {
                            'border-destructive/20 bg-destructive/10 text-destructive': run.status === 'error',
                            'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300': run.status === 'queued' || run.status === 'running',
                          },
                        )}
                      >
                        {run.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{formatPipelineStage(run.stage)}</span>
                      <span className="shrink-0 font-mono">{formatRelativeTime(run.startedAt)}</span>
                    </div>
                    {run.errorMessage && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-destructive">{run.errorMessage}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
      </div>
    </div>
  )
}

function ActivitySegmentCard({
  segment,
  busy,
  onTriage,
  onSummarize,
  onCrystallize,
}: {
  segment: ChronicleActivitySegment
  busy: boolean
  onTriage: () => void
  onSummarize: () => void
  onCrystallize: () => void
}) {
  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <ActivityIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">
          {segment.title ?? segment.frontApp ?? 'Activity segment'}
        </span>
        <Badge variant="outline" className="ml-auto text-[11px]">
          {formatActivitySegmentType(segment.segmentType)}
        </Badge>
      </div>
      <p className="line-clamp-3 min-h-15 text-[13px] leading-5 text-foreground">
        {segment.summary ?? 'This segment is collecting source evidence.'}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">{formatDateTime(segment.startedAt)}</span>
        <span className="truncate text-right">{formatDurationSeconds(segment.durationSeconds)}</span>
        <span className="truncate">{segment.frontApp ?? 'Unknown app'}</span>
        <span className="truncate text-right">{formatActivityPipelineStatus(segment.pipelineStatus)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <ActivitySourceBadge label="Frames" value={segment.sourceCounts.snapshotIds ?? 0} />
        <ActivitySourceBadge label="Slack" value={segment.sourceCounts.messageIds ?? 0} />
        <ActivitySourceBadge label="Audio" value={segment.sourceCounts.audioRawSegmentIds ?? 0} />
        <ActivitySourceBadge label="Transcripts" value={segment.sourceCounts.audioTranscriptIds ?? 0} />
        <ActivitySourceBadge label="Memories" value={segment.sourceCounts.memoryIds ?? 0} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || segment.pipelineStatus === 'summarized' || segment.pipelineStatus === 'crystallized'}
          onClick={onTriage}
        >
          <CpuIcon className="size-3.5" />
          Triage
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || segment.pipelineStatus === 'summarized' || segment.pipelineStatus === 'crystallized'}
          onClick={onSummarize}
        >
          <BrainIcon className="size-3.5" />
          Summarize
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || segment.pipelineStatus === 'crystallized'}
          onClick={onCrystallize}
        >
          <CheckCircle2Icon className="size-3.5" />
          Crystallize
        </Button>
      </div>
    </article>
  )
}

function ActivitySourceBadge({ label, value }: { label: string, value: number }) {
  if (value <= 0) {
    return null
  }
  return (
    <Badge variant="secondary" className="text-[11px]">
      {label}
      {' '}
      {value}
    </Badge>
  )
}

function formatActivitySegmentType(type: ChronicleActivitySegment['segmentType']): string {
  if (type === 'meeting') {
    return 'Meeting'
  }
  if (type === 'browsing') {
    return 'Browsing'
  }
  if (type === 'chat') {
    return 'Chat'
  }
  if (type === 'audio') {
    return 'Audio'
  }
  if (type === 'idle') {
    return 'Idle'
  }
  if (type === 'work') {
    return 'Work'
  }
  return 'Unknown'
}

function formatActivityPipelineStatus(status: ChronicleActivitySegment['pipelineStatus']): string {
  if (status === 'triaged') {
    return 'Triaged'
  }
  if (status === 'summarized') {
    return 'Summarized'
  }
  if (status === 'crystallized') {
    return 'Crystallized'
  }
  if (status === 'error') {
    return 'Error'
  }
  return 'Collecting'
}

function formatPipelineTrigger(trigger: ChroniclePipelineRun['trigger']): string {
  if (trigger === 'audio-raw') {
    return 'Raw audio'
  }
  if (trigger === 'audio-transcript') {
    return 'Transcript'
  }
  if (trigger === 'message') {
    return 'Slack message'
  }
  if (trigger === 'memory') {
    return 'Memory'
  }
  if (trigger === 'summarize') {
    return 'Summary'
  }
  if (trigger === 'manual') {
    return 'Manual'
  }
  return 'Snapshot'
}

function formatPipelineStage(stage: ChroniclePipelineRun['stage']): string {
  if (stage === 'collection') {
    return 'Collection'
  }
  if (stage === 'triage') {
    return 'Triage'
  }
  if (stage === 'summarization') {
    return 'Summarization'
  }
  if (stage === 'crystallization') {
    return 'Crystallization'
  }
  return 'Segmentation'
}

function formatDurationSeconds(value: number): string {
  if (value < 60) {
    return `${Math.max(0, Math.floor(value))}s`
  }
  const minutes = Math.floor(value / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`
}

function formatKnowledgeCardType(type: ChronicleKnowledgeCard['cardType']): string {
  if (type === 'insight') {
    return 'Insight'
  }
  if (type === 'decision') {
    return 'Decision'
  }
  if (type === 'task') {
    return 'Task'
  }
  if (type === 'pattern') {
    return 'Pattern'
  }
  return 'Fact'
}

function formatKnowledgeDimension(dimension: ChronicleKnowledgeCard['dimension']): string {
  if (dimension === 'technical') {
    return 'Technical'
  }
  if (dimension === 'business') {
    return 'Business'
  }
  if (dimension === 'personal') {
    return 'Personal'
  }
  if (dimension === 'project') {
    return 'Project'
  }
  return 'General'
}

function formatDreamRunType(type: ChronicleDreamRun['runType']): string {
  if (type === 'merge') {
    return 'Merge'
  }
  if (type === 'archive') {
    return 'Archive'
  }
  if (type === 'prune') {
    return 'Prune'
  }
  if (type === 'restore') {
    return 'Restore'
  }
  return 'Dry run'
}

function readCandidateCount(run: ChronicleDreamRun): number {
  const count = run.result.candidateCount
  return typeof count === 'number' && Number.isFinite(count) ? count : run.outputCount
}

function readVectorMode(run: ChronicleDreamRun): string {
  const mode = run.result.vectorMode ?? run.config.vectorMode
  return typeof mode === 'string' && mode.length > 0 ? mode : 'chronicle-lexical/v1'
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

function KnowledgeCardList({ cards }: { cards: ChronicleKnowledgeCard[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {cards.map(card => (
        <article key={card.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <BrainIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[13px] font-medium text-foreground">{card.title}</span>
            <Badge variant="outline" className="ml-auto text-[11px]">{formatKnowledgeDimension(card.dimension)}</Badge>
          </div>
          <p className="line-clamp-4 min-h-20 text-[13px] leading-5 text-foreground">{card.content}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="text-[11px]">{formatKnowledgeCardType(card.cardType)}</Badge>
            <Badge variant="outline" className="text-[11px]">
              v
              {card.version}
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {Math.round(card.confidence * 100)}
              %
            </Badge>
            {card.status !== 'active' && <Badge variant="outline" className="text-[11px]">{card.status}</Badge>}
            {card.tags.slice(0, 4).map(tag => <Badge key={tag} variant="outline" className="text-[11px]">{tag}</Badge>)}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span className="truncate">
              {card.sourceSegmentIds.length}
              {' '}
              segments
            </span>
            <span className="shrink-0 font-mono">{formatRelativeTime(card.updatedAt)}</span>
          </div>
        </article>
      ))}
    </div>
  )
}

function DreamRunPanel({ loading, runs }: { loading: boolean, runs: ChronicleDreamRun[] }) {
  const { startDreamDryRun, startingDryRun } = useChronicleDreamActions()

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[13px] font-medium text-foreground">Merge Candidates</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={startingDryRun}
            onClick={() => void startDreamDryRun()}
          >
            <RefreshCwIcon className="size-3.5" />
            Dry Run
          </Button>
        </div>
      </div>

      {loading
        ? <EmptyState icon={<ClockIcon className="size-4" />} title="Loading dream runs" />
        : runs.length === 0
          ? <EmptyState icon={<ClockIcon className="size-4" />} title="No dream dry runs yet" />
          : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {runs.slice(0, 8).map(run => (
                  <article key={run.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
                    <div className="mb-2 flex min-w-0 items-center gap-2">
                      <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-[13px] font-medium text-foreground">{formatDreamRunType(run.runType)}</span>
                      <Badge
                        variant={run.status === 'completed' ? 'secondary' : 'outline'}
                        className={cn(
                          'ml-auto text-[11px]',
                          { 'border-destructive/20 bg-destructive/10 text-destructive': run.status === 'failed' },
                        )}
                      >
                        {run.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                      <span>
                        Input
                        {' '}
                        {run.inputCount}
                      </span>
                      <span>
                        Candidates
                        {' '}
                        {readCandidateCount(run)}
                      </span>
                      <span>
                        Merged
                        {' '}
                        {run.mergedCount}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{readVectorMode(run)}</span>
                      <span className="shrink-0 font-mono">{formatRelativeTime(run.startedAt)}</span>
                    </div>
                    {run.errorMessage && <p className="mt-1 line-clamp-2 text-[11px] text-destructive">{run.errorMessage}</p>}
                  </article>
                ))}
              </div>
            )}
    </div>
  )
}

function AccessibilitySnapshotList({ snapshots }: { snapshots: ChronicleAccessibilitySnapshot[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {snapshots.map(snapshot => (
        <article key={snapshot.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <EyeIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[13px] font-medium text-foreground">
              {snapshot.windowTitle ?? snapshot.appBundleId ?? 'Accessibility evidence'}
            </span>
            <Badge
              variant={snapshot.status === 'ready' ? 'secondary' : 'outline'}
              className={cn(
                'ml-auto text-[11px]',
                {
                  'border-destructive/20 bg-destructive/10 text-destructive': snapshot.status === 'error',
                  'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300': snapshot.status === 'permission-denied',
                },
              )}
            >
              {formatAccessibilityStatus(snapshot.status)}
            </Badge>
          </div>
          <p className="line-clamp-4 text-[13px] leading-5 text-foreground">
            {snapshot.text ?? 'No accessibility text was captured.'}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
            <span className="truncate font-mono">{formatDateTime(snapshot.capturedAt)}</span>
            <span className="truncate text-right">
              {snapshot.elementCount}
              {' '}
              elements
            </span>
            <span className="truncate">{snapshot.provider}</span>
            <span className="truncate text-right">{snapshot.appBundleId ?? 'Unknown app'}</span>
          </div>
          {typeof snapshot.metadata.artifactPath === 'string' && (
            <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground/70">
              {snapshot.metadata.artifactPath}
            </p>
          )}
          <AccessibilityTreePreview tree={snapshot.tree} />
        </article>
      ))}
    </div>
  )
}

function AccessibilityTreePreview({ tree }: { tree: unknown[] }) {
  const nodes = tree.map(readAccessibilityTreeNode).filter(node => node !== null).slice(0, 4)
  if (nodes.length === 0) {
    return null
  }

  return (
    <div className="mt-2 space-y-1 border-t border-foreground/5 pt-2">
      {nodes.map(node => (
        <div key={node.path} className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono">{node.role}</span>
          <span className={cn('min-w-0 flex-1 truncate', getAccessibilityTreeDepthClass(node.depth))}>
            {node.label || node.value || node.path}
          </span>
        </div>
      ))}
    </div>
  )
}

function readAccessibilityTreeNode(value: unknown): {
  role: string
  label: string
  value: string
  depth: number
  path: string
} | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  const role = typeof record.role === 'string' && record.role.length > 0 ? record.role : 'AXElement'
  const label = typeof record.label === 'string' ? record.label : ''
  const nodeValue = typeof record.value === 'string' ? record.value : ''
  const depth = typeof record.depth === 'number' && Number.isFinite(record.depth) ? record.depth : 0
  const path = typeof record.path === 'string' && record.path.length > 0
    ? record.path
    : `${role}:${label}:${depth}`
  return { role, label, value: nodeValue, depth, path }
}

function getAccessibilityTreeDepthClass(depth: number): string {
  if (depth <= 0) {
    return 'pl-0'
  }
  if (depth === 1) {
    return 'pl-2'
  }
  if (depth === 2) {
    return 'pl-4'
  }
  if (depth === 3) {
    return 'pl-6'
  }
  return 'pl-8'
}

function formatAccessibilityStatus(status: ChronicleAccessibilitySnapshot['status']): string {
  if (status === 'permission-denied') {
    return 'Permission needed'
  }
  if (status === 'unavailable') {
    return 'Unavailable'
  }
  if (status === 'error') {
    return 'Error'
  }
  return 'Ready'
}

function AudioTranscriptList({ transcripts }: { transcripts: ChronicleAudioTranscript[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {transcripts.map(transcript => (
        <article key={transcript.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <FileAudioIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[13px] font-medium text-foreground">
              {transcript.title ?? transcript.windowTitle ?? 'Audio transcript'}
            </span>
            <Badge variant="outline" className="ml-auto text-[11px]">{transcript.status}</Badge>
          </div>
          <p className="line-clamp-4 text-[13px] leading-5 text-foreground">
            {transcript.previewText || 'Transcript text is empty.'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-mono">{formatDateTime(transcript.startedAt)}</span>
            <span>
              {transcript.segmentCount}
              {' '}
              segments
            </span>
            {transcript.language && <span>{transcript.language}</span>}
            {transcript.source === 'asr' && <span>ASR report</span>}
          </div>
        </article>
      ))}
    </div>
  )
}

function AudioRawSegmentList({ segments }: { segments: ChronicleAudioRawSegment[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {segments.map(segment => (
        <article key={segment.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <FileAudioIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[13px] font-medium text-foreground">
              {formatAudioSegmentTitle(segment)}
            </span>
            <Badge variant={segment.active ? 'secondary' : 'outline'} className="ml-auto text-[11px]">
              {segment.active ? 'Active' : 'Quiet'}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px] text-muted-foreground">
            <span className="truncate">
              {formatDateTime(segment.recordedAt)}
            </span>
            <span className="truncate text-right">
              {formatDurationMs(segment.durationMs)}
            </span>
            <span className="truncate">
              RMS
              {' '}
              {formatRatioPercent(segment.rms)}
            </span>
            <span className="truncate text-right">
              Peak
              {' '}
              {formatRatioPercent(segment.peak)}
            </span>
            <span className="truncate">
              {segment.sampleRate}
              {' '}
              Hz
            </span>
            <span className="truncate text-right">
              {segment.channels}
              {' '}
              ch
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <AudioProcessingBadge label="VAD" status={segment.vadStatus} />
            <AudioProcessingBadge label="ASR" status={segment.asrStatus} />
            <AudioProcessingBadge label="Speaker" status={segment.speakerStatus} />
          </div>
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground/70">
            <p className="truncate font-mono">{segment.audioPath}</p>
            <p className="truncate font-mono">{segment.metadataPath}</p>
          </div>
        </article>
      ))}
    </div>
  )
}

function AudioProcessingBadge({
  label,
  status,
}: {
  label: string
  status: ChronicleAudioRawSegment['vadStatus']
}) {
  return (
    <Badge variant="outline" className="text-[11px]">
      {label}
      {' '}
      {status}
    </Badge>
  )
}

function formatAudioSegmentTitle(segment: ChronicleAudioRawSegment): string {
  if (segment.source === 'system') {
    return 'System audio segment'
  }
  if (segment.source === 'mixed') {
    return 'Mixed audio segment'
  }
  return 'Microphone segment'
}

function formatDurationMs(value: number): string {
  if (value < 1000) {
    return `${value} ms`
  }
  return `${(value / 1000).toFixed(1)} s`
}

function formatRatioPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function MemoryCard({ entry }: { entry: MemoryEntry }) {
  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <BrainIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">{entry.title ?? 'Activity memory'}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {entry.matchKind && (
            <Badge variant="outline" className="text-[11px]">
              {getMemoryMatchLabel(entry)}
            </Badge>
          )}
          <Badge variant="secondary" className="text-[11px]">{entry.type}</Badge>
        </div>
      </div>
      <p className="line-clamp-4 text-[13px] leading-5 text-foreground">{entry.content}</p>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="font-mono">{formatDateTime(entry.createdAt)}</span>
        {typeof entry.sourceCount === 'number' && (
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

function getMemoryMatchLabel(entry: MemoryEntry): string {
  if (entry.matchKind === 'hybrid') {
    return 'Hybrid'
  }
  if (entry.matchKind === 'semantic') {
    return typeof entry.semanticScore === 'number'
      ? `Semantic ${entry.semanticScore.toFixed(2)}`
      : 'Semantic'
  }
  return 'Keyword'
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
