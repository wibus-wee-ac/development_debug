// Input: Chronicle hooks, ProviderModelPicker, settings-row primitives
// Output: ChronicleSettings — settings panel for Chronicle screen recording + memory
// Position: apps/web/src/features/chronicle/chronicle-settings.tsx

import { useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIcon, BrainIcon, ClockIcon, CpuIcon, EyeIcon, ImageIcon } from 'lucide-react'

import { Badge } from '~/components/ui/badge'
import { Switch } from '~/components/ui/switch'
import { getServerUrl } from '~/lib/electron'
import { useAgentModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import { SettingsDivider, SettingsRow, SettingsSectionHeader } from '~/features/settings/settings-row'

import type { TimelineEntry } from './use-chronicle'
import { useChronicleConfig, useChronicleMemories, useChronicleStatus, useChronicleTimeline } from './use-chronicle'

function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return 'Never'
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

export function ChronicleSettings() {
  const { config, loading: configLoading, saving, updateConfig } = useChronicleConfig()
  const { status, loading: statusLoading } = useChronicleStatus()
  const { entries: timelineEntries, loading: timelineLoading } = useChronicleTimeline()
  const { entries: memoryEntries, loading: memoriesLoading } = useChronicleMemories()
  const { profiles } = useAgentProfiles()
  const { modelsByProfileId, loadingProfileIds } = useAgentModelMap(profiles)

  const selectedProfile = useMemo(
    () => profiles.find(p => p.id === config?.profileId) ?? null,
    [config?.profileId, profiles],
  )
  const selectedModels = selectedProfile ? modelsByProfileId[selectedProfile.id] ?? [] : []
  const selectedModel = selectedModels.find(m => m.id === config?.modelId) ?? null

  if (configLoading) {
    return null
  }

  return (
    <div className="flex flex-col gap-0">
      <SettingsSectionHeader
        title="Chronicle"
        description="Screen recording and AI-powered memory. Chronicle captures your screen periodically and generates contextual summaries."
      />
      <SettingsDivider />

      {/* Enable toggle */}
      <SettingsRow label="Enable Chronicle" description="Start capturing screen activity and generating summaries">
        <Switch
          checked={config?.enabled ?? false}
          onCheckedChange={enabled => void updateConfig({ enabled })}
          disabled={saving}
        />
      </SettingsRow>
      <SettingsDivider />

      {/* Model picker */}
      <SettingsRow label="Model" description="Choose the provider and model for generating summaries">
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
            if (!model) return
            void updateConfig({ profileId, modelId: model })
          }}
          onSelectThinking={() => {}}
        />
      </SettingsRow>
      <SettingsDivider />

      {/* Status card */}
      {!statusLoading && status && (
        <div className="py-4">
          <div className="rounded-lg border border-foreground/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <ActivityIcon className="size-3.5 text-muted-foreground" />
              <span className="text-[13px] font-medium text-foreground">Status</span>
              <Badge variant={status.running ? 'default' : 'secondary'} className="ml-auto text-[11px]">
                {status.running ? 'Running' : 'Stopped'}
              </Badge>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <StatusItem
                icon={<EyeIcon className="size-3.5" />}
                label="Daemon"
                value={status.running ? `PID ${status.pid}` : 'Not running'}
              />
              <StatusItem
                icon={<ClockIcon className="size-3.5" />}
                label="Last summary"
                value={formatRelativeTime(status.lastSummaryAt)}
              />
              <StatusItem
                icon={<ImageIcon className="size-3.5" />}
                label="Total summaries"
                value={String(status.totalSummaries)}
              />
            </div>

            {status.configuredModel && (
              <div className="mt-3 flex items-center gap-2 pt-3 border-t border-foreground/5">
                <CpuIcon className="size-3.5 text-muted-foreground" />
                <span className="text-[12px] text-muted-foreground">Model:</span>
                <span className="text-[12px] text-foreground">{status.configuredModel}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Timeline */}
      <SettingsDivider />
      <SettingsSectionHeader
        title="Timeline"
        description="Interactive timeline of screen captures"
      />
      <div className="py-4">
        {timelineLoading
          ? null
          : timelineEntries.length === 0
            ? (
                <p className="text-center text-[13px] text-muted-foreground py-8">No captures yet</p>
              )
            : (
                <TimelineScrubber entries={timelineEntries} />
              )}
      </div>

      {/* Memories */}
      <SettingsDivider />
      <SettingsSectionHeader
        title="Memories"
        description="AI-generated summaries of your activity"
      />
      <div className="py-4">
        {memoriesLoading
          ? null
          : memoryEntries.length === 0
            ? (
                <p className="text-center text-[13px] text-muted-foreground py-8">No memories yet</p>
              )
            : (
                <div className="flex flex-col gap-3">
                  {memoryEntries.map(entry => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-foreground/5 p-3"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <BrainIcon className="size-3.5 text-muted-foreground" />
                        <Badge variant="secondary" className="text-[11px]">
                          {entry.type}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground ml-auto">
                          {new Date(entry.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[13px] text-foreground line-clamp-3">
                        {entry.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
      </div>
    </div>
  )
}

// ── Timeline Scrubber ──

function TimelineScrubber({ entries }: { entries: TimelineEntry[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const seekRef = useRef<HTMLDivElement>(null)
  const serverUrl = getServerUrl()

  const frameUrl = useCallback(
    (entry: TimelineEntry) => `${serverUrl}/chronicle/frame/${entry.segmentDir}/${entry.framePath}`,
    [serverUrl],
  )

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      setSelectedIndex(i => Math.min(i + 1, entries.length - 1))
    }
    else if (e.key === 'ArrowRight') {
      setSelectedIndex(i => Math.max(i - 1, 0))
    }
  }, [entries.length])

  const getIndexFromMouseEvent = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = seekRef.current
    if (!el) {
      return null
    }
    const rect = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const ratio = x / rect.width
    // Left=oldest (high index), Right=newest (index 0)
    const index = Math.round((1 - ratio) * (entries.length - 1))
    return Math.max(0, Math.min(entries.length - 1, index))
  }, [entries.length])

  const selected = entries[selectedIndex]
  if (!selected) {
    return null
  }

  const displayEntry = hoverIndex !== null ? entries[hoverIndex] : selected
  const displayTime = new Date(displayEntry?.capturedAt ?? selected.capturedAt)

  // Time range for the timeline
  const startTime = new Date(entries.at(-1)!.capturedAt)
  const endTime = new Date(entries[0].capturedAt)

  return (
    <div
      className="flex flex-col gap-3 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Main preview */}
      <div className="relative rounded-lg overflow-hidden bg-black/95">
        <img
          src={frameUrl(displayEntry ?? selected)}
          alt={`Capture at ${displayEntry?.capturedAt}`}
          className="w-full aspect-video object-contain"
        />
      </div>

      {/* Seek bar */}
      <div className="flex flex-col gap-1.5 overflow-visible">
        <div
          ref={seekRef}
          className="relative h-12 cursor-pointer group overflow-visible"
          onClick={(e) => {
            const idx = getIndexFromMouseEvent(e)
            if (idx !== null) {
              setSelectedIndex(idx)
            }
          }}
          onMouseMove={(e) => {
            const idx = getIndexFromMouseEvent(e)
            setHoverIndex(idx)
          }}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Track background */}
          <div className="absolute inset-x-0 bottom-2 h-2 rounded-full bg-foreground/15 overflow-hidden">
            {/* Progress fill — represents how far into the timeline we are (left=oldest, right=newest) */}
            <div
              className="h-full bg-foreground/40 rounded-full transition-all duration-150"
              style={{ width: `${entries.length > 1 ? ((entries.length - 1 - selectedIndex) / (entries.length - 1)) * 100 : 100}%` }}
            />
          </div>

          {/* Hover position indicator */}
          {hoverIndex !== null && (
            <div
              className="absolute bottom-1 w-0.5 h-4 bg-foreground/60 rounded-full -translate-x-1/2"
              style={{ left: `${entries.length > 1 ? ((entries.length - 1 - hoverIndex) / (entries.length - 1)) * 100 : 50}%` }}
            />
          )}

          {/* Playhead — left=oldest, right=newest */}
          <div
            className="absolute bottom-1 -translate-x-1/2 transition-[left] duration-150"
            style={{ left: `${entries.length > 1 ? ((entries.length - 1 - selectedIndex) / (entries.length - 1)) * 100 : 50}%` }}
          >
            <div className="w-3.5 h-3.5 rounded-full bg-foreground" />
          </div>

          {/* Hover tooltip preview */}
          {hoverIndex !== null && entries[hoverIndex] && (
            <div
              className="absolute bottom-full mb-1 -translate-x-1/2 pointer-events-none z-50"
              style={{ left: `${entries.length > 1 ? ((entries.length - 1 - hoverIndex) / (entries.length - 1)) * 100 : 50}%` }}
            >
              <div className="w-36 rounded-lg overflow-hidden border border-foreground/10 bg-background inset-shadow-sm">
                <img
                  src={frameUrl(entries[hoverIndex])}
                  alt=""
                  className="w-full aspect-video object-cover"
                />
                <div className="px-1.5 py-1 text-center">
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {new Date(entries[hoverIndex].capturedAt).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Time labels */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/50 font-mono">
            {startTime.toLocaleTimeString()}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">
            {displayTime.toLocaleTimeString()}
          </span>
          <span className="text-[11px] text-muted-foreground/50 font-mono">
            {endTime.toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  )
}

function StatusItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <span className="text-[13px] font-medium text-foreground">{value}</span>
    </div>
  )
}
