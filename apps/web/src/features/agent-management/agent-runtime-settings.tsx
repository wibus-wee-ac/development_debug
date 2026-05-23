/* eslint-disable react-refresh/only-export-components */

import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ChevronRightIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  ServerIcon,
  SparklesIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getExternalProviderSourcesRecordsOptions, postExternalProviderSourcesRefreshMutation } from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
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
import { toastManager } from '~/components/ui/toast'
import { ALL_MODELS_DISABLED_SENTINEL } from '~/features/agent-runtime/model-visibility'
import { ProfileConfigJsonSchema } from '~/features/agent-runtime/profile-config-schema'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { cn } from '~/lib/cn'
import type { AgentProfile, ProviderKind } from '~/lib/types'

import { DraftSetupPanel } from './draft-setup-panel'
import { ProfileDetailPanel } from './profile-detail-panel'
import { PROVIDER_ICONS, ProviderIcon } from './provider-icons'
import type { ProviderPreset } from './provider-templates'
import { PROVIDER_PRESETS } from './provider-templates'

// ─── Constants ─────────────────────────────────────────────────────────────────

const RE_WHITESPACE = /\s+/g
export const ALL_DISABLED_SENTINEL = ALL_MODELS_DISABLED_SENTINEL

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI-compatible',
  'anthropic': 'Anthropic',
}

export interface DraftProvider {
  id: string
  presetId: string | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function buildProfileId(name: string, fallback: string): string {
  const base = name.trim().toLowerCase().replace(RE_WHITESPACE, '-')
  return base || fallback
}

export function presetForProfile(profile: AgentProfile): ProviderPreset {
  return (
    PROVIDER_PRESETS.find(p => p.providerKind === profile.providerKind)
    ?? PROVIDER_PRESETS.at(-1)!
  )
}

export function providerVisuals(presetId: string | null) {
  return {
    Icon: PROVIDER_ICONS[presetId ?? ''] ?? PROVIDER_ICONS.custom!,
  }
}

function parseProfileConfigForUpdate(configJson: string): Record<string, unknown> {
  const parsed = JSON.parse(configJson) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }
  return parsed as Record<string, unknown>
}

// ─── Root component ───────────────────────────────────────────────────────────

export function AgentRuntimeSettings() {
  const { profiles, isSuccess: profilesReady, refetch, updateProfile, removeProfile } = useAgentProfiles()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftProvider | null>(null)
  const [filter, setFilter] = useState('')
  const {
    data: externalRecords = [],
    isSuccess: externalRecordsReady,
    refetch: refetchExternalRecords
  } = useQuery({
    ...getExternalProviderSourcesRecordsOptions(),
    retry: false,
  })
  const settingsProvidersReady = profilesReady && externalRecordsReady

  const refreshExternalSources = useMutation({
    ...postExternalProviderSourcesRefreshMutation(),
    onSuccess: async (data) => {
      await Promise.all([refetch(), refetchExternalRecords()])

      const results = Array.isArray(data) ? data : [data]
      const errors = results.filter((r) => r.status === 'error')
      const ok = results.filter((r) => r.status !== 'error')

      if (errors.length > 0) {
        toastManager.add({
          type: 'error',
          title: `${errors.length} source(s) failed to sync`,
          description: errors.map((e) => e.message ?? e.sourceKey).join(', ') || undefined,
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
        description: error instanceof Error ? error.message : 'External sources could not be refreshed',
      })
    },
  })

  const externalProfileIds = useMemo(() => new Set(externalRecords.map(record => record.id)), [externalRecords])

  const visibleProfiles = useMemo(() => {
    if (!filter.trim()) {
      return profiles
    }
    const q = filter.trim().toLowerCase()
    return profiles.filter(p =>
      p.name.toLowerCase().includes(q)
      || (PROVIDER_KIND_LABELS[p.providerKind] ?? '').toLowerCase().includes(q))
  }, [profiles, filter])

  const selectedProfile = profiles.find(p => p.id === selectedId) ?? null
  const isDraftSelected = !!(draft && selectedId === draft.id)

  useEffect(() => {
    if (draft || !selectedId) {
      return
    }
    if (!profiles.some(profile => profile.id === selectedId)) {
      setSelectedId(null)
    }
  }, [draft, profiles, selectedId])

  const startDraft = useCallback(() => {
    const id = `draft-${Date.now()}`
    setDraft({ id, presetId: null })
    setSelectedId(id)
  }, [])

  const cancelDraft = useCallback(() => {
    setDraft(null)
    setSelectedId(null)
  }, [])

  const handleDraftComplete = useCallback((newProfileId?: string) => {
    void refetch().finally(() => {
      refetchExternalRecords()
      setDraft(null)
      setSelectedId(newProfileId ?? null)
    })
  }, [refetch, refetchExternalRecords])

  const handleRemoveProfile = useCallback(async (id: string) => {
    if (externalProfileIds.has(id)) {
      return
    }
    await removeProfile.mutateAsync(id)
    setSelectedId(null)
  }, [externalProfileIds, removeProfile])

  const handleToggleProfile = useCallback(async (profile: AgentProfile, enabled: boolean) => {
    await updateProfile.mutateAsync({
      id: profile.id,
      body: {
        name: profile.name,
        providerKind: profile.providerKind,
        enabled,
        config: parseProfileConfigForUpdate(profile.configJson),
        credentialRef: profile.credentialRef ?? null,
      },
    })
  }, [updateProfile])

  return (
    <div
      data-testid="agent-runtime-settings"
      data-settings-providers-ready={settingsProvidersReady ? 'true' : 'false'}
      className="flex h-full flex-col overflow-hidden"
    >
      {/* Header */}
      <header className="flex items-end justify-between gap-6 pb-5">
        <div className="space-y-1">
          <h3 className="font-heading text-[15px] font-medium tracking-tight text-foreground text-balance">
            Providers
          </h3>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Connect models from OpenAI, Anthropic, Codex or any compatible endpoint.
            They become available across every agent and chat session.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refreshExternalSources.mutate({})}
            disabled={refreshExternalSources.isPending}
          >
            <RefreshCwIcon className={cn('size-3.5', refreshExternalSources.isPending && 'animate-spin')} />
            Refresh sources
          </Button>
          <Button
            data-testid="add-provider-btn"
            size="sm"
            onClick={startDraft}
            disabled={!!draft}
          >
            <PlusIcon />
            Add provider
          </Button>
        </div>
      </header>

      <Separator className="bg-foreground/6" />

      {/* Body — master-detail */}
      <div className="grid flex-1 grid-cols-[360px_1fr] gap-0 overflow-hidden">
        {/* ── Left rail ────────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-3 overflow-hidden py-4 pr-4 border-r border-foreground/6 overflow-y-auto">
          {/* Search */}
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search providers"
              className="h-8 pl-8 pr-2 text-[12.5px]"
            />
          </div>

          {/* List */}
          <ScrollArea className="-mx-1 flex-1">
            <div className="flex flex-col gap-0.5 px-1">
              {draft && (
                <SidebarRow
                  active={isDraftSelected}
                  onClick={() => setSelectedId(draft.id)}
                  icon={(
                    <span className="flex size-5 items-center justify-center rounded-sm border border-dashed border-foreground/15 text-muted-foreground -ml-0.5">
                      <SparklesIcon className="size-2.5" />
                    </span>
                  )}
                  title="New provider"
                  subtitle="Pick a template"
                  isDraft
                />
              )}

              {visibleProfiles.map((profile) => {
                const preset = presetForProfile(profile)
                const active = selectedId === profile.id && !isDraftSelected
                return (
                  <SidebarRow
                    key={profile.id}
                    testId={`agent-profile-row-${profile.id}`}
                    active={active}
                    onClick={() => {
                      setSelectedId(profile.id)
                      setDraft(null)
                    }}
                    icon={(
                      <ProviderIcon iconSlug={profile.iconSlug} presetId={preset.id} className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    title={profile.name}
                    subtitle={(() => {
                      const cfg = ProfileConfigJsonSchema.parse(profile.configJson)
                      const m = cfg.model
                      return m ? `${PROVIDER_KIND_LABELS[profile.providerKind]} · ${m}` : PROVIDER_KIND_LABELS[profile.providerKind]
                    })()}
                    external={externalProfileIds.has(profile.id)}
                    badge={!profile.enabled
                      ? <StatusDot tone="muted" />
                      : <StatusDot tone="active" />}
                  />
                )
              })}

              {/* Empty state inside list */}
              {visibleProfiles.length === 0 && !draft && (
                <div className="px-2 py-6 text-center">
                  <p className="text-[11.5px] text-muted-foreground/70">
                    {filter ? 'No matches' : 'No providers yet'}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer hint */}
          {profiles.length > 0 && (
            <div className="px-1 pt-1 text-[10.5px] tabular-nums text-muted-foreground/60">
              {profiles.length}
              {' '}
              provider
              {profiles.length === 1 ? '' : 's'}
              {' '}
              ·
              {' '}
              {profiles.filter(p => p.enabled).length}
              {' '}
              active
            </div>
          )}
        </aside>

        {/* ── Right panel ──────────────────────────────────────────────── */}
        <section className="flex flex-col overflow-y-auto py-4 pl-6 pr-2">
          {isDraftSelected && draft
            ? (
              <div className="flex-1">
                <DraftSetupPanel
                  draft={draft}
                  onSelectPreset={presetId => setDraft(prev => prev ? { ...prev, presetId } : prev)}
                  onComplete={handleDraftComplete}
                  onCancel={cancelDraft}
                />
              </div>
            )
            : selectedProfile
              ? (
                <div key={selectedProfile.id} className="flex-1">
                  <ProfileDetailPanel
                    profile={selectedProfile}
                    onRemove={() => void handleRemoveProfile(selectedProfile.id)}
                    onToggle={enabled => void handleToggleProfile(selectedProfile, enabled)}
                    onSaved={() => {
                      void refetch()
                      refetchExternalRecords()
                    }}
                  />
                </div>
              )
              : (
                <div className="flex flex-1 items-center justify-center">
                  <Empty className="border-none">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <ServerIcon />
                      </EmptyMedia>
                      <EmptyTitle>No provider selected</EmptyTitle>
                      <EmptyDescription>
                        Pick a provider on the left to view its configuration, or
                        add a new one to get started.
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

// ─── Sidebar row ──────────────────────────────────────────────────────────────

function SidebarRow({
  active,
  icon,
  title,
  subtitle,
  badge,
  external,
  isDraft,
  testId,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  subtitle?: string
  badge?: React.ReactNode
  external?: boolean
  isDraft?: boolean
  testId?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'group/sidebar-row relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none',
        'transition-[background-color,opacity,scale] duration-150',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        active
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-foreground/[0.035] active:bg-foreground/6 active:scale-[0.98]',
        isDraft && !active && 'opacity-90',
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn(
            'block truncate text-[12.5px] leading-tight',
            active ? 'font-medium text-foreground' : 'text-foreground/90',
          )}
          >
            {title}
          </span>
          {badge}
          {external && (
            <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9.5px] font-medium leading-none text-blue-700 dark:text-blue-300">
              External
            </span>
          )}
        </div>
        {subtitle && (
          <span className="block truncate text-[10.5px] leading-tight text-muted-foreground/70">
            {subtitle}
          </span>
        )}
      </div>
      <ChevronRightIcon
        className={cn(
          'size-3 shrink-0 text-muted-foreground/40 transition-[opacity,transform] duration-150',
          active ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1 group-hover/sidebar-row:opacity-60 group-hover/sidebar-row:translate-x-0',
        )}
      />
    </button>
  )
}

export function StatusDot({ tone }: { tone: 'active' | 'muted' | 'warning' }) {
  return (
    <span
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        tone === 'active' && 'bg-emerald-500',
        tone === 'muted' && 'bg-muted-foreground/30',
        tone === 'warning' && 'bg-amber-500',
      )}
      aria-hidden
    />
  )
}
