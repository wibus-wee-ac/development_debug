// Input: agent profile query owner, providers SDK, coss UI primitives, motion
// Output: AgentRuntimeSettings — Vercel / Linear / Craft style master-detail provider manager
// Position: Settings → Providers — the only entry point for managing agent runtime profiles

import {
  ChevronRightIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SparklesIcon,
} from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

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
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { cn } from '~/lib/cn'
import type { AgentProfile, ProviderKind } from '~/lib/types'

import { DraftSetupPanel } from './draft-setup-panel'
import { ProfileDetailPanel } from './profile-detail-panel'
import { PROVIDER_ICONS } from './provider-icons'
import { PROVIDER_PRESETS } from './provider-templates'
import type { ProviderPreset } from './provider-templates'

// ─── Constants ─────────────────────────────────────────────────────────────────

const RE_WHITESPACE = /\s+/g
export const ALL_DISABLED_SENTINEL = '__all_disabled__'

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI-compatible',
  'acp-chat': 'ACP Chat',
  'cli-tui': 'CLI',
  'codex': 'Codex',
  'claude-agent': 'Claude Agent',
}

export interface DraftProvider {
  id: string
  presetId: string | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function parseConfig(json: string | null | undefined): Record<string, unknown> {
  if (!json) {
    return {}
  }
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : {}
  }
  catch {
    return {}
  }
}

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

// ─── Root component ───────────────────────────────────────────────────────────

export function AgentRuntimeSettings() {
  const { profiles, refetch, updateProfile, removeProfile } = useAgentProfiles()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftProvider | null>(null)
  const [filter, setFilter] = useState('')

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
      setDraft(null)
      setSelectedId(newProfileId ?? null)
    })
  }, [refetch])

  const handleRemoveProfile = useCallback(async (id: string) => {
    await removeProfile.mutateAsync(id)
    setSelectedId(null)
  }, [removeProfile])

  const handleToggleProfile = useCallback(async (profile: AgentProfile, enabled: boolean) => {
    await updateProfile.mutateAsync({
      id: profile.id,
      body: {
        name: profile.name,
        providerKind: profile.providerKind,
        enabled,
        config: parseConfig(profile.configJson),
        credentialRef: profile.credentialRef ?? '',
      },
    })
  }, [updateProfile])

  return (
    <div
      data-testid="agent-runtime-settings"
      className="flex h-full flex-col overflow-hidden"
    >
      {/* Header */}
      <header className="flex items-end justify-between gap-6 pb-5">
        <div className="space-y-1">
          <h3 className="font-heading text-[15px] font-medium tracking-tight text-foreground">
            Providers
          </h3>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Connect models from OpenAI, Anthropic, Codex or any compatible endpoint.
            They become available across every agent and chat session.
          </p>
        </div>
        <Button
          data-testid="add-provider-btn"
          size="sm"
          onClick={startDraft}
          disabled={!!draft}
        >
          <PlusIcon />
          Add provider
        </Button>
      </header>

      <Separator className="bg-foreground/6" />

      {/* Body — master-detail */}
      <div className="grid flex-1 grid-cols-[260px_1fr] gap-0 overflow-hidden">
        {/* ── Left rail ────────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-3 overflow-hidden py-4 pr-4 border-r border-foreground/6">
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
              <AnimatePresence initial={false}>
                {draft && (
                  <m.div
                    key={draft.id}
                    initial={{ opacity: 0, y: -4, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -4, height: 0 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                  >
                    <SidebarRow
                      active={isDraftSelected}
                      onClick={() => setSelectedId(draft.id)}
                      icon={(
                        <span className="flex size-7 items-center justify-center rounded-lg border border-dashed border-foreground/15 text-muted-foreground">
                          <SparklesIcon className="size-3.5" />
                        </span>
                      )}
                      title="New provider"
                      subtitle="Pick a template"
                      isDraft
                    />
                  </m.div>
                )}
              </AnimatePresence>

              {visibleProfiles.map((profile) => {
                const preset = presetForProfile(profile)
                const { Icon } = providerVisuals(preset.id)
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
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    title={profile.name}
                    subtitle={(() => {
                      const cfg = parseConfig(profile.configJson)
                      const m = typeof cfg.model === 'string' ? cfg.model : ''
                      return m ? `${PROVIDER_KIND_LABELS[profile.providerKind]} · ${m}` : PROVIDER_KIND_LABELS[profile.providerKind]
                    })()}
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
                    onSaved={() => void refetch()}
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
  isDraft,
  testId,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  subtitle?: string
  badge?: React.ReactNode
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

function StatusDot({ tone }: { tone: 'active' | 'muted' | 'warning' }) {
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
