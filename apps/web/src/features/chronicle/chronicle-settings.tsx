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
  UserRoundIcon,
} from 'lucide-react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { useAgentModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'

import type {
  ChronicleAccessibilitySnapshot,
  ChronicleActivitySegment,
  ChronicleAudioRawSegment,
  ChronicleAudioTranscript,
  ChronicleConfig,
  ChronicleDreamRun,
  ChronicleKnowledgeCard,
  ChronicleMessageSource,
  ChronicleModelResource,
  ChroniclePipelineRun,
  ChronicleSlackSourceDraft,
  ChronicleSpeakerProfile,
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
  useChronicleSpeakerProfiles,
  useChronicleStatus,
  useChronicleTimeline,
  useRefreshChronicleQueries,
} from './use-chronicle.ts'

const MEMORY_SEARCH_LIMIT = 50

function formatDateTime(value: string | number | null): string {
  if (!value) {
    return '从未'
  }

  const date = typeof value === 'number' ? new Date(toMilliseconds(value)) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '从未'
  }

  return date.toLocaleString('zh-CN')
}

function formatRelativeTime(value: string | number | null): string {
  if (!value) {
    return '从未'
  }

  const time = typeof value === 'number' ? toMilliseconds(value) : new Date(value).getTime()
  if (Number.isNaN(time)) {
    return '从未'
  }

  const diff = Date.now() - time
  const seconds = Math.max(0, Math.floor(diff / 1000))
  if (seconds < 60) {
    return '刚刚'
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes} 分钟前`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} 小时前`
  }
  const days = Math.floor(hours / 24)
  return `${days} 天前`
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
    return '可用'
  }
  if (resource.state === 'installing') {
    return '安装中'
  }
  if (resource.state === 'error') {
    return '异常'
  }
  if (resource.required) {
    return '缺失'
  }
  return '可选'
}

interface ChronicleSetupNotice {
  title: string
  description: string
  actionLabel: string | null
  actionKind: 'open-providers' | 'select-model' | null
}

function getChronicleSetupNotice({
  config,
  profileCount,
  loadingProfiles,
}: {
  config: ChronicleConfig | null
  profileCount: number
  loadingProfiles: boolean
}): ChronicleSetupNotice | null {
  if (config?.profileId && config.modelId) {
    return null
  }
  if (loadingProfiles) {
    return {
      title: '正在读取可用模型',
      description: '记录功能需要一个模型来理解活动并生成记忆。模型列表读取完成后，你就可以选择整理模型。',
      actionLabel: null,
      actionKind: null,
    }
  }
  if (profileCount === 0) {
    return {
      title: '记录功能还不能开启',
      description: '你还没有配置任何模型服务。先在「模型服务」里添加可用模型，然后回到这里选择整理模型。',
      actionLabel: '去配置模型服务',
      actionKind: 'open-providers',
    }
  }
  return {
    title: '记录功能还不能开启',
    description: '你还没有选择整理模型。Cradle 需要知道用哪个模型来理解活动、生成摘要和沉淀记忆。',
    actionLabel: '选择整理模型',
    actionKind: 'select-model',
  }
}

function getControlDisabledReason({
  saving,
  blocked,
  reason,
}: {
  saving: boolean
  blocked: boolean
  reason: string
}): string | null {
  if (saving) {
    return '正在保存设置'
  }
  return blocked ? reason : null
}

export function ChronicleSettings() {
  const { config, loading: configLoading, saving, updateConfig } = useChronicleConfig()
  const { status, loading: statusLoading } = useChronicleStatus()
  const { resources, loading: resourcesLoading } = useChronicleModelResources()
  const { sources: messageSources, loading: messageSourcesLoading } = useChronicleMessageSources()
  const { snapshots: accessibilitySnapshots, loading: accessibilitySnapshotsLoading } = useChronicleAccessibilitySnapshots()
  const { transcripts: audioTranscripts, loading: audioTranscriptsLoading } = useChronicleAudioTranscripts()
  const { segments: audioRawSegments, loading: audioRawSegmentsLoading } = useChronicleAudioRawSegments()
  const { profiles: speakerProfiles, loading: speakerProfilesLoading } = useChronicleSpeakerProfiles()
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
  const setSettingsSection = useSettingsOverlayStore(state => state.setSettingsSection)

  const selectedProfile = useMemo(
    () => profiles.find(profile => profile.id === config?.profileId) ?? null,
    [config?.profileId, profiles],
  )
  const selectedModels = selectedProfile ? modelsByProfileId[selectedProfile.id] ?? [] : []
  const selectedModel = selectedModels.find(model => model.id === config?.modelId) ?? null
  const visibleMemoryEntries = hasSearchQuery ? searchedMemoryEntries : memoryEntries
  const modelLabel = status?.configuredModel ?? selectedModel?.id ?? config?.modelId ?? null
  const canEnable = Boolean(config?.profileId && config?.modelId)
  const disabledRootReason = canEnable ? '需要先开启记录活动' : '需要先选择整理模型，再开启记录活动'
  const setupNotice = getChronicleSetupNotice({
    config,
    profileCount: profiles.length,
    loadingProfiles: loadingProfileIds.size > 0,
  })
  const captureDisabledReason = getControlDisabledReason({
    saving,
    blocked: !canEnable,
    reason: '需要先选择整理模型',
  })
  const activityDisabledReason = getControlDisabledReason({
    saving,
    blocked: !config?.enabled,
    reason: disabledRootReason,
  })
  const audioDisabledReason = getControlDisabledReason({
    saving,
    blocked: !config?.enabled,
    reason: disabledRootReason,
  })
  const audioSourceDisabledReason = getControlDisabledReason({
    saving,
    blocked: !config?.enabled || !config?.audioCaptureEnabled,
    reason: !config?.enabled ? disabledRootReason : '需要先开启会议与音频',
  })
  const dependencyNotice = canEnable && !config?.enabled
    ? {
        title: '有些开关会先保持不可用',
        description: '自动整理、会议与音频都依赖「记录活动」。先打开记录活动后，这些能力才会变成可操作状态。',
      }
    : null

  if (configLoading) {
    return null
  }

  return (
    <div className="flex flex-col gap-6 pb-8">
      <ChronicleHero
        running={status?.running ?? false}
        available={status?.available ?? false}
        enabled={config?.enabled ?? false}
        lastSummaryAt={status?.lastSummaryAt ?? null}
        totalSummaries={status?.totalSummaries ?? 0}
        totalActivitySegments={status?.totalActivitySegments ?? 0}
        totalKnowledgeCards={status?.totalKnowledgeCards ?? 0}
        onRefresh={refreshChronicle}
      />

      {setupNotice && (
        <SetupNoticeCard
          notice={setupNotice}
          saving={saving}
          onAction={() => {
            if (setupNotice.actionKind === 'open-providers') {
              setSettingsSection('providers')
              return
            }
            const trigger = document.querySelector<HTMLElement>('[data-testid="chronicle-provider-model-selector"]')
            trigger?.focus()
            trigger?.click()
          }}
        />
      )}

      {dependencyNotice && (
        <Alert className="border-border bg-muted/30">
          <TriangleAlertIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <AlertTitle>{dependencyNotice.title}</AlertTitle>
          <AlertDescription className="text-[12px] leading-5">
            {dependencyNotice.description}
          </AlertDescription>
        </Alert>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <ChronicleControlPanel
          config={config}
          saving={saving}
          canEnable={canEnable}
          captureDisabledReason={captureDisabledReason}
          activityDisabledReason={activityDisabledReason}
          audioDisabledReason={audioDisabledReason}
          audioSourceDisabledReason={audioSourceDisabledReason}
          profiles={profiles}
          selectedProfileId={config?.profileId ?? null}
          selectedModelId={config?.modelId ?? null}
          selectedModel={selectedModel}
          modelsByProfileId={modelsByProfileId}
          loadingProfileIds={loadingProfileIds}
          onUpdateConfig={updateConfig}
        />
        <CaptureSourceOverview
          screenCount={status?.totalAccessibilitySnapshots ?? 0}
          messageCount={status?.totalMessages ?? 0}
          audioCount={status?.totalAudioTranscripts ?? 0}
          audioEnabled={config?.audioCaptureEnabled ?? false}
          slackConnected={messageSources.length > 0}
        />
      </section>

      <ChronicleJourney />

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <UserSection
          title="最近记录"
          description="这里展示 Cradle 最近看到的屏幕、消息或音频线索。你可以确认它正在理解怎样的上下文。"
        >
          {timelineLoading
            ? <EmptyState icon={<ImageIcon className="size-4" />} title="正在读取活动时间线" />
            : timelineEntries.length === 0
              ? <EmptyState icon={<ImageIcon className="size-4" />} title="还没有活动记录" />
              : <TimelineScrubber entries={timelineEntries} />}
        </UserSection>

        <UserSection
          title="搜索记忆"
          description="搜索已经整理出来的活动记忆，找回最近做过的事、讨论过的问题和相关上下文。"
        >
          <div className="flex flex-col gap-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="搜索记忆"
                className="h-9 pl-8 text-[13px]"
              />
            </div>
            {memoriesLoading || searchingMemories
              ? <EmptyState icon={<BrainIcon className="size-4" />} title="正在搜索记忆" />
              : visibleMemoryEntries.length === 0
                ? (
                    <EmptyState
                      icon={<BrainIcon className="size-4" />}
                      title={hasSearchQuery ? '没有匹配的记忆' : '还没有记忆'}
                    />
                  )
                : <MemoryList entries={visibleMemoryEntries} />}
          </div>
        </UserSection>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <UserSection
          title="沉淀出来的知识"
          description="当 Cradle 认为某段活动值得长期保留时，会把它整理成决定、任务、洞察或模式。"
        >
          {knowledgeCardsLoading
            ? <EmptyState icon={<BrainIcon className="size-4" />} title="正在读取知识卡片" />
            : knowledgeCards.length === 0
              ? <EmptyState icon={<BrainIcon className="size-4" />} title="还没有知识卡片" />
              : <KnowledgeCardList cards={knowledgeCards} />}
        </UserSection>

        <UserSection
          title="会议人物"
          description="如果你导入会议转写，Cradle 会逐步学会说话人标签，帮助之后回顾谁说过什么。"
        >
          {speakerProfilesLoading
            ? <EmptyState icon={<UserRoundIcon className="size-4" />} title="正在读取说话人" />
            : speakerProfiles.length === 0
              ? <EmptyState icon={<UserRoundIcon className="size-4" />} title="还没有说话人记录" />
              : <SpeakerProfileList profiles={speakerProfiles} />}
        </UserSection>
      </section>

      <details className="group rounded-lg bg-muted/20 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] font-medium text-foreground">
          高级与诊断
          <span className="text-[12px] font-normal text-muted-foreground">模型资源、原始线索、整理记录和导入来源</span>
        </summary>
        <div className="border-t border-foreground/5 px-4 pb-4 pt-3">
          <section className="py-2">
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

          <AdvancedSection title="消息来源" description="连接 Slack 频道，把重要讨论纳入活动记忆。">
            <SlackSourcePanel loading={messageSourcesLoading} sources={messageSources} />
          </AdvancedSection>

          <AdvancedSection title="本地能力" description="识别画面、处理音频、区分说话人和语义搜索所需的本地资源。">
            <ResourceGrid loading={resourcesLoading} resources={resources} />
          </AdvancedSection>

          <AdvancedSection title="窗口线索" description="最近从本机窗口和界面结构中捕捉到的原始线索。">
            {accessibilitySnapshotsLoading
              ? <EmptyState icon={<EyeIcon className="size-4" />} title="正在读取窗口线索" />
              : accessibilitySnapshots.length === 0
                ? <EmptyState icon={<EyeIcon className="size-4" />} title="还没有窗口线索" />
                : <AccessibilitySnapshotList snapshots={accessibilitySnapshots} />}
          </AdvancedSection>

          <AdvancedSection title="音频片段" description="最近捕捉到的原始音频片段，以及 VAD、ASR 和说话人处理状态。">
            {audioRawSegmentsLoading
              ? <EmptyState icon={<FileAudioIcon className="size-4" />} title="正在读取音频片段" />
              : audioRawSegments.length === 0
                ? <EmptyState icon={<FileAudioIcon className="size-4" />} title="还没有音频片段" />
                : <AudioRawSegmentList segments={audioRawSegments} />}
          </AdvancedSection>

          <AdvancedSection title="会议转写" description="已经导入或生成的会议文本，后续会成为搜索和总结上下文。">
            {audioTranscriptsLoading
              ? <EmptyState icon={<FileAudioIcon className="size-4" />} title="正在读取会议转写" />
              : audioTranscripts.length === 0
                ? <EmptyState icon={<FileAudioIcon className="size-4" />} title="还没有会议转写" />
                : <AudioTranscriptList transcripts={audioTranscripts} />}
          </AdvancedSection>

          <AdvancedSection title="活动片段" description="由窗口、消息和音频线索聚合出的片段，以及自动整理记录。">
            {activitySegmentsLoading || pipelineRunsLoading
              ? <EmptyState icon={<ActivityIcon className="size-4" />} title="正在整理活动片段" />
              : activitySegments.length === 0
                ? <EmptyState icon={<ActivityIcon className="size-4" />} title="还没有活动片段" />
                : <ActivityPipelinePanel segments={activitySegments} runs={pipelineRuns} />}
          </AdvancedSection>

          <AdvancedSection title="记忆整理预览" description="预览哪些知识卡片可能可以合并；这里只展示候选结果，不会改动现有记忆。">
            <DreamRunPanel loading={dreamRunsLoading} runs={dreamRuns} />
          </AdvancedSection>
        </div>
      </details>
    </div>
  )
}

function ChronicleHero({
  running,
  available,
  enabled,
  lastSummaryAt,
  totalSummaries,
  totalActivitySegments,
  totalKnowledgeCards,
  onRefresh,
}: {
  running: boolean
  available: boolean
  enabled: boolean
  lastSummaryAt: string | number | null
  totalSummaries: number
  totalActivitySegments: number
  totalKnowledgeCards: number
  onRefresh: () => void
}) {
  return (
    <section className="rounded-lg bg-background p-5 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_8px_30px_rgba(0,0,0,0.04)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
              <ActivityIcon className="size-4" />
            </span>
            <StatusBadge running={running} available={available} />
          </div>
          <h2 className="text-2xl font-semibold leading-tight text-foreground text-balance">记录会把你的工作现场整理成可搜索的记忆</h2>
          <p className="mt-2 max-w-xl text-[13px] leading-6 text-muted-foreground text-pretty">
            Cradle 会在本机捕捉屏幕、消息和会议线索，自动理解一段时间里发生了什么，并把值得保留的内容沉淀下来。
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} className="active:scale-[0.96] transition-transform">
            <RefreshCwIcon className="size-3.5" />
            刷新
          </Button>
          <span className="text-[12px] text-muted-foreground">
            {enabled ? `最近记忆 ${formatRelativeTime(lastSummaryAt)}` : '开启后才会开始记录'}
          </span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <HeroMetric icon={<BrainIcon className="size-3.5" />} label="已整理记忆" value={String(totalSummaries)} />
        <HeroMetric icon={<ActivityIcon className="size-3.5" />} label="活动片段" value={String(totalActivitySegments)} />
        <HeroMetric icon={<CheckCircle2Icon className="size-3.5" />} label="知识卡片" value={String(totalKnowledgeCards)} />
      </div>
    </section>
  )
}

function HeroMetric({ icon, label, value }: { icon: ReactNode, label: string, value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span className="mt-1 block text-[18px] font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function SetupNoticeCard({
  notice,
  saving,
  onAction,
}: {
  notice: ChronicleSetupNotice
  saving: boolean
  onAction: () => void
}) {
  return (
    <Alert className="border-amber-500/20 bg-amber-500/5 text-amber-800 dark:text-amber-300">
      <TriangleAlertIcon className="size-4" aria-hidden="true" />
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-[12px] leading-5 md:flex-row md:items-center md:justify-between">
        <span>{notice.description}</span>
        {notice.actionLabel && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit border-amber-500/30 bg-background/70 text-amber-800 hover:bg-amber-500/10 active:scale-[0.96] transition-transform dark:text-amber-200"
            disabled={saving}
            onClick={onAction}
          >
            {notice.actionLabel}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

function ControlUnavailableReason({ reason }: { reason: string | null }) {
  if (!reason) {
    return null
  }

  return (
    <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-800 dark:text-amber-200">
      <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span className="text-[11px] leading-4 text-pretty">{reason}</span>
    </div>
  )
}

function ControlRow({
  icon,
  title,
  description,
  status,
  statusTone = 'muted',
  reason,
  children,
}: {
  icon: ReactNode
  title: string
  description: string
  status: string
  statusTone?: 'enabled' | 'disabled' | 'warning' | 'muted'
  reason?: string | null
  children: ReactNode
}) {
  return (
    <div className="rounded-md bg-muted/25 px-3 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
            {icon}
          </span>
          <div className="min-w-0">
            <h4 className="text-[13px] font-medium text-foreground text-balance">{title}</h4>
            <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground text-pretty">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge
            variant={statusTone === 'enabled' ? 'secondary' : 'outline'}
            className={cn(
              'text-[11px]',
              {
                'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300': statusTone === 'enabled',
                'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-200': statusTone === 'warning',
                'text-muted-foreground': statusTone === 'disabled' || statusTone === 'muted',
              },
            )}
          >
            {status}
          </Badge>
          {children}
        </div>
      </div>
      <ControlUnavailableReason reason={reason ?? null} />
    </div>
  )
}

function ChronicleControlPanel({
  config,
  saving,
  canEnable,
  captureDisabledReason,
  activityDisabledReason,
  audioDisabledReason,
  audioSourceDisabledReason,
  profiles,
  selectedProfileId,
  selectedModelId,
  selectedModel,
  modelsByProfileId,
  loadingProfileIds,
  onUpdateConfig,
}: {
  config: ChronicleConfig | null
  saving: boolean
  canEnable: boolean
  captureDisabledReason: string | null
  activityDisabledReason: string | null
  audioDisabledReason: string | null
  audioSourceDisabledReason: string | null
  profiles: ReturnType<typeof useAgentProfiles>['profiles']
  selectedProfileId: string | null
  selectedModelId: string | null
  selectedModel: Parameters<typeof ProviderModelPicker>[0]['selectedModel']
  modelsByProfileId: ReturnType<typeof useAgentModelMap>['modelsByProfileId']
  loadingProfileIds: ReturnType<typeof useAgentModelMap>['loadingProfileIds']
  onUpdateConfig: (updates: Partial<ChronicleConfig>) => Promise<ChronicleConfig | null>
}) {
  const captureStatus = !canEnable ? '待选择模型' : config?.enabled ? '已开启' : '未开启'
  const activityStatus = !config?.enabled
    ? '待开启记录'
    : config?.activityPipelineEnabled ?? true
      ? '已开启'
      : '已关闭'
  const audioStatus = !config?.enabled
    ? '待开启记录'
    : config?.audioCaptureEnabled
      ? '已开启'
      : '未开启'
  const modelStatus = selectedModelId ? '已选择' : '未选择'

  return (
    <UserSection title="开始记录" description="这里决定 Cradle 是否开始记录，以及记录后如何整理成记忆。">
      <div className="grid gap-2">
        <ControlRow
          icon={<ActivityIcon className="size-3.5" />}
          title="记录活动"
          description={canEnable ? '开启后，Cradle 会在本机持续整理你的活动线索。' : '先选择用于整理记忆的模型，然后再开启记录。'}
          status={captureStatus}
          statusTone={config?.enabled ? 'enabled' : captureDisabledReason ? 'warning' : 'disabled'}
          reason={captureDisabledReason}
        >
          <Switch
            checked={config?.enabled ?? false}
            onCheckedChange={enabled => void onUpdateConfig({ enabled })}
            disabled={saving || !canEnable}
          />
        </ControlRow>

        <ControlRow
          icon={<BrainIcon className="size-3.5" />}
          title="自动整理"
          description={config?.enabled ? '把零散活动归类、总结，并沉淀成长期记忆。' : '记录活动开启后，自动整理才会变成可操作。'}
          status={activityStatus}
          statusTone={config?.enabled && (config?.activityPipelineEnabled ?? true) ? 'enabled' : activityDisabledReason ? 'warning' : 'disabled'}
          reason={activityDisabledReason}
        >
          <Switch
            checked={config?.activityPipelineEnabled ?? true}
            onCheckedChange={activityPipelineEnabled => void onUpdateConfig({ activityPipelineEnabled })}
            disabled={saving || !config?.enabled}
          />
        </ControlRow>

        <ControlRow
          icon={<FileAudioIcon className="size-3.5" />}
          title="会议与音频"
          description={config?.enabled ? '捕捉会议音频，并在模型可用时转写为会议线索。' : '记录活动开启后，会议与音频才会变成可操作。'}
          status={audioStatus}
          statusTone={config?.enabled && config?.audioCaptureEnabled ? 'enabled' : audioDisabledReason || audioSourceDisabledReason ? 'warning' : 'disabled'}
          reason={audioDisabledReason ?? audioSourceDisabledReason}
        >
          <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
            <select
              className="h-8 max-w-40 rounded-md border border-border bg-background px-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              value={config?.audioSource ?? 'microphone'}
              onChange={event => void onUpdateConfig({ audioSource: event.target.value as ChronicleConfig['audioSource'] })}
              disabled={saving || !config?.enabled || !config?.audioCaptureEnabled}
            >
              <option value="microphone">麦克风</option>
              <option value="system">系统声音</option>
              <option value="mixed">麦克风与系统声音</option>
            </select>
            <Switch
              checked={config?.audioCaptureEnabled ?? false}
              onCheckedChange={audioCaptureEnabled => void onUpdateConfig({ audioCaptureEnabled })}
              disabled={saving || !config?.enabled}
            />
          </div>
        </ControlRow>

        <ControlRow
          icon={<CpuIcon className="size-3.5" />}
          title="整理模型"
          description="这个模型会负责理解活动、生成摘要和沉淀记忆。"
          status={modelStatus}
          statusTone={selectedModelId ? 'enabled' : 'warning'}
          reason={saving ? '正在保存设置' : null}
        >
          <ProviderModelPicker
            profiles={profiles}
            selectedProfileId={selectedProfileId}
            selectedModelId={selectedModelId}
            selectedModel={selectedModel}
            modelsByProfileId={modelsByProfileId}
            loadingProfileIds={loadingProfileIds}
            thinkingValue={null}
            thinkingOptions={[]}
            emptyProfilesLabel="还没有配置模型服务"
            emptySelectionLabel="选择模型"
            menuSide="bottom"
            menuAlign="end"
            triggerTestId="chronicle-provider-model-selector"
            disabled={saving}
            onSelectProfile={(profileId) => {
              const nextModel = (modelsByProfileId[profileId] ?? [])[0] ?? null
              void onUpdateConfig({ profileId, modelId: nextModel?.id ?? '' })
            }}
            onSelectModel={(model, profileId) => {
              if (!model) {
                return
              }
              void onUpdateConfig({ profileId, modelId: model })
            }}
            onSelectThinking={() => {}}
          />
        </ControlRow>
      </div>
    </UserSection>
  )
}

function CaptureSourceOverview({
  screenCount,
  messageCount,
  audioCount,
  audioEnabled,
  slackConnected,
}: {
  screenCount: number
  messageCount: number
  audioCount: number
  audioEnabled: boolean
  slackConnected: boolean
}) {
  return (
    <UserSection title="它会记录什么" description="Cradle 会把不同来源放在同一条时间线里，而不是让你分别翻找。">
      <div className="grid gap-2">
        <SourceOverviewItem icon={<EyeIcon className="size-3.5" />} title="屏幕与窗口" value={`${screenCount} 条线索`} detail="理解当前应用、窗口标题和可读文本。" />
        <SourceOverviewItem icon={<MessageSquareIcon className="size-3.5" />} title="Slack 消息" value={slackConnected ? `${messageCount} 条消息` : '未连接'} detail="把频道讨论放进同一段工作上下文。" />
        <SourceOverviewItem icon={<FileAudioIcon className="size-3.5" />} title="会议与音频" value={audioEnabled ? `${audioCount} 条转写` : '未开启'} detail="记录会议线索，并在可用时生成转写。" />
      </div>
    </UserSection>
  )
}

function SourceOverviewItem({ icon, title, value, detail }: { icon: ReactNode, title: string, value: string, detail: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-md bg-muted/35 px-3 py-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{title}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{value}</span>
        </div>
        <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground text-pretty">{detail}</p>
      </div>
    </div>
  )
}

function ChronicleJourney() {
  return (
    <section className="grid grid-cols-1 gap-2 md:grid-cols-3">
      <JourneyStep icon={<EyeIcon className="size-3.5" />} title="先看到线索" description="屏幕、消息和会议会先成为本机线索。" />
      <JourneyStep icon={<ActivityIcon className="size-3.5" />} title="再整理成片段" description="连续发生的事情会被归到同一段活动里。" />
      <JourneyStep icon={<BrainIcon className="size-3.5" />} title="最后成为记忆" description="值得保留的内容会进入搜索和知识卡片。" />
    </section>
  )
}

function JourneyStep({ icon, title, description }: { icon: ReactNode, title: string, description: string }) {
  return (
    <div className="rounded-lg bg-muted/25 p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.05)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-background text-muted-foreground">
          {icon}
        </span>
        <span className="text-[13px] font-medium text-foreground">{title}</span>
      </div>
      <p className="text-[12px] leading-5 text-muted-foreground text-pretty">{description}</p>
    </div>
  )
}

function UserSection({ title, description, children }: { title: string, description: string, children: ReactNode }) {
  return (
    <section className="rounded-lg bg-background p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.03)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
      <div className="mb-3">
        <h3 className="text-[15px] font-semibold text-foreground text-balance">{title}</h3>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground text-pretty">{description}</p>
      </div>
      {children}
    </section>
  )
}

function AdvancedSection({ title, description, children }: { title: string, description: string, children: ReactNode }) {
  return (
    <section className="border-t border-foreground/5 py-4 first:border-t-0 first:pt-0">
      <div className="mb-3">
        <h3 className="text-[14px] font-semibold text-foreground text-balance">{title}</h3>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground text-pretty">{description}</p>
      </div>
      {children}
    </section>
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
    return <EmptyState icon={<ActivityIcon className="size-4" />} title="正在读取状态" />
  }

  return (
    <div className="rounded-lg border border-foreground/5 bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ActivityIcon className="size-3.5 text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">当前状态</span>
        <StatusBadge running={running} available={available} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-10 xl:grid-cols-11">
        <StatusItem
          icon={<EyeIcon className="size-3.5" />}
          label="记录服务"
          value={running ? `运行中 ${pid ?? '未知'}` : '已停止'}
        />
        <StatusItem
          icon={<ClockIcon className="size-3.5" />}
          label="最近记忆"
          value={formatRelativeTime(lastSummaryAt)}
          detail={formatDateTime(lastSummaryAt)}
        />
        <StatusItem
          icon={<BrainIcon className="size-3.5" />}
          label="记忆"
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
          label="窗口"
          value={String(totalAccessibilitySnapshots)}
          detail={formatRelativeTime(lastAccessibilitySnapshotAt)}
        />
        <StatusItem
          icon={<FileAudioIcon className="size-3.5" />}
          label="转写"
          value={String(totalAudioTranscripts)}
          detail={formatRelativeTime(lastAudioTranscriptAt)}
        />
        <StatusItem
          icon={<FileAudioIcon className="size-3.5" />}
          label="音频"
          value={String(totalAudioRawSegments)}
          detail={audioCaptureEnabled ? formatRelativeTime(lastAudioRawSegmentAt) : formatAudioRuntimeStatus(audioRuntimeStatus)}
        />
        <StatusItem
          icon={<ActivityIcon className="size-3.5" />}
          label="活动"
          value={String(totalActivitySegments)}
        />
        <StatusItem
          icon={<CpuIcon className="size-3.5" />}
          label="整理"
          value={String(totalPipelineRuns)}
        />
        <StatusItem
          icon={<BrainIcon className="size-3.5" />}
          label="知识"
          value={String(totalKnowledgeCards)}
        />
        <StatusItem
          icon={<ClockIcon className="size-3.5" />}
          label="预览"
          value={String(totalDreamRuns)}
        />
      </div>

      <div className="mt-3 grid gap-2 border-t border-foreground/5 pt-3 text-[12px] text-muted-foreground md:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2">
          <HardDriveIcon className="size-3.5 shrink-0" />
          <span className="truncate">{storageRoot ?? '存储位置暂不可用'}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 md:justify-end">
          <CpuIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {activityPipelineEnabled
              ? `自动整理${activityPipelineRunning ? '运行中' : '就绪'} · ${Math.round(activityPipelineIntervalMs / 1000)} 秒 · 每次 ${activityPipelineBatchSize} 段`
              : '自动整理已关闭'}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <CpuIcon className="size-3.5 shrink-0" />
          <span className="truncate">{modelLabel ?? '还没有选择模型'}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 md:justify-end">
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {lastExitCode === null ? '没有异常退出记录' : `上次退出代码 ${lastExitCode}，时间 ${formatDateTime(lastExitAt)}`}
          </span>
        </div>
      </div>
    </div>
  )
}

function formatAudioRuntimeStatus(status: ChronicleStatus['audioRuntimeStatus']): string {
  if (status === 'armed') {
    return '已准备'
  }
  if (status === 'unavailable') {
    return '不可用'
  }
  return '已关闭'
}

function formatSlackRealtimeMode(mode: ChronicleMessageSource['realtimeMode']): string {
  if (mode === 'events-api') {
    return 'Events API'
  }
  if (mode === 'socket-mode') {
    return 'Socket Mode'
  }
  return '轮询'
}

function StatusBadge({ running, available }: { running: boolean, available: boolean }) {
  if (running) {
    return <Badge className="ml-auto bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">运行中</Badge>
  }
  if (available) {
    return <Badge variant="secondary" className="ml-auto">已就绪</Badge>
  }
  return <Badge variant="outline" className="ml-auto">未配置</Badge>
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
          <span className="text-[13px] font-medium text-foreground">Slack 来源</span>
          <Badge variant="outline" className="ml-auto text-[11px]">
            {sources.length === 0 ? '未连接' : `${sources.length} 个来源`}
          </Badge>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <Input
            value={draft.label}
            onChange={event => setDraft(current => ({ ...current, label: event.target.value }))}
            placeholder="来源名称"
            className="h-9 text-[13px]"
          />
          <Input
            value={draft.channelIds}
            onChange={event => setDraft(current => ({ ...current, channelIds: event.target.value }))}
            placeholder="频道 ID，用逗号分隔"
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
            <ToggleGroupItem value="polling" aria-label="Slack 轮询" className="h-8 px-2 text-[12px]">
              轮询
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="text-[12px] text-muted-foreground">
            {draft.realtimeMode === 'events-api' ? '实时接收事件，并保留轮询兜底' : '只在后台定时同步'}
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
            保存
          </Button>
        </div>

        <p className="mt-2 text-[12px] text-muted-foreground">
          Token 和 signing secret 会存放在 Cradle secrets；记录功能只保存密钥引用和允许导入的频道列表。
        </p>
      </div>

      {loading
        ? <EmptyState icon={<MessageSquareIcon className="size-4" />} title="正在读取 Slack 来源" />
        : sources.length === 0
          ? <EmptyState icon={<MessageSquareIcon className="size-4" />} title="还没有连接 Slack 来源" />
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
                      <span className="truncate font-mono">{source.channelIds.join(', ') || '还没有频道'}</span>
                      <span className="truncate md:text-right">
                        最近消息
                        {' '}
                        {formatRelativeTime(source.lastMessageAt)}
                      </span>
                      <span className="truncate">
                        模式
                        {' '}
                        {formatSlackRealtimeMode(source.realtimeMode)}
                      </span>
                      <span className="truncate font-mono md:text-right">
                        {source.realtimeMode === 'events-api'
                          ? `${getServerUrl()}/chronicle/message-sources/${source.id}/slack/events`
                          : '轮询同步已启用'}
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
                        同步
                      </Button>
                      <span className="text-[12px] text-muted-foreground">
                        最近同步
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
    return <EmptyState icon={<CpuIcon className="size-4" />} title="正在读取本地能力" />
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
          全部安装
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void reconcileResources()}
        >
          <RefreshCwIcon className="size-3.5" />
          重新检查
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
            {resource.message ?? resource.provider ?? '记录服务会提供这个本地能力的当前状态。'}
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
                      setMessage(updated?.message ?? '资源已下载')
                    })
                  }}
                >
                  <DownloadIcon className="size-3" />
                  下载
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
                    setMessage(updated?.message ?? '资源已验证')
                  })
                }}
              >
                <RefreshCwIcon className="size-3" />
                验证
              </Button>
            </div>
          )}
          {message && <p className="mt-1 text-[11px] text-muted-foreground">{message}</p>}
          {downloadProgress[resource.category] && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              下载进度：
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
                      {displayEntry.channelName ?? displayEntry.windowTitle ?? '音频转写'}
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
                    <span className="shrink-0 text-[12px] text-muted-foreground">{displayEntry.userName ?? '未知用户'}</span>
                  </div>
                  <p className="line-clamp-5 text-[14px] leading-6">{displayEntry.ocrText}</p>
                </div>
              </div>
            )
          : displayEntry?.framePath
          ? (
              <img
                src={frameUrl(displayEntry)}
                alt={`${formatDateTime(displayEntry.capturedAt)} 的活动记录`}
                className="aspect-video w-full object-contain outline-solid outline-1 -outline-offset-1 outline-white/10"
              />
            )
          : (
              <div className="flex aspect-video items-center justify-center text-[13px] text-white/60">
                画面暂不可用
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
              ? displayEntry.channelName ?? displayEntry.windowTitle ?? '音频转写'
              : displayEntry?.sourceType === 'message'
              ? displayEntry.channelName ? `#${displayEntry.channelName}` : displayEntry.channelId ?? 'Slack 消息'
              : displayEntry?.appBundleId ?? displayEntry?.windowTitle ?? '屏幕记录'}
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
              className="h-full rounded-full bg-foreground/40"
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
            className="absolute bottom-1 -translate-x-1/2"
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
          <span className="truncate text-[13px] font-medium text-foreground">整理记录</span>
          <Badge variant="outline" className="ml-auto text-[11px]">{runs.length}</Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void runPipelineTick()}
          >
            <RefreshCwIcon className="size-3.5" />
            立即整理
          </Button>
        </div>
        {runs.length === 0
          ? (
              <p className="text-[12px] text-muted-foreground">还没有整理记录。</p>
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
                        {formatPipelineRunStatus(run.status)}
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
          {segment.title ?? segment.frontApp ?? '活动片段'}
        </span>
        <Badge variant="outline" className="ml-auto text-[11px]">
          {formatActivitySegmentType(segment.segmentType)}
        </Badge>
      </div>
      <p className="line-clamp-3 min-h-15 text-[13px] leading-5 text-foreground">
        {segment.summary ?? '这个片段还在收集来源线索。'}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">{formatDateTime(segment.startedAt)}</span>
        <span className="truncate text-right">{formatDurationSeconds(segment.durationSeconds)}</span>
        <span className="truncate">{segment.frontApp ?? '未知应用'}</span>
        <span className="truncate text-right">{formatActivityPipelineStatus(segment.pipelineStatus)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <ActivitySourceBadge label="画面" value={segment.sourceCounts.snapshotIds ?? 0} />
        <ActivitySourceBadge label="Slack" value={segment.sourceCounts.messageIds ?? 0} />
        <ActivitySourceBadge label="音频" value={segment.sourceCounts.audioRawSegmentIds ?? 0} />
        <ActivitySourceBadge label="转写" value={segment.sourceCounts.audioTranscriptIds ?? 0} />
        <ActivitySourceBadge label="记忆" value={segment.sourceCounts.memoryIds ?? 0} />
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
          判断价值
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || segment.pipelineStatus === 'summarized' || segment.pipelineStatus === 'crystallized'}
          onClick={onSummarize}
        >
          <BrainIcon className="size-3.5" />
          总结
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || segment.pipelineStatus === 'crystallized'}
          onClick={onCrystallize}
        >
          <CheckCircle2Icon className="size-3.5" />
          沉淀
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
    return '会议'
  }
  if (type === 'browsing') {
    return '浏览'
  }
  if (type === 'chat') {
    return '对话'
  }
  if (type === 'audio') {
    return '音频'
  }
  if (type === 'idle') {
    return '空闲'
  }
  if (type === 'work') {
    return '工作'
  }
  return '未知'
}

function formatActivityPipelineStatus(status: ChronicleActivitySegment['pipelineStatus']): string {
  if (status === 'triaged') {
    return '已判断'
  }
  if (status === 'summarized') {
    return '已总结'
  }
  if (status === 'crystallized') {
    return '已沉淀'
  }
  if (status === 'error') {
    return '异常'
  }
  return '收集中'
}

function formatPipelineTrigger(trigger: ChroniclePipelineRun['trigger']): string {
  if (trigger === 'audio-raw') {
    return '原始音频'
  }
  if (trigger === 'audio-transcript') {
    return '会议转写'
  }
  if (trigger === 'message') {
    return 'Slack 消息'
  }
  if (trigger === 'memory') {
    return '记忆'
  }
  if (trigger === 'summarize') {
    return '摘要'
  }
  if (trigger === 'manual') {
    return '手动触发'
  }
  return '屏幕记录'
}

function formatPipelineStage(stage: ChroniclePipelineRun['stage']): string {
  if (stage === 'collection') {
    return '收集线索'
  }
  if (stage === 'triage') {
    return '判断价值'
  }
  if (stage === 'summarization') {
    return '生成摘要'
  }
  if (stage === 'crystallization') {
    return '沉淀记忆'
  }
  return '划分片段'
}

function formatPipelineRunStatus(status: ChroniclePipelineRun['status']): string {
  if (status === 'success') {
    return '已完成'
  }
  if (status === 'error') {
    return '异常'
  }
  if (status === 'queued') {
    return '排队中'
  }
  if (status === 'running') {
    return '运行中'
  }
  if (status === 'skipped') {
    return '已跳过'
  }
  return '未知'
}

function formatDurationSeconds(value: number): string {
  if (value < 60) {
    return `${Math.max(0, Math.floor(value))} 秒`
  }
  const minutes = Math.floor(value / 60)
  if (minutes < 60) {
    return `${minutes} 分钟`
  }
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours} 小时` : `${hours} 小时 ${remainder} 分钟`
}

function formatKnowledgeCardType(type: ChronicleKnowledgeCard['cardType']): string {
  if (type === 'insight') {
    return '洞察'
  }
  if (type === 'decision') {
    return '决定'
  }
  if (type === 'task') {
    return '任务'
  }
  if (type === 'pattern') {
    return '模式'
  }
  return '事实'
}

function formatKnowledgeDimension(dimension: ChronicleKnowledgeCard['dimension']): string {
  if (dimension === 'technical') {
    return '技术'
  }
  if (dimension === 'business') {
    return '业务'
  }
  if (dimension === 'personal') {
    return '个人'
  }
  if (dimension === 'project') {
    return '项目'
  }
  return '通用'
}

function formatDreamRunType(type: ChronicleDreamRun['runType']): string {
  if (type === 'merge') {
    return '合并'
  }
  if (type === 'archive') {
    return '归档'
  }
  if (type === 'prune') {
    return '清理'
  }
  if (type === 'restore') {
    return '恢复'
  }
  return '预览'
}

function formatDreamRunStatus(status: ChronicleDreamRun['status']): string {
  if (status === 'completed') {
    return '已完成'
  }
  if (status === 'failed') {
    return '异常'
  }
  if (status === 'running') {
    return '运行中'
  }
  return '排队中'
}

function formatKnowledgeCardStatus(status: ChronicleKnowledgeCard['status']): string {
  if (status === 'active') {
    return '生效中'
  }
  if (status === 'merged') {
    return '已合并'
  }
  if (status === 'archived') {
    return '已归档'
  }
  if (status === 'deleted') {
    return '已删除'
  }
  return status
}

function formatTranscriptStatus(status: ChronicleAudioTranscript['status']): string {
  if (status === 'recording') {
    return '记录中'
  }
  if (status === 'completed') {
    return '已完成'
  }
  if (status === 'imported') {
    return '已导入'
  }
  return '异常'
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
            {card.status !== 'active' && <Badge variant="outline" className="text-[11px]">{formatKnowledgeCardStatus(card.status)}</Badge>}
            {card.tags.slice(0, 4).map(tag => <Badge key={tag} variant="outline" className="text-[11px]">{tag}</Badge>)}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span className="truncate">
              {card.sourceSegmentIds.length}
              {' '}
              个来源片段
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
          <span className="truncate text-[13px] font-medium text-foreground">合并候选</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={startingDryRun}
            onClick={() => void startDreamDryRun()}
          >
            <RefreshCwIcon className="size-3.5" />
            生成预览
          </Button>
        </div>
      </div>

      {loading
        ? <EmptyState icon={<ClockIcon className="size-4" />} title="正在读取整理预览" />
        : runs.length === 0
          ? <EmptyState icon={<ClockIcon className="size-4" />} title="还没有整理预览" />
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
                        {formatDreamRunStatus(run.status)}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                      <span>
                        输入
                        {' '}
                        {run.inputCount}
                      </span>
                      <span>
                        候选
                        {' '}
                        {readCandidateCount(run)}
                      </span>
                      <span>
                        合并
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
              {snapshot.windowTitle ?? snapshot.appBundleId ?? '窗口线索'}
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
            {snapshot.text ?? '这次记录没有捕捉到可读的窗口文本。'}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
            <span className="truncate font-mono">{formatDateTime(snapshot.capturedAt)}</span>
            <span className="truncate text-right">
              {snapshot.elementCount}
              {' '}
              个界面元素
            </span>
            <span className="truncate">{snapshot.provider}</span>
            <span className="truncate text-right">{snapshot.appBundleId ?? '未知应用'}</span>
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
    return '需要授权'
  }
  if (status === 'unavailable') {
    return '不可用'
  }
  if (status === 'error') {
    return '异常'
  }
  return '可用'
}

function SpeakerProfileList({ profiles }: { profiles: ChronicleSpeakerProfile[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {profiles.map(profile => (
        <article key={profile.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <UserRoundIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[13px] font-medium text-foreground">{profile.displayName}</span>
            <Badge variant="outline" className="ml-auto text-[11px]">
              {profile.sampleCount}
              {' '}
              个样本
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px] text-muted-foreground">
            <span className="truncate">
              最近出现
              {' '}
              {formatRelativeTime(profile.lastSeenAt)}
            </span>
            <span className="truncate text-right">
              {profile.embeddingDimensions ? `${profile.embeddingDimensions} 维` : '还没有声纹'}
            </span>
            <span className="truncate">
              {profile.embeddingModelId ?? '说话人标签'}
            </span>
            <span className="truncate text-right">
              {profile.aliases.length}
              {' '}
              个别名
            </span>
          </div>
          {profile.aliases.length > 0 && (
            <p className="mt-2 truncate text-[11px] text-muted-foreground/70">
              {profile.aliases.join(', ')}
            </p>
          )}
        </article>
      ))}
    </div>
  )
}

function AudioTranscriptList({ transcripts }: { transcripts: ChronicleAudioTranscript[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {transcripts.map(transcript => (
        <article key={transcript.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <FileAudioIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[13px] font-medium text-foreground">
              {transcript.title ?? transcript.windowTitle ?? '音频转写'}
            </span>
            <Badge variant="outline" className="ml-auto text-[11px]">{formatTranscriptStatus(transcript.status)}</Badge>
          </div>
          <p className="line-clamp-4 text-[13px] leading-5 text-foreground">
            {transcript.previewText || '这条转写还没有可预览的文本。'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-mono">{formatDateTime(transcript.startedAt)}</span>
            <span>
              {transcript.segmentCount}
              {' '}
              个片段
            </span>
            {transcript.language && <span>{transcript.language}</span>}
            {transcript.source === 'asr' && <span>ASR 转写</span>}
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
              {segment.active ? '有声音' : '安静'}
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
              声道
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <AudioProcessingBadge label="VAD" status={segment.vadStatus} />
            <AudioProcessingBadge label="ASR" status={segment.asrStatus} />
            <AudioProcessingBadge label="说话人" status={segment.speakerStatus} />
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
      {formatAudioProcessingStatus(status)}
    </Badge>
  )
}

function formatAudioSegmentTitle(segment: ChronicleAudioRawSegment): string {
  if (segment.source === 'system') {
    return '系统声音片段'
  }
  if (segment.source === 'mixed') {
    return '混合音频片段'
  }
  return '麦克风片段'
}

function formatAudioProcessingStatus(status: ChronicleAudioRawSegment['vadStatus']): string {
  if (status === 'pending') {
    return '等待中'
  }
  if (status === 'ready') {
    return '已完成'
  }
  if (status === 'error') {
    return '异常'
  }
  return '未接入'
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

function formatMemoryType(type: MemoryEntry['type']): string {
  if (type === '10min') {
    return '短时记忆'
  }
  return '长时记忆'
}

function MemoryCard({ entry }: { entry: MemoryEntry }) {
  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <BrainIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">{entry.title ?? '活动记忆'}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {entry.matchKind && (
            <Badge variant="outline" className="text-[11px]">
              {getMemoryMatchLabel(entry)}
            </Badge>
          )}
          <Badge variant="secondary" className="text-[11px]">{formatMemoryType(entry.type)}</Badge>
        </div>
      </div>
      <p className="line-clamp-4 text-[13px] leading-5 text-foreground">{entry.content}</p>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="font-mono">{formatDateTime(entry.createdAt)}</span>
        {typeof entry.sourceCount === 'number' && (
          <span>
            {entry.sourceCount}
            {' '}
            个来源
          </span>
        )}
      </div>
    </article>
  )
}

function getMemoryMatchLabel(entry: MemoryEntry): string {
  if (entry.matchKind === 'hybrid') {
    return '混合匹配'
  }
  if (entry.matchKind === 'semantic') {
    return typeof entry.semanticScore === 'number'
      ? `语义 ${entry.semanticScore.toFixed(2)}`
      : '语义'
  }
  return '关键词'
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
