// Input: profiles SDK, secrets SDK, providers SDK, coss UI primitives, motion
// Output: AgentRuntimeSettings — Vercel / Linear / Craft style master-detail provider manager
// Position: Settings → Providers — the only entry point for managing agent runtime profiles

import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  KeyRoundIcon,
  LinkIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  deleteProfilesById,
  getProfiles,
  postProvidersHealthCheck,
  postProvidersModels,
  postSecrets,
  putProfilesById,
} from '~/api-gen/sdk.gen'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import type { AgentProfile, ModelDescriptor, ProviderKind } from '~/lib/types'

import { PROVIDER_ACCENT, PROVIDER_ICONS } from './provider-icons'
import type { ProviderPreset } from './provider-templates'
import { PROVIDER_PRESETS } from './provider-templates'

// ─── Constants ─────────────────────────────────────────────────────────────────

const RE_WHITESPACE = /\s+/g
const ALL_DISABLED_SENTINEL = '__all_disabled__'

const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI-compatible',
  'acp-chat': 'ACP Chat',
  'cli-tui': 'CLI',
  'codex': 'Codex',
  'claude-agent': 'Claude Agent',
}

type HealthStatus = 'unknown' | 'verifying' | 'connected' | 'failed'

interface DraftProvider {
  id: string
  presetId: string | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseConfig(json: string | null | undefined): Record<string, unknown> {
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

function buildProfileId(name: string, fallback: string): string {
  const base = name.trim().toLowerCase().replace(RE_WHITESPACE, '-')
  return base || fallback
}

function presetForProfile(profile: AgentProfile): ProviderPreset {
  return (
    PROVIDER_PRESETS.find(p => p.providerKind === profile.providerKind)
    ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]!
  )
}

function providerVisuals(presetId: string | null) {
  const accentKey = presetId
    ? PROVIDER_PRESETS.find(p => p.id === presetId)?.accent ?? 'violet'
    : 'violet'
  return {
    accent: PROVIDER_ACCENT[accentKey] ?? PROVIDER_ACCENT.violet!,
    Icon: PROVIDER_ICONS[presetId ?? ''] ?? PROVIDER_ICONS.custom!,
  }
}

// ─── Root component ───────────────────────────────────────────────────────────

export function AgentRuntimeSettings() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftProvider | null>(null)
  const [filter, setFilter] = useState('')

  const refreshProfiles = useCallback(async (preferredId?: string) => {
    const { data } = await getProfiles()
    const list = (data ?? []) as AgentProfile[]
    setProfiles(list)
    if (preferredId && list.some(p => p.id === preferredId)) {
      setSelectedId(preferredId)
    }
  }, [])

  useEffect(() => {
    refreshProfiles().catch(() => setProfiles([]))
  }, [refreshProfiles])

  const visibleProfiles = useMemo(() => {
    if (!filter.trim()) {
      return profiles
    }
    const q = filter.trim().toLowerCase()
    return profiles.filter(p =>
      p.name.toLowerCase().includes(q)
      || (PROVIDER_KIND_LABELS[p.providerKind] ?? '').toLowerCase().includes(q),
    )
  }, [profiles, filter])

  const selectedProfile = profiles.find(p => p.id === selectedId) ?? null
  const isDraftSelected = !!(draft && selectedId === draft.id)

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
    setDraft(null)
    void refreshProfiles(newProfileId)
    if (newProfileId) {
      setSelectedId(newProfileId)
    }
    else {
      setSelectedId(null)
    }
  }, [refreshProfiles])

  const handleRemoveProfile = useCallback(async (id: string) => {
    await deleteProfilesById({ path: { id } })
    setSelectedId(null)
    await refreshProfiles()
  }, [refreshProfiles])

  const handleToggleProfile = useCallback(async (profile: AgentProfile, enabled: boolean) => {
    await putProfilesById({
      path: { id: profile.id },
      body: {
        name: profile.name,
        providerKind: profile.providerKind,
        enabled,
        config: parseConfig(profile.configJson),
        credentialRef: profile.credentialRef ?? '',
      },
    })
    await refreshProfiles()
  }, [refreshProfiles])

  return (
    <div
      data-testid="agent-runtime-settings"
      className="flex flex-col"
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

      <Separator className="bg-foreground/[0.06]" />

      {/* Body — master-detail */}
      <div className="grid grid-cols-[260px_1fr] gap-0 min-h-[480px]">
        {/* ── Left rail ────────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-2 py-4 pr-4 border-r border-foreground/[0.06]">
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
                  <motion.div
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
                  </motion.div>
                )}
              </AnimatePresence>

              {visibleProfiles.map((profile) => {
                const preset = presetForProfile(profile)
                const { accent, Icon } = providerVisuals(preset.id)
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
                      <span className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-lg',
                        accent.bg,
                        accent.text,
                      )}
                      >
                        <Icon className="size-3.5" />
                      </span>
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
            <div className="px-1 pt-1 text-[10.5px] text-muted-foreground/60">
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
        <section className="flex flex-col py-4 pl-6">
          <AnimatePresence mode="wait" initial={false}>
            {isDraftSelected && draft
              ? (
                <motion.div
                  key="draft"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="flex-1"
                >
                  <DraftSetupPanel
                    draft={draft}
                    onSelectPreset={presetId => setDraft({ ...draft, presetId })}
                    onComplete={handleDraftComplete}
                    onCancel={cancelDraft}
                  />
                </motion.div>
              )
              : selectedProfile
                ? (
                  <motion.div
                    key={`profile-${selectedProfile.id}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="flex-1"
                  >
                    <ProfileDetailPanel
                      profile={selectedProfile}
                      onRemove={() => void handleRemoveProfile(selectedProfile.id)}
                      onToggle={enabled => void handleToggleProfile(selectedProfile, enabled)}
                      onSaved={() => void refreshProfiles()}
                    />
                  </motion.div>
                )
                : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-1 items-center justify-center"
                  >
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
                  </motion.div>
                )}
          </AnimatePresence>
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
        'group/sidebar-row relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-all',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        active
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-foreground/[0.035] active:bg-foreground/[0.06]',
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
          'size-3 shrink-0 text-muted-foreground/40 transition-all',
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

// ─── Draft setup panel ────────────────────────────────────────────────────────

function DraftSetupPanel({
  draft,
  onSelectPreset,
  onComplete,
  onCancel,
}: {
  draft: DraftProvider
  onSelectPreset: (presetId: string) => void
  onComplete: (newProfileId?: string) => void
  onCancel: () => void
}) {
  const preset = PROVIDER_PRESETS.find(p => p.id === draft.presetId) ?? null

  if (!preset) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-heading text-[14px] font-medium text-foreground">
              Choose a provider
            </h4>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Cradle works with the major coding agents and any OpenAI-compatible endpoint.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <XIcon />
            Cancel
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {PROVIDER_PRESETS.map((p, idx) => {
            const accent = PROVIDER_ACCENT[p.accent] ?? PROVIDER_ACCENT.violet!
            const Icon = PROVIDER_ICONS[p.id] ?? PROVIDER_ICONS.custom!
            return (
              <motion.button
                key={p.id}
                type="button"
                onClick={() => onSelectPreset(p.id)}
                data-testid={`provider-preset-${p.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: idx * 0.03, ease: 'easeOut' }}
                whileHover={{ y: -1 }}
                className={cn(
                  'group/preset relative flex flex-col gap-2 rounded-xl bg-card p-3.5 text-left',
                  'ring-1 ring-foreground/[0.07] transition-all duration-150',
                  'hover:ring-foreground/15 hover:shadow-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className={cn(
                    'flex size-8 items-center justify-center rounded-lg',
                    accent.bg,
                    accent.text,
                  )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-foreground">
                      {p.name}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {PROVIDER_KIND_LABELS[p.providerKind]}
                    </div>
                  </div>
                  <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/30 transition-all group-hover/preset:translate-x-0.5 group-hover/preset:text-muted-foreground" />
                </div>
                <p className="text-pretty text-[11.5px] leading-relaxed text-muted-foreground/80">
                  {p.tagline}
                </p>
              </motion.button>
            )
          })}
        </div>
      </div>
    )
  }

  return <PresetSetupForm preset={preset} onComplete={onComplete} onBack={() => onSelectPreset('')} />
}

// ─── Preset setup form ────────────────────────────────────────────────────────

function PresetSetupForm({
  preset,
  onComplete,
  onBack,
}: {
  preset: ProviderPreset
  onComplete: (newProfileId?: string) => void
  onBack: () => void
}) {
  const accent = PROVIDER_ACCENT[preset.accent] ?? PROVIDER_ACCENT.violet!
  const Icon = PROVIDER_ICONS[preset.id] ?? PROVIDER_ICONS.custom!

  const [name, setName] = useState(preset.name)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean, text: string } | null>(null)

  const profileId = buildProfileId(name, preset.id)
  const canSubmit = name.trim().length > 0

  const handleConnect = useCallback(async () => {
    setBusy(true)
    setStatus(null)
    try {
      let credentialRef: string | null = null
      const apiKey = values.apiKey
      if (apiKey) {
        const { data: meta } = await postSecrets({
          body: { kind: preset.providerKind, label: name, secret: apiKey } as unknown as never,
        })
        credentialRef = (meta as Record<string, unknown>)?.id as string ?? null
      }

      const config: Record<string, unknown> = { ...preset.defaults }
      if (values.baseUrl) {
        config.baseUrl = values.baseUrl
      }
      if (values.model) {
        config.model = values.model
      }

      await putProfilesById({
        path: { id: profileId },
        body: { name, providerKind: preset.providerKind, enabled: true, config, credentialRef },
      })

      try {
        const { data: hcResult } = await postProvidersHealthCheck({
          body: { providerKind: preset.providerKind, label: name, config, secretRef: credentialRef, profileId },
        })
        const hc = hcResult as { ok: boolean, errorText?: string } | null
        if (hc?.ok) {
          setStatus({ ok: true, text: 'Connected' })
          setTimeout(() => onComplete(profileId), 600)
        }
        else {
          setStatus({ ok: false, text: hc?.errorText ?? 'Verification failed' })
        }
      }
      catch {
        setStatus({ ok: true, text: 'Saved (verification skipped)' })
        setTimeout(() => onComplete(profileId), 500)
      }
    }
    catch (err) {
      setStatus({ ok: false, text: 'Failed to save provider' })
      console.error('[ProviderSetup]', err)
    }
    finally {
      setBusy(false)
    }
  }, [preset, name, values, profileId, onComplete])

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md py-0.5 px-1 -ml-1 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3" />
          Templates
        </button>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-foreground">{preset.name}</span>
      </div>

      {/* Hero */}
      <div className="flex items-start gap-3">
        <span className={cn(
          'flex size-10 items-center justify-center rounded-xl ring-1 ring-foreground/5',
          accent.bg,
          accent.text,
        )}
        >
          <Icon className="size-5" />
        </span>
        <div className="flex-1 pt-0.5">
          <h4 className="font-heading text-[15px] font-medium text-foreground">
            {preset.name}
          </h4>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {preset.tagline}
          </p>
        </div>
      </div>

      <Separator className="bg-foreground/[0.06]" />

      {/* Form */}
      <FieldGroup className="gap-4">
        <Field orientation="vertical">
          <FieldLabel htmlFor="provider-name" className="text-[12.5px] font-medium">
            Display name
          </FieldLabel>
          <FieldContent>
            <Input
              id="provider-name"
              data-testid="provider-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={preset.name}
              className="h-9 text-[13px]"
            />
            <FieldDescription className="text-[11px]">
              This is how the provider shows up in chat and agent settings.
            </FieldDescription>
          </FieldContent>
        </Field>

        {preset.fields.map((field) => {
          const isBaseUrl = field.key === 'baseUrl'
          const isApiKey = field.key === 'apiKey'
          const isModel = field.key === 'model'
          const FieldIcon = isApiKey ? KeyRoundIcon : isBaseUrl ? LinkIcon : null
          const testId = isBaseUrl
            ? 'provider-baseurl'
            : isApiKey
              ? 'provider-apikey'
              : isModel
                ? 'provider-model'
                : `provider-field-${field.key}`
          return (
            <Field key={field.key} orientation="vertical">
              <FieldLabel htmlFor={`provider-${field.key}`} className="text-[12.5px] font-medium">
                <div className="flex items-center gap-1.5">
                  {FieldIcon && <FieldIcon className="size-3 text-muted-foreground/70" />}
                  {field.label}
                </div>
              </FieldLabel>
              <FieldContent>
                <Input
                  id={`provider-${field.key}`}
                  data-testid={testId}
                  type={field.type === 'password' ? 'password' : 'text'}
                  value={values[field.key] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className={cn('h-9 text-[13px]', field.mono && 'font-mono')}
                />
                {isApiKey && (
                  <FieldDescription className="text-[11px]">
                    Stored locally and encrypted. Never sent to Cradle servers.
                  </FieldDescription>
                )}
              </FieldContent>
            </Field>
          )
        })}

        {preset.fields.length === 0 && (
          <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground ring-1 ring-foreground/[0.04]">
            No credentials needed — this provider runs on your machine.
          </div>
        )}
      </FieldGroup>

      {/* Status */}
      <AnimatePresence>
        {status && (
          <motion.div
            data-testid="provider-status"
            data-status-ok={status.ok ? 'true' : 'false'}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium ring-1',
              status.ok
                ? 'bg-emerald-500/[0.08] text-emerald-600 ring-emerald-500/15 dark:text-emerald-400'
                : 'bg-destructive/[0.08] text-destructive ring-destructive/15',
            )}
          >
            {status.ok
              ? <CircleCheckIcon className="size-3.5" />
              : <CircleAlertIcon className="size-3.5" />}
            {status.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          data-testid="provider-submit"
          size="sm"
          onClick={() => void handleConnect()}
          disabled={busy || !canSubmit}
        >
          {busy ? <Spinner className="size-3" /> : <CheckIcon />}
          {busy ? 'Connecting…' : 'Connect provider'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  )
}

// ─── Existing profile detail panel ────────────────────────────────────────────

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

function ProfileDetailPanel({
  profile,
  onRemove,
  onToggle,
  onSaved,
}: {
  profile: AgentProfile
  onRemove: () => void
  onToggle: (enabled: boolean) => void
  onSaved: () => void
}) {
  const preset = presetForProfile(profile)
  const { accent, Icon } = providerVisuals(preset.id)

  const parsed = useMemo(() => parseConfig(profile.configJson), [profile.configJson])
  const supportsModels = profile.providerKind === 'openai-compatible'
    || profile.providerKind === 'codex'
    || profile.providerKind === 'claude-agent'
  const supportsCommand = profile.providerKind === 'cli-tui' || profile.providerKind === 'acp-chat'

  const [name, setName] = useState(profile.name)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '')
  const [model, setModel] = useState(typeof parsed.model === 'string' ? parsed.model : '')
  const [command, setCommand] = useState(
    typeof parsed.executable === 'string'
      ? parsed.executable
      : typeof parsed.cmd === 'string' ? parsed.cmd : '',
  )
  const [enabledModels, setEnabledModels] = useState<string[]>(() => {
    const arr = parsed.enabledModels
    if (!Array.isArray(arr)) {
      return []
    }
    if (arr.length === 0) {
      return [ALL_DISABLED_SENTINEL]
    }
    return arr as string[]
  })

  const [availableModels, setAvailableModels] = useState<ModelDescriptor[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [health, setHealth] = useState<HealthStatus>('unknown')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextAutoSave = useRef(true)

  // Reset state when switching profile
  useEffect(() => {
    skipNextAutoSave.current = true
    setName(profile.name)
    setApiKey('')
    setBaseUrl(typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '')
    setModel(typeof parsed.model === 'string' ? parsed.model : '')
    setCommand(
      typeof parsed.executable === 'string'
        ? parsed.executable
        : typeof parsed.cmd === 'string' ? parsed.cmd : '',
    )
    const arr = parsed.enabledModels
    setEnabledModels(
      !Array.isArray(arr)
        ? []
        : arr.length === 0
          ? [ALL_DISABLED_SENTINEL]
          : (arr as string[]),
    )
    setHealth('unknown')
    setSaveState('idle')
  }, [profile.id, profile.name, parsed])

  // Fetch available models
  useEffect(() => {
    if (!supportsModels) {
      return
    }
    setModelsLoading(true)
    postProvidersModels({
      body: {
        providerKind: profile.providerKind,
        label: profile.name,
        config: parseConfig(profile.configJson),
        secretRef: profile.credentialRef ?? null,
        profileId: profile.id,
      },
    })
      .then(({ data }) => setAvailableModels((data ?? []) as ModelDescriptor[]))
      .catch(() => setAvailableModels([]))
      .finally(() => setModelsLoading(false))
  }, [supportsModels, profile.id, profile.providerKind, profile.configJson, profile.name, profile.credentialRef])

  // Health check on load + when key fields change
  const runHealthCheck = useCallback(async () => {
    setHealth('verifying')
    try {
      const { data } = await postProvidersHealthCheck({
        body: {
          providerKind: profile.providerKind,
          label: profile.name,
          config: parseConfig(profile.configJson),
          secretRef: profile.credentialRef ?? null,
          profileId: profile.id,
        },
      })
      const hc = data as { ok: boolean } | null
      setHealth(hc?.ok ? 'connected' : 'failed')
    }
    catch {
      setHealth('failed')
    }
  }, [profile.id, profile.name, profile.providerKind, profile.configJson, profile.credentialRef])

  useEffect(() => {
    if (!profile.enabled) {
      setHealth('unknown')
      return
    }
    void runHealthCheck()
  }, [profile.enabled, runHealthCheck])

  // Build config json from current form values
  const buildConfigJson = useCallback((): string => {
    if (supportsModels) {
      const cleanEnabled = enabledModels.filter(id => id !== ALL_DISABLED_SENTINEL)
      const allDisabledNow = enabledModels[0] === ALL_DISABLED_SENTINEL
      return JSON.stringify({
        baseUrl,
        model: model || undefined,
        enabledModels: cleanEnabled.length > 0
          ? cleanEnabled
          : allDisabledNow
            ? []
            : undefined,
      })
    }
    if (profile.providerKind === 'cli-tui') {
      return JSON.stringify({ executable: command, args: [] })
    }
    if (profile.providerKind === 'acp-chat') {
      return JSON.stringify({ ...parsed, cmd: command })
    }
    return profile.configJson
  }, [profile.providerKind, profile.configJson, parsed, supportsModels, baseUrl, model, enabledModels, command])

  const doSave = useCallback(async () => {
    setSaveState('saving')
    try {
      let credentialRef = profile.credentialRef ?? null
      if (apiKey && supportsModels) {
        const { data: meta } = await postSecrets({
          body: { providerKind: profile.providerKind, label: name, secret: apiKey } as unknown as never,
        })
        credentialRef = (meta as Record<string, unknown>)?.id as string ?? credentialRef
      }

      await putProfilesById({
        path: { id: profile.id },
        body: {
          name,
          providerKind: profile.providerKind,
          enabled: profile.enabled,
          config: parseConfig(buildConfigJson()),
          credentialRef,
        },
      })

      setSaveState('saved')
      setApiKey('')
      if (savedClearTimer.current) {
        clearTimeout(savedClearTimer.current)
      }
      savedClearTimer.current = setTimeout(() => setSaveState('idle'), 1600)
      onSaved()
    }
    catch (err) {
      setSaveState('error')
      console.error('[ProfileDetailPanel] save failed', err)
    }
  }, [profile, name, apiKey, supportsModels, buildConfigJson, onSaved])

  // Auto-save with debounce — but skip the very first run after switching profiles
  useEffect(() => {
    if (skipNextAutoSave.current) {
      skipNextAutoSave.current = false
      return
    }
    setSaveState('pending')
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current)
    }
    autoSaveTimer.current = setTimeout(() => {
      void doSave()
    }, 1200)
    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, baseUrl, model, command, JSON.stringify(enabledModels), apiKey])

  const kindLabel = PROVIDER_KIND_LABELS[profile.providerKind]

  return (
    <div data-testid="provider-detail-panel" className="flex flex-col gap-5">
      {/* Hero */}
      <header className="flex items-start gap-3">
        <span className={cn(
          'flex size-11 items-center justify-center rounded-xl ring-1 ring-foreground/5',
          accent.bg,
          accent.text,
        )}
        >
          <Icon className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-heading text-[15px] font-medium text-foreground truncate">
              {profile.name}
            </h4>
            <Badge variant="secondary" className="font-normal text-muted-foreground">
              {kindLabel}
            </Badge>
            <HealthBadge status={health} onRefresh={() => void runHealthCheck()} disabled={!profile.enabled} />
          </div>
          <p className="mt-1 text-[11.5px] text-muted-foreground/80 truncate">
            {profile.id}
          </p>
        </div>

        <div className="flex items-center gap-3 pt-0.5">
          <SaveIndicator state={saveState} />

          <div className="flex items-center gap-2 rounded-full bg-muted/40 px-2.5 py-1 ring-1 ring-foreground/[0.04]">
            <Switch
              size="sm"
              checked={profile.enabled}
              onCheckedChange={onToggle}
            />
            <span className="text-[11px] font-medium text-muted-foreground">
              {profile.enabled ? 'Active' : 'Off'}
            </span>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid={`agent-profile-remove-${profile.id}`}
                variant="ghost"
                size="icon-sm"
                onClick={() => setConfirmRemove(true)}
                className="text-muted-foreground/60 hover:text-destructive hover:bg-destructive/[0.06]"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Remove provider</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <Separator className="bg-foreground/[0.06]" />

      {/* Tabs */}
      <Tabs defaultValue="general" className="gap-4">
        <TabsList variant="line">
          <TabsTrigger value="general">
            <SettingsIcon />
            General
          </TabsTrigger>
          {supportsModels && (
            <TabsTrigger value="models">
              <SparklesIcon />
              Models
              {enabledModels.length > 0 && enabledModels[0] !== ALL_DISABLED_SENTINEL && (
                <Badge variant="outline" className="ml-1 h-4 px-1.5 text-[10px]">
                  {enabledModels.length}
                </Badge>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="general">
          <FieldGroup className="gap-5">
            <Field orientation="vertical">
              <FieldLabel htmlFor="profile-name" className="text-[12.5px] font-medium">
                Display name
              </FieldLabel>
              <FieldContent>
                <Input
                  id="profile-name"
                  data-testid="provider-edit-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="h-9 max-w-sm text-[13px]"
                />
              </FieldContent>
            </Field>

            {supportsModels && (
              <>
                <Field orientation="vertical">
                  <FieldLabel htmlFor="profile-baseurl" className="text-[12.5px] font-medium">
                    <div className="flex items-center gap-1.5">
                      <LinkIcon className="size-3 text-muted-foreground/70" />
                      Endpoint
                    </div>
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id="profile-baseurl"
                      data-testid="provider-edit-baseurl"
                      value={baseUrl}
                      onChange={e => setBaseUrl(e.target.value)}
                      className="h-9 max-w-sm text-[12.5px] font-mono"
                      placeholder="https://api.openai.com/v1"
                    />
                  </FieldContent>
                </Field>

                <Field orientation="vertical">
                  <FieldLabel htmlFor="profile-model" className="text-[12.5px] font-medium">
                    Default model
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id="profile-model"
                      data-testid="provider-edit-model"
                      value={model}
                      onChange={e => setModel(e.target.value)}
                      className="h-9 max-w-sm text-[12.5px] font-mono"
                      placeholder="e.g. gpt-4o"
                    />
                    <FieldDescription className="text-[11px]">
                      Used when no model is specified. Falls back to the first available model.
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <Field orientation="vertical">
                  <FieldLabel htmlFor="profile-apikey" className="text-[12.5px] font-medium">
                    <div className="flex items-center gap-1.5">
                      <KeyRoundIcon className="size-3 text-muted-foreground/70" />
                      API key
                    </div>
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id="profile-apikey"
                      data-testid="provider-edit-apikey"
                      type="password"
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder={profile.credentialRef ? 'Configured · type to replace' : 'sk-…'}
                      className="h-9 max-w-sm text-[12.5px] font-mono"
                    />
                    <FieldDescription className="text-[11px]">
                      {profile.credentialRef
                        ? 'A credential is already stored. Leave empty to keep it.'
                        : 'Stored locally and encrypted.'}
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </>
            )}

            {supportsCommand && (
              <Field orientation="vertical">
                <FieldLabel htmlFor="profile-command" className="text-[12.5px] font-medium">
                  Command
                </FieldLabel>
                <FieldContent>
                  <Input
                    id="profile-command"
                    value={command}
                    onChange={e => setCommand(e.target.value)}
                    className="h-9 max-w-sm text-[12.5px] font-mono"
                    placeholder="claude"
                  />
                  <FieldDescription className="text-[11px]">
                    Executable that Cradle launches when this provider is used.
                  </FieldDescription>
                </FieldContent>
              </Field>
            )}
          </FieldGroup>
        </TabsContent>

        {supportsModels && (
          <TabsContent value="models">
            <ModelsPanel
              loading={modelsLoading}
              models={availableModels}
              enabledModels={enabledModels}
              onChange={setEnabledModels}
            />
          </TabsContent>
        )}
      </Tabs>

      {/* Remove confirmation */}
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>Remove provider?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{profile.name}</strong>
              {' '}
              will be disconnected from every agent that uses it. Stored credentials
              will be deleted from this machine. You can always add it back later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              size="sm"
              variant="destructive"
              onClick={() => {
                setConfirmRemove(false)
                onRemove()
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Health badge ─────────────────────────────────────────────────────────────

function HealthBadge({
  status,
  onRefresh,
  disabled,
}: {
  status: HealthStatus
  onRefresh: () => void
  disabled: boolean
}) {
  const Pill = ({ tone, label, icon }: { tone: 'active' | 'muted' | 'warning' | 'destructive', label: string, icon: React.ReactNode }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled}
          className={cn(
            'group/health inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors',
            tone === 'active' && 'bg-emerald-500/[0.1] text-emerald-600 ring-1 ring-emerald-500/15 dark:text-emerald-400',
            tone === 'muted' && 'bg-muted/60 text-muted-foreground ring-1 ring-foreground/[0.04]',
            tone === 'warning' && 'bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/15 dark:text-amber-400',
            tone === 'destructive' && 'bg-destructive/10 text-destructive ring-1 ring-destructive/15',
            'disabled:opacity-60 disabled:cursor-not-allowed',
            !disabled && 'hover:brightness-105 cursor-pointer',
          )}
        >
          {icon}
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {disabled ? 'Enable provider to verify connection' : 'Click to verify connection'}
      </TooltipContent>
    </Tooltip>
  )

  if (disabled) {
    return <Pill tone="muted" label="Disabled" icon={<CircleDashedIcon className="size-3" />} />
  }
  if (status === 'verifying') {
    return <Pill tone="muted" label="Verifying" icon={<Spinner className="size-3" />} />
  }
  if (status === 'connected') {
    return <Pill tone="active" label="Connected" icon={<CircleCheckIcon className="size-3" />} />
  }
  if (status === 'failed') {
    return <Pill tone="destructive" label="Disconnected" icon={<CircleAlertIcon className="size-3" />} />
  }
  return <Pill tone="muted" label="Idle" icon={<CircleDashedIcon className="size-3" />} />
}

// ─── Save indicator ───────────────────────────────────────────────────────────

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <AnimatePresence>
      {state !== 'idle' && (
        <motion.span
          initial={{ opacity: 0, x: 4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -2 }}
          transition={{ duration: 0.18 }}
          className={cn(
            'flex items-center gap-1 text-[11px] font-medium',
            state === 'saving' || state === 'pending' ? 'text-muted-foreground' : '',
            state === 'saved' ? 'text-emerald-600 dark:text-emerald-400' : '',
            state === 'error' ? 'text-destructive' : '',
          )}
        >
          {(state === 'saving' || state === 'pending') && <Spinner className="size-2.5" />}
          {state === 'saved' && <CheckIcon className="size-3" />}
          {state === 'error' && <CircleAlertIcon className="size-3" />}
          {(state === 'saving' || state === 'pending') && 'Saving'}
          {state === 'saved' && 'Saved'}
          {state === 'error' && 'Save failed'}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

// ─── Models panel ─────────────────────────────────────────────────────────────

function ModelsPanel({
  loading,
  models,
  enabledModels,
  onChange,
}: {
  loading: boolean
  models: ModelDescriptor[]
  enabledModels: string[]
  onChange: (next: string[]) => void
}) {
  const [filter, setFilter] = useState('')

  const allDisabled = enabledModels.length === 1 && enabledModels[0] === ALL_DISABLED_SENTINEL
  const isExplicitSelection = enabledModels.length > 0 && !allDisabled

  const visible = useMemo(() => {
    if (!filter.trim()) {
      return models
    }
    const q = filter.toLowerCase()
    return models.filter(m => (m.label || m.id).toLowerCase().includes(q))
  }, [models, filter])

  const enabledCount = allDisabled ? 0 : enabledModels.length === 0 ? models.length : enabledModels.length

  const isChecked = (id: string): boolean => {
    if (allDisabled) {
      return false
    }
    return enabledModels.length === 0 || enabledModels.includes(id)
  }

  const handleToggle = (id: string, checked: boolean) => {
    if (checked) {
      const base = allDisabled || enabledModels.length === 0 ? models.map(m => m.id) : enabledModels
      onChange([...base.filter(x => x !== id), id])
    }
    else {
      const base = allDisabled ? [] : enabledModels.length === 0 ? models.map(m => m.id) : enabledModels
      const next = base.filter(x => x !== id)
      onChange(next.length === 0 ? [ALL_DISABLED_SENTINEL] : next)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-medium text-foreground">Available models</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Choose which models appear in the chat model picker for this provider.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {isExplicitSelection && (
            <Button
              size="xs"
              variant="ghost"
              className="text-[11px] text-muted-foreground"
              onClick={() => onChange([])}
            >
              Show all
            </Button>
          )}
          {!allDisabled && (
            <Button
              size="xs"
              variant="ghost"
              className="text-[11px] text-muted-foreground"
              onClick={() => onChange([ALL_DISABLED_SENTINEL])}
            >
              Disable all
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter models…"
          className="h-8 pl-8 text-[12.5px]"
        />
      </div>

      {/* Body */}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/[0.06]">
        {loading
          ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
              <Spinner className="size-3" />
              Fetching models…
            </div>
          )
          : models.length === 0
            ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[12px] text-muted-foreground">
                  No models returned by this provider.
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  Save your endpoint and API key first — they may be required to list models.
                </p>
              </div>
            )
            : (
              <ScrollArea className="max-h-72">
                <ul className="divide-y divide-foreground/[0.04]">
                  {visible.map((m) => {
                    const checked = isChecked(m.id)
                    return (
                      <li key={m.id}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors',
                            'hover:bg-foreground/[0.025]',
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={c => handleToggle(m.id, !!c)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] font-medium text-foreground">
                              {m.label || m.id}
                            </div>
                            {m.label && m.label !== m.id && (
                              <div className="truncate font-mono text-[10.5px] text-muted-foreground/70">
                                {m.id}
                              </div>
                            )}
                          </div>
                          {m.contextWindow != null && m.contextWindow > 0 && (
                            <Badge variant="secondary" className="font-mono text-[10px] font-normal text-muted-foreground">
                              {Math.round(m.contextWindow / 1000)}
                              k
                            </Badge>
                          )}
                        </label>
                      </li>
                    )
                  })}
                  {visible.length === 0 && (
                    <li className="px-4 py-8 text-center text-[11.5px] text-muted-foreground">
                      No models match
                      {' '}
                      <span className="font-mono text-foreground">{filter}</span>
                      .
                    </li>
                  )}
                </ul>
              </ScrollArea>
            )}
      </div>

      {/* Footer summary */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {allDisabled
            ? 'All models hidden from chat'
            : enabledModels.length === 0
              ? `All ${models.length || ''} models visible`.trim()
              : `${enabledCount} of ${models.length} model${models.length === 1 ? '' : 's'} visible`}
        </span>
      </div>
    </div>
  )
}
