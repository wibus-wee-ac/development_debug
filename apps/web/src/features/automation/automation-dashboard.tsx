import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import {
  ArrowLeftIcon,
  BotIcon,
  CalendarClockIcon,
  CheckIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderIcon,
  HashIcon,
  Loader2Icon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Badge } from '~/components/ui/badge'
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
import { Label } from '~/components/ui/label'
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '~/components/ui/number-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import { toastManager } from '~/components/ui/toast'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { useProviderTargetModelMap } from '~/features/agent-runtime/use-agent-models'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { listRuntimeCatalogForSurface, useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import { listSelectableComposerProfiles, pickComposerProfileId } from '~/features/composer-toolbar/composer-profile-selection'
import { filterThinkingOptionsForModel, selectSupportedThinkingValue, THINKING_EFFORTS } from '~/features/composer-toolbar/constants'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import { RuntimeSelector } from '~/features/composer-toolbar/runtime-selector'
import type { ThinkingEffort } from '~/features/composer-toolbar/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import type { ModelDescriptor, RuntimeKind } from '~/features/agent-runtime/types'

import { listAutomationArtifacts, listAutomationRuns } from './api-client'
import type { AutomationArtifact, AutomationDefinition, AutomationInput, AutomationRecipe, AutomationRun, AutomationRunStatus, AutomationTrigger, CreateAutomationInput } from './types'
import { automationQueryKeys, useAutomationDefinitions, useCreateAutomation, useRunAutomationNow, useUpdateAutomation } from './use-automations'

interface AutomationDashboardProps {
  onBack?: () => void
}

type AutomationRuntimeKind = RuntimeKind
type ScheduleFrequency = 'daily' | 'weekly' | 'monthly'
type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

interface ScheduleDraft {
  frequency: ScheduleFrequency
  interval: number
  weekdays: Weekday[]
  monthDay: number
  time: string
}

const WEEKDAY_OPTIONS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const FREQUENCY_TO_RRULE: Record<ScheduleFrequency, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
}

const DEFAULT_SCHEDULE: ScheduleDraft = {
  frequency: 'weekly',
  interval: 1,
  weekdays: ['MO'],
  monthDay: 1,
  time: '09:00',
}

const STATUS_STYLES: Record<AutomationRunStatus, string> = {
  queued: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  running: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  complete: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  cancelled: 'border-muted-foreground/20 bg-muted/60 text-muted-foreground',
  skipped: 'border-muted-foreground/20 bg-muted/60 text-muted-foreground',
}

const UnixSecondsValueSchema = z.union([
  z.number().finite().transform(value => value > 10_000_000_000 ? Math.floor(value / 1000) : value),
  z.string()
    .transform(value => Math.floor(Date.parse(value) / 1000))
    .pipe(z.number().finite()),
])
const UnixSecondsSchema = z.union([
  UnixSecondsValueSchema,
  z.null().transform(() => null),
  z.undefined().transform(() => null),
])
const RunTimeSortKeySchema = z.union([
  UnixSecondsValueSchema,
  z.null().transform(() => 0),
  z.undefined().transform(() => 0),
])

interface CreateAutomationDraft {
  title: string
  description: string
  workspaceId: string | null
  enabled: boolean
  schedule: ScheduleDraft
  timezone: string
  misfirePolicy: 'skip' | 'run_latest'
  providerTargetId: string
  runtimeKind: AutomationRuntimeKind
  modelId: string | null
  thinkingEffort: ThinkingEffort
  prompt: string
  artifactName: string
}

function createDefaultDraft(providerTargetId = '', workspaceId: string | null = null): CreateAutomationDraft {
  return {
    title: '',
    description: '',
    workspaceId,
    enabled: true,
    schedule: DEFAULT_SCHEDULE,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    misfirePolicy: 'run_latest',
    providerTargetId,
    runtimeKind: 'codex',
    modelId: null,
    thinkingEffort: null,
    prompt: '',
    artifactName: 'automation-run.md',
  }
}

function toCreateAutomationInput(draft: CreateAutomationDraft, t: TFunction<'automation'>): CreateAutomationInput {
  const title = draft.title.trim()
  const prompt = draft.prompt.trim()
  const providerTargetId = draft.providerTargetId.trim()
  const artifactName = draft.artifactName.trim()
  const rrule = buildScheduleRrule(draft.schedule)

  if (!title) {
    throw new Error(t('validation.titleRequired'))
  }
  if (!draft.timezone.trim()) {
    throw new Error(t('validation.timezoneRequired'))
  }
  if (!providerTargetId) {
    throw new Error(t('validation.providerTargetRequired'))
  }
  if (!draft.modelId) {
    throw new Error(t('validation.modelRequired'))
  }
  if (!prompt) {
    throw new Error(t('validation.promptRequired'))
  }
  if (!artifactName) {
    throw new Error(t('validation.artifactNameRequired'))
  }

  return {
    title,
    description: draft.description.trim(),
    workspaceId: draft.workspaceId,
    enabled: draft.enabled,
    trigger: {
      type: 'rrule',
      rrule,
      timezone: draft.timezone.trim(),
      misfirePolicy: draft.misfirePolicy,
    },
    recipe: {
      kind: 'agent_task',
      prompt,
      inputs: [],
      artifactRequests: [{
        kind: 'markdown',
        name: artifactName,
      }],
      providerTargetId,
      runtimeKind: draft.runtimeKind,
      modelId: draft.modelId,
      thinkingEffort: draft.thinkingEffort ?? undefined,
    },
    createdByKind: 'user',
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min
  }
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function parseScheduleTime(time: string): { hour: number, minute: number } {
  const [hourInput, minuteInput] = time.split(':')
  return {
    hour: clampNumber(Number(hourInput), 0, 23),
    minute: clampNumber(Number(minuteInput), 0, 59),
  }
}

function parseRruleToSchedule(rrule: string): ScheduleDraft {
  const parts = Object.fromEntries(rrule.split(';').map(p => p.split('=')))
  const freq = parts.FREQ ?? 'WEEKLY'
  const frequency: ScheduleFrequency = freq === 'DAILY' ? 'daily' : freq === 'MONTHLY' ? 'monthly' : 'weekly'
  const interval = clampNumber(Number(parts.INTERVAL ?? 1), 1, 99)
  const weekdays = parts.BYDAY ? parts.BYDAY.split(',') as Weekday[] : DEFAULT_SCHEDULE.weekdays
  const monthDay = clampNumber(Number(parts.BYMONTHDAY ?? 1), 1, 31)
  const hour = clampNumber(Number(parts.BYHOUR ?? 9), 0, 23)
  const minute = clampNumber(Number(parts.BYMINUTE ?? 0), 0, 59)
  return {
    frequency,
    interval,
    weekdays,
    monthDay,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  }
}

function buildScheduleRrule(schedule: ScheduleDraft): string {
  const { hour, minute } = parseScheduleTime(schedule.time)
  const parts = [
    `FREQ=${FREQUENCY_TO_RRULE[schedule.frequency]}`,
    `INTERVAL=${clampNumber(schedule.interval, 1, 99)}`,
  ]

  if (schedule.frequency === 'weekly') {
    parts.push(`BYDAY=${(schedule.weekdays.length > 0 ? schedule.weekdays : DEFAULT_SCHEDULE.weekdays).join(',')}`)
  }

  if (schedule.frequency === 'monthly') {
    parts.push(`BYMONTHDAY=${clampNumber(schedule.monthDay, 1, 31)}`)
  }

  parts.push(`BYHOUR=${hour}`, `BYMINUTE=${minute}`, 'BYSECOND=0')
  return parts.join(';')
}

function formatDateTime(value: number | string | null | undefined, locale: string, t: TFunction<'automation'>): string {
  const unixSeconds = UnixSecondsSchema.parse(value)
  if (unixSeconds === null) {
    return t('datetime.notRecorded')
  }

  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(unixSeconds * 1000))
}

function formatRelative(value: number | string | null | undefined, t: TFunction<'automation'>): string {
  const unixSeconds = UnixSecondsSchema.parse(value)
  if (unixSeconds === null) {
    return t('datetime.notRecorded')
  }

  const diff = Math.floor(Date.now() / 1000) - unixSeconds
  if (diff < 60) {
    return t('relative.justNow')
  }
  if (diff < 3600) {
    return t('relative.minute', { count: Math.floor(diff / 60) })
  }
  if (diff < 86400) {
    return t('relative.hour', { count: Math.floor(diff / 3600) })
  }
  return t('relative.day', { count: Math.floor(diff / 86400) })
}

function getTrigger(definition: AutomationDefinition): AutomationTrigger | null {
  return definition.trigger ?? definition.triggerJson ?? null
}

function getRecipe(definition: AutomationDefinition): AutomationRecipe | null {
  return definition.recipe ?? definition.recipeJson ?? null
}

function getRunTime(run: AutomationRun | null | undefined): number {
  return RunTimeSortKeySchema.parse(run?.createdAt ?? run?.startedAt ?? run?.scheduledFor)
}

function getLatestRun(definition: AutomationDefinition, runs: AutomationRun[] | undefined): AutomationRun | null {
  if (definition.latestRun) {
    return definition.latestRun
  }

  if (!runs || runs.length === 0) {
    return null
  }

  return [...runs].sort((a, b) => getRunTime(b) - getRunTime(a))[0] ?? null
}

function getInputKey(input: AutomationInput): string {
  return [
    input.type,
    input.name ?? '',
    input.path ?? '',
    input.url ?? '',
    input.content?.slice(0, 48) ?? '',
  ].join(':')
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useTranslation('automation')
  const normalized = (status ?? 'queued') as AutomationRunStatus
  const className = STATUS_STYLES[normalized] ?? STATUS_STYLES.queued

  return (
    <Badge variant="outline" className={className}>
      {t(`status.${status ?? 'unknown'}`, { defaultValue: status ?? t('status.unknown') })}
    </Badge>
  )
}

function DefinitionListItem({
  definition,
  active,
  latestRun,
  workspaceName,
  onSelect,
}: {
  definition: AutomationDefinition
  active: boolean
  latestRun: AutomationRun | null
  workspaceName?: string | null
  onSelect: () => void
}) {
  const { t } = useTranslation('automation')
  const trigger = getTrigger(definition)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-2 rounded-lg border px-3 py-3 text-left transition-colors',
        active ? 'border-primary/40 bg-primary/5' : 'border-border/50 hover:border-border hover:bg-accent/40',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <CalendarClockIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{definition.title}</span>
            {definition.enabled === false ? <Badge variant="secondary">{t('state.disabled')}</Badge> : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{definition.description || t('definition.noDescription')}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5">
          {workspaceName
            ? (
              <span className="inline-flex items-center gap-1 truncate">
                <FolderIcon className="size-3 shrink-0" />
                {workspaceName}
              </span>
            )
            : <span className="truncate font-mono">{trigger?.rrule ?? t('trigger.noRrule')}</span>}
        </div>
        {latestRun ? <StatusBadge status={latestRun.status} /> : <Badge variant="outline">{t('runs.noneShort')}</Badge>}
      </div>
    </button>
  )
}

function DetailField({ label, value, mono }: { label: string, value: string, mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn('mt-1 truncate text-xs text-foreground', mono && 'font-mono')}>{value}</div>
    </div>
  )
}

function RunRow({ run }: { run: AutomationRun }) {
  const { i18n, t } = useTranslation('automation')
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)_minmax(0,1fr)_96px] items-center gap-3 rounded-md px-2 py-2 text-xs hover:bg-accent/40">
      <StatusBadge status={run.status} />
      <div className="min-w-0">
        <div className="truncate font-mono text-[11px] text-foreground">{run.id}</div>
        <div className="text-[11px] text-muted-foreground">{formatDateTime(run.startedAt ?? run.createdAt ?? run.scheduledFor, i18n.resolvedLanguage ?? i18n.language, t)}</div>
      </div>
      <div className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5">
          <ExternalLinkIcon className="size-3 shrink-0" />
          <span className="truncate font-mono">{run.chatSessionId ?? t('runs.noChatSession')}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <HashIcon className="size-3 shrink-0" />
          <span className="truncate font-mono">{run.backendRunId ?? t('runs.noBackendRun')}</span>
        </div>
      </div>
      <div className="truncate text-right text-[11px] text-muted-foreground">{run.errorText ?? run.reason ?? formatRelative(run.finishedAt ?? run.startedAt ?? run.createdAt, t)}</div>
    </div>
  )
}

function ArtifactRow({
  artifact,
  active,
  onSelect,
}: {
  artifact: AutomationArtifact
  active: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('automation')
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors',
        active ? 'bg-accent text-foreground' : 'hover:bg-accent/40',
      )}
    >
      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{artifact.title ?? artifact.name ?? artifact.id}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{artifact.kind ?? artifact.mediaType ?? t('artifact.fallbackKind')}</span>
    </button>
  )
}

function FormField({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string
  description?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-[12px] text-foreground">{label}</Label>
      {children}
      {description ? <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p> : null}
    </div>
  )
}

function formatScheduleSummary(schedule: ScheduleDraft, t: TFunction<'automation'>): string {
  const interval = clampNumber(schedule.interval, 1, 99)
  const time = schedule.time

  if (schedule.frequency === 'daily') {
    return interval === 1
      ? t('schedule.summary.daily', { time })
      : t('schedule.summary.dailyInterval', { count: interval, time })
  }

  if (schedule.frequency === 'weekly') {
    const days = (schedule.weekdays.length > 0 ? schedule.weekdays : DEFAULT_SCHEDULE.weekdays)
      .map(day => t(`schedule.weekday.${day}`))
      .join(t('list.separator'))
    return interval === 1
      ? t('schedule.summary.weekly', { days, time })
      : t('schedule.summary.weeklyInterval', { count: interval, days, time })
  }

  return interval === 1
    ? t('schedule.summary.monthly', { day: clampNumber(schedule.monthDay, 1, 31), time })
    : t('schedule.summary.monthlyInterval', { count: interval, day: clampNumber(schedule.monthDay, 1, 31), time })
}

function ScheduleBuilder({
  schedule,
  timezone,
  misfirePolicy,
  onScheduleChange,
  onTimezoneChange,
  onMisfirePolicyChange,
}: {
  schedule: ScheduleDraft
  timezone: string
  misfirePolicy: CreateAutomationDraft['misfirePolicy']
  onScheduleChange: (schedule: ScheduleDraft) => void
  onTimezoneChange: (timezone: string) => void
  onMisfirePolicyChange: (policy: CreateAutomationDraft['misfirePolicy']) => void
}) {
  const { t } = useTranslation('automation')
  const rrulePreview = buildScheduleRrule(schedule)

  const updateFrequency = useCallback((frequency: string) => {
    if (!frequency) {
      return
    }
    onScheduleChange({
      ...schedule,
      frequency: frequency as ScheduleFrequency,
      weekdays: schedule.weekdays.length > 0 ? schedule.weekdays : DEFAULT_SCHEDULE.weekdays,
    })
  }, [onScheduleChange, schedule])

  const updateWeekdays = useCallback((weekdays: string[]) => {
    onScheduleChange({
      ...schedule,
      weekdays: weekdays.length > 0 ? weekdays as Weekday[] : DEFAULT_SCHEDULE.weekdays,
    })
  }, [onScheduleChange, schedule])

  return (
    <TooltipProvider>
      <div className="grid gap-3">
        <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/15 p-3">
          <div className="grid gap-2">
            <Label className="text-[12px] text-foreground">{t('schedule.frequency.label')}</Label>
            <ToggleGroup
              type="single"
              value={schedule.frequency}
              onValueChange={updateFrequency}
              variant="outline"
              size="sm"
              className="w-full"
            >
              <ToggleGroupItem value="daily" className="min-w-0 flex-1">{t('schedule.frequency.daily')}</ToggleGroupItem>
              <ToggleGroupItem value="weekly" className="min-w-0 flex-1">{t('schedule.frequency.weekly')}</ToggleGroupItem>
              <ToggleGroupItem value="monthly" className="min-w-0 flex-1">{t('schedule.frequency.monthly')}</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1fr)] gap-3">
            <FormField label={t('schedule.interval.label')} description={t('schedule.interval.description')}>
              <NumberField
                size="sm"
                min={1}
                max={99}
                value={schedule.interval}
                onValueChange={value => onScheduleChange({ ...schedule, interval: clampNumber(value ?? 1, 1, 99) })}
              >
                <NumberFieldGroup>
                  <NumberFieldDecrement />
                  <NumberFieldInput aria-label={t('schedule.interval.aria')} />
                  <NumberFieldIncrement />
                </NumberFieldGroup>
              </NumberField>
            </FormField>

            <FormField label={t('schedule.time.label')} htmlFor="automation-schedule-time">
              <Input
                id="automation-schedule-time"
                type="time"
                value={schedule.time}
                onChange={event => onScheduleChange({ ...schedule, time: event.target.value || DEFAULT_SCHEDULE.time })}
                className="font-mono tabular-nums"
              />
            </FormField>

            <FormField label={t('schedule.timezone.label')}>
              <Input
                value={timezone}
                onChange={event => onTimezoneChange(event.target.value)}
                placeholder={t('schedule.timezone.placeholder')}
                className="font-mono text-[12px]"
              />
            </FormField>
          </div>

          {schedule.frequency === 'weekly'
            ? (
              <div className="grid gap-2">
                <Label className="text-[12px] text-foreground">{t('schedule.weekdays.label')}</Label>
                <ToggleGroup
                  type="multiple"
                  value={schedule.weekdays}
                  onValueChange={updateWeekdays}
                  variant="outline"
                  size="sm"
                  className="flex w-full flex-wrap"
                >
                  {WEEKDAY_OPTIONS.map(day => (
                    <ToggleGroupItem key={day} value={day} className="min-w-10 flex-1">
                      {t(`schedule.weekdayShort.${day}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            )
            : null}

          {schedule.frequency === 'monthly'
            ? (
              <FormField label={t('schedule.monthDay.label')} description={t('schedule.monthDay.description')}>
                <NumberField
                  size="sm"
                  min={1}
                  max={31}
                  value={schedule.monthDay}
                  onValueChange={value => onScheduleChange({ ...schedule, monthDay: clampNumber(value ?? 1, 1, 31) })}
                >
                  <NumberFieldGroup className="max-w-40">
                    <NumberFieldDecrement />
                    <NumberFieldInput aria-label={t('schedule.monthDay.aria')} />
                    <NumberFieldIncrement />
                  </NumberFieldGroup>
                </NumberField>
              </FormField>
            )
            : null}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-3">
          <div className="rounded-lg border border-border/50 bg-background px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{t('schedule.summary.label')}</div>
            <div className="mt-1 text-sm text-foreground text-pretty">{formatScheduleSummary(schedule, t)}</div>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <div className="mt-2 truncate rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                    {rrulePreview}
                  </div>
                )}
              />
              <TooltipContent>{t('schedule.rrulePreview.tooltip')}</TooltipContent>
            </Tooltip>
          </div>
          <FormField label={t('schedule.misfire.label')} description={t('schedule.misfire.description')}>
            <Select
              value={misfirePolicy}
              onValueChange={value => onMisfirePolicyChange(value as CreateAutomationDraft['misfirePolicy'])}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="run_latest">{t('schedule.misfire.runLatest')}</SelectItem>
                <SelectItem value="skip">{t('schedule.misfire.skip')}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </div>
    </TooltipProvider>
  )
}

function CreateAutomationPanel({
  draft,
  saving,
  error,
  canSave,
  editingId,
  onChange,
  onCancel,
  onSave,
}: {
  draft: CreateAutomationDraft
  saving: boolean
  error: string | null
  canSave: boolean
  editingId?: string | null
  onChange: (draft: CreateAutomationDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const { t } = useTranslation('automation')
  const { workspaces } = useWorkspaces()
  const { providerOptions, isLoading } = useProviderTargets()
  const { runtimes } = useRuntimeCatalog()
  const runtimeOptions = useMemo(
    () => listRuntimeCatalogForSurface(runtimes, 'chat')
      .filter(runtime => runtime.runtimeKind !== 'cli-tui')
      .map(runtime => ({
        value: runtime.runtimeKind,
        label: runtime.label,
        description: runtime.description,
        iconKey: runtime.iconKey,
      })),
    [runtimes],
  )
  const selectableProfiles = useMemo(
    () => listSelectableComposerProfiles({ profiles: providerOptions, runtimeKind: draft.runtimeKind, runtimes }),
    [draft.runtimeKind, providerOptions, runtimes],
  )
  const selectedProfileId = useMemo(
    () => pickComposerProfileId({ profiles: selectableProfiles, lastProfileId: draft.providerTargetId || null }),
    [draft.providerTargetId, selectableProfiles],
  )
  const initialModelProfileIds = useMemo(() => [selectedProfileId], [selectedProfileId])
  const {
    modelsByProviderTargetId: modelsByProfileId,
    loadingProviderTargetIds: loadingProfileIds,
    requestProviderTargetModels: requestProfileModels,
  } = useProviderTargetModelMap(
    selectableProfiles,
    initialModelProfileIds,
  )
  const models = useMemo(
    () => selectedProfileId ? modelsByProfileId[selectedProfileId] ?? [] : [],
    [modelsByProfileId, selectedProfileId],
  )
  const selectedModel = models.find(model => model.id === draft.modelId) ?? null
  const selectedModelId = draft.modelId && models.some(model => model.id === draft.modelId)
    ? draft.modelId
    : models[0]?.id ?? null
  const isLoadingModels = selectedProfileId ? loadingProfileIds.has(selectedProfileId) : false
  const thinkingOptions = useMemo(() => THINKING_EFFORTS.map(option => ({
    value: option.value,
    label: t(`thinking.${option.value}`),
    description: t('thinking.effortDescription', { effort: t(`thinking.${option.value}`) }),
  })), [t])
  const selectThinkingForModel = useCallback(
    (model: ModelDescriptor | null): ThinkingEffort =>
      selectSupportedThinkingValue(model, thinkingOptions, draft.thinkingEffort, null),
    [draft.thinkingEffort, thinkingOptions],
  )

  useEffect(() => {
    if (!selectedProfileId) {
      if (draft.providerTargetId || draft.modelId) {
        onChange({ ...draft, providerTargetId: '', modelId: null, thinkingEffort: null })
      }
      return
    }

    if (draft.providerTargetId !== selectedProfileId) {
      onChange({ ...draft, providerTargetId: selectedProfileId, modelId: null, thinkingEffort: null })
    }
  }, [draft, onChange, selectedProfileId])

  useEffect(() => {
    if (!selectedProfileId || draft.modelId !== null || models.length === 0) {
      return
    }
    const firstModel = models[0]
    onChange({
      ...draft,
      modelId: firstModel.id,
      thinkingEffort: selectThinkingForModel(firstModel),
    })
  }, [draft, models, onChange, selectThinkingForModel, selectedProfileId])

  const updateRuntimeKind = useCallback((runtimeKind: RuntimeKind) => {
    if (runtimeKind === 'cli-tui') {
      return
    }
    const nextProfiles = listSelectableComposerProfiles({ profiles: providerOptions, runtimeKind, runtimes })
    const nextProviderTargetId = pickComposerProfileId({
      profiles: nextProfiles,
      lastProfileId: draft.providerTargetId || null,
    })
    onChange({
      ...draft,
      runtimeKind,
      providerTargetId: nextProviderTargetId ?? '',
      modelId: null,
      thinkingEffort: null,
    })
  }, [draft, onChange, providerOptions, runtimes])

  const updateProviderTarget = useCallback((providerTargetId: string) => {
    requestProfileModels(providerTargetId)
    const nextModel = (modelsByProfileId[providerTargetId] ?? [])[0] ?? null
    if (!nextModel) {
      onChange({
        ...draft,
        providerTargetId,
        modelId: null,
        thinkingEffort: draft.thinkingEffort,
      })
      return
    }
    onChange({
      ...draft,
      providerTargetId,
      modelId: nextModel?.id ?? null,
      thinkingEffort: selectThinkingForModel(nextModel),
    })
  }, [draft, modelsByProfileId, onChange, requestProfileModels, selectThinkingForModel])

  const updateModel = useCallback((modelId: string | null, providerTargetId: string) => {
    if (!modelId) {
      return
    }
    const nextModel = (modelsByProfileId[providerTargetId] ?? []).find(model => model.id === modelId) ?? null
    onChange({
      ...draft,
      providerTargetId,
      modelId,
      thinkingEffort: selectThinkingForModel(nextModel),
    })
  }, [draft, modelsByProfileId, onChange, selectThinkingForModel])

  const updateThinkingEffort = useCallback((thinkingEffort: ThinkingEffort) => {
    onChange({ ...draft, thinkingEffort })
  }, [draft, onChange])

  const providerModelLabel = isLoading
    ? t('runtime.loadingProviders')
    : selectableProfiles.length === 0
      ? t('runtime.noCompatibleTargets')
      : t('runtime.description')

  const effectiveSelectedModel = selectedModel ?? models.find(model => model.id === selectedModelId) ?? null
  const resolvedModelReady = Boolean(draft.providerTargetId && draft.modelId && effectiveSelectedModel)
  const saveEnabled = canSave && resolvedModelReady

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/40 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg border border-dashed border-foreground/15 text-muted-foreground">
              <SparklesIcon className="size-3.5" />
            </span>
            <h2 className="text-base font-semibold text-foreground text-balance">{editingId ? t('edit.title') : t('create.title')}</h2>
          </div>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            {editingId ? t('edit.description') : t('create.description')}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onCancel} aria-label={t('create.cancelAria')}>
          <XIcon className="size-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          {error
? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )
: null}

          <section className="grid gap-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-[13px] font-medium text-foreground">{t('definition.section')}</h3>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{t('definition.description')}</p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                <span className="text-[12px] text-muted-foreground">{t('definition.enabled')}</span>
                <Switch
                  size="sm"
                  checked={draft.enabled}
                  onCheckedChange={checked => onChange({ ...draft, enabled: checked })}
                />
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <FormField label={t('definition.titleLabel')}>
                <Input
                  value={draft.title}
                  onChange={event => onChange({ ...draft, title: event.target.value })}
                  placeholder={t('definition.titlePlaceholder')}
                />
              </FormField>
              <FormField label={t('definition.descriptionLabel')}>
                <Input
                  value={draft.description}
                  onChange={event => onChange({ ...draft, description: event.target.value })}
                  placeholder={t('definition.descriptionPlaceholder')}
                />
              </FormField>
            </div>
            <FormField label={t('definition.workspaceLabel')} description={t('definition.workspaceDescription')}>
              <Select
                value={draft.workspaceId ?? ''}
                onValueChange={value => onChange({ ...draft, workspaceId: value || null })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('definition.workspacePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('definition.workspaceNone')}</SelectItem>
                  {workspaces.map(workspace => (
                    <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </section>

          <div className="border-t border-foreground/5" />

          <section className="grid gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-foreground">{t('schedule.section')}</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{t('schedule.description')}</p>
            </div>
            <ScheduleBuilder
              schedule={draft.schedule}
              timezone={draft.timezone}
              misfirePolicy={draft.misfirePolicy}
              onScheduleChange={schedule => onChange({ ...draft, schedule })}
              onTimezoneChange={timezone => onChange({ ...draft, timezone })}
              onMisfirePolicyChange={misfirePolicy => onChange({ ...draft, misfirePolicy })}
            />
          </section>

          <div className="border-t border-foreground/5" />

          <section className="grid gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-foreground">{t('runtime.section')}</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{providerModelLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2 py-2">
              <RuntimeSelector value={draft.runtimeKind} onChange={updateRuntimeKind} options={runtimeOptions} />
              <ProviderModelPicker
                providerTargets={selectableProfiles}
                selectedProviderTargetId={selectedProfileId}
                selectedModelId={selectedModelId}
                selectedModel={effectiveSelectedModel}
                modelsByProviderTargetId={modelsByProfileId}
                loadingProviderTargetIds={loadingProfileIds}
                thinkingValue={draft.thinkingEffort}
                thinkingOptions={thinkingOptions}
                isLoadingSelectedModels={isLoadingModels}
                emptyProviderTargetsLabel={t('runtime.noCompatibleTargetsShort')}
                emptySelectionLabel={t('runtime.selectModel')}
                menuSide="bottom"
                menuAlign="start"
                triggerTestId="automation-provider-model-selector"
                getThinkingOptionsForModel={model => filterThinkingOptionsForModel(model, thinkingOptions)}
                onRequestProviderTargetModels={requestProfileModels}
                onSelectProviderTarget={updateProviderTarget}
                onSelectModel={updateModel}
                onSelectThinking={updateThinkingEffort}
              />
              {effectiveSelectedModel
? (
                <span className="ml-auto max-w-full truncate px-1 text-[11px] text-muted-foreground">
                  {effectiveSelectedModel.id}
                </span>
              )
: null}
            </div>
          </section>

          <div className="border-t border-foreground/5" />

          <section className="grid gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-foreground">{t('recipe.section')}</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{t('recipe.description')}</p>
            </div>
            <FormField label={t('recipe.promptLabel')}>
              <Textarea
                value={draft.prompt}
                onChange={event => onChange({ ...draft, prompt: event.target.value })}
                placeholder={t('recipe.promptPlaceholder')}
                className="min-h-40 resize-y text-[13px] leading-relaxed"
              />
            </FormField>
            <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-3">
              <FormField label={t('artifact.nameLabel')} description={t('artifact.nameDescription')}>
                <Input
                  value={draft.artifactName}
                  onChange={event => onChange({ ...draft, artifactName: event.target.value })}
                  placeholder={t('artifact.namePlaceholder')}
                />
              </FormField>
              <FormField label={t('artifact.kindLabel')} description={t('artifact.kindDescription')}>
                <div className="flex h-8 items-center rounded-lg border border-input px-2.5 text-sm text-muted-foreground">
                  {t('artifact.kindMarkdown')}
                </div>
              </FormField>
            </div>
          </section>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border/40 px-5 py-3">
        <p className="text-[11px] text-muted-foreground">{editingId ? t('edit.footer') : t('create.footer')}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            {t('action.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={saving || !saveEnabled}>
            {saving ? <Loader2Icon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
            {editingId ? t('action.saveChanges') : t('action.createAutomation')}
          </Button>
        </div>
      </footer>
    </div>
  )
}

export function AutomationDashboard({ onBack }: AutomationDashboardProps) {
  const { i18n, t } = useTranslation('automation')
  const { workspaces } = useWorkspaces()
  const [workspaceFilter, setWorkspaceFilter] = useState<string | null>(null)
  const definitionsQuery = useAutomationDefinitions(workspaceFilter)
  const definitions = definitionsQuery.data ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CreateAutomationDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const workspaceMap = useMemo(() => Object.fromEntries(workspaces.map(w => [w.id, w.name])), [workspaces])
  const selectedDefinition = draft
    ? null
    : selectedId
      ? definitions.find(definition => definition.id === selectedId) ?? null
      : definitions[0] ?? null
  const selectedAutomationId = selectedDefinition?.id ?? null
  const runsQuery = useQuery({
    queryKey: selectedAutomationId ? automationQueryKeys.runs(selectedAutomationId) : ['automations', 'missing', 'runs'],
    queryFn: () => listAutomationRuns(selectedAutomationId ?? ''),
    enabled: Boolean(selectedAutomationId),
    staleTime: 10_000,
    retry: 1,
  })
  const artifactsQuery = useQuery({
    queryKey: selectedAutomationId ? automationQueryKeys.artifacts(selectedAutomationId) : ['automations', 'missing', 'artifacts'],
    queryFn: () => listAutomationArtifacts(selectedAutomationId ?? ''),
    enabled: Boolean(selectedAutomationId),
    staleTime: 10_000,
    retry: 1,
  })
  const createAutomationMutation = useCreateAutomation()
  const updateAutomationMutation = useUpdateAutomation()
  const runNowMutation = useRunAutomationNow()
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)

  const latestRun = selectedDefinition ? getLatestRun(selectedDefinition, runsQuery.data) : null
  const trigger = selectedDefinition ? getTrigger(selectedDefinition) : null
  const recipe = selectedDefinition ? getRecipe(selectedDefinition) : null
  const selectedArtifact = useMemo(() => {
    const artifacts = artifactsQuery.data ?? []
    return artifacts.find(artifact => artifact.id === selectedArtifactId) ?? artifacts[0] ?? null
  }, [artifactsQuery.data, selectedArtifactId])
  const automationReady = definitionsQuery.isSuccess
    && (!selectedAutomationId || (runsQuery.isSuccess && artifactsQuery.isSuccess))
  const locale = i18n.resolvedLanguage ?? i18n.language

  const startDraft = useCallback((): void => {
    setDraft(createDefaultDraft('', workspaceFilter))
    setDraftError(null)
    setSelectedId(null)
    setSelectedArtifactId(null)
  }, [workspaceFilter])

  const startEdit = useCallback((definition: AutomationDefinition): void => {
    const trigger = getTrigger(definition)
    const recipe = getRecipe(definition)
    setDraft({
      title: definition.title ?? '',
      description: definition.description ?? '',
      workspaceId: definition.workspaceId ?? null,
      enabled: definition.enabled !== false,
      schedule: trigger ? parseRruleToSchedule(trigger.rrule) : DEFAULT_SCHEDULE,
      timezone: trigger?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      misfirePolicy: trigger?.misfirePolicy ?? 'run_latest',
      providerTargetId: recipe?.providerTargetId ?? '',
      runtimeKind: (recipe?.runtimeKind as AutomationRuntimeKind) ?? 'codex',
      modelId: recipe?.modelId ?? null,
      thinkingEffort: recipe?.thinkingEffort ?? null,
      prompt: recipe?.prompt ?? '',
      artifactName: recipe?.artifactRequests?.[0]?.name ?? 'automation-run.md',
    })
    setEditingId(definition.id)
    setDraftError(null)
    setSelectedArtifactId(null)
  }, [])

  const cancelDraft = useCallback((): void => {
    setDraft(null)
    setEditingId(null)
    setDraftError(null)
  }, [])

  const updateDraft = useCallback((nextDraft: CreateAutomationDraft): void => {
    setDraft(nextDraft)
    setDraftError(null)
  }, [])

  const saveDraft = useCallback(async (): Promise<void> => {
    if (!draft) {
      return
    }
    if (!draft.modelId) {
      setDraftError(t('validation.modelRequired'))
      return
    }
    try {
      setDraftError(null)
      if (editingId) {
        const input = toCreateAutomationInput(draft, t)
        const updated = await updateAutomationMutation.mutateAsync({
          id: editingId,
          input: {
            title: input.title,
            description: input.description,
            trigger: input.trigger,
            recipe: input.recipe,
          },
        })
        setDraft(null)
        setEditingId(null)
        setSelectedId(updated.id)
        toastManager.add({ type: 'success', title: t('toast.updated') })
      }
      else {
        const created = await createAutomationMutation.mutateAsync(toCreateAutomationInput(draft, t))
        setDraft(null)
        setSelectedId(created.id)
        setSelectedArtifactId(null)
        toastManager.add({ type: 'success', title: t('toast.created') })
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setDraftError(message)
      toastManager.add({ type: 'error', title: editingId ? t('toast.updateFailed') : t('toast.createFailed'), description: message })
    }
  }, [createAutomationMutation, draft, editingId, t, updateAutomationMutation])

  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden bg-background"
      data-testid="automation-dashboard"
      data-automation-ready={automationReady ? 'true' : 'false'}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-3">
          {onBack
? (
            <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label={t('action.backToHome')}>
              <ArrowLeftIcon className="size-4" />
            </Button>
          )
: null}
          <div>
            <h1 className="text-sm font-semibold text-foreground">{t('page.title')}</h1>
            <p className="text-xs text-muted-foreground">{t('page.description')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={startDraft} disabled={!!draft}>
            <PlusIcon className="size-3.5" />
            {t('action.create')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void definitionsQuery.refetch()}>
            <RefreshCwIcon className="size-3.5" />
            {t('action.refresh')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!selectedAutomationId || runNowMutation.isPending}
            onClick={() => selectedAutomationId && runNowMutation.mutate(selectedAutomationId)}
          >
            {runNowMutation.isPending ? <Loader2Icon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}
            {t('action.runNow')}
          </Button>
        </div>
      </div>

      {definitionsQuery.isError
? (
        <div className="m-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">{t('error.apiUnavailable')}</div>
            <div className="mt-1 text-xs opacity-80">{definitionsQuery.error.message}</div>
          </div>
        </div>
      )
: null}

      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] divide-x divide-border/40 overflow-hidden">
        <aside className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <span className="text-xs font-medium text-muted-foreground">{t('definitions.title')}</span>
            <div className="flex items-center gap-2">
              <Select
                value={workspaceFilter ?? ''}
                onValueChange={value => setWorkspaceFilter(value || null)}
              >
                <SelectTrigger className="h-6 max-w-32 text-[11px]">
                  <SelectValue placeholder={t('definitions.filterAllWorkspaces')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('definitions.filterAllWorkspaces')}</SelectItem>
                  {workspaces.map(workspace => (
                    <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge variant="secondary">{definitions.length}</Badge>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
            {draft
? (
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null)
                  setSelectedArtifactId(null)
                }}
                className="flex w-full items-start gap-2 rounded-lg border border-dashed border-primary/35 bg-primary/5 px-3 py-3 text-left transition-[background-color,border-color] duration-150 hover:border-primary/50 hover:bg-primary/10"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-dashed border-primary/30 text-primary">
                  <SparklesIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{t('create.title')}</div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {t('create.listDescription')}
                  </p>
                </div>
              </button>
            )
: null}
            {definitionsQuery.isLoading
? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Loader2Icon className="size-3.5 animate-spin" />
                {t('loading.automations')}
              </div>
            )
: null}
            {!definitionsQuery.isLoading && definitions.length === 0
? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-xs text-muted-foreground">
                {t('definitions.empty')}
              </div>
            )
: null}
            {definitions.map(definition => (
              <DefinitionListItem
                key={definition.id}
                definition={definition}
                active={definition.id === selectedAutomationId}
                latestRun={definition.id === selectedAutomationId ? latestRun : definition.latestRun ?? null}
                workspaceName={definition.workspaceId ? workspaceMap[definition.workspaceId] ?? null : null}
                onSelect={() => {
                  setSelectedId(definition.id)
                  setSelectedArtifactId(null)
                }}
              />
            ))}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto">
          {draft
? (
            <CreateAutomationPanel
              draft={draft}
              saving={createAutomationMutation.isPending || updateAutomationMutation.isPending}
              error={draftError}
              canSave={!createAutomationMutation.isPending && !updateAutomationMutation.isPending}
              editingId={editingId}
              onChange={updateDraft}
              onCancel={cancelDraft}
              onSave={() => void saveDraft()}
            />
          )
: selectedDefinition
? (
            <div className="flex flex-col gap-5 p-5">
              <section className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-foreground">{selectedDefinition.title}</h2>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{selectedDefinition.description || t('definition.noDescription')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {latestRun ? <StatusBadge status={latestRun.status} /> : <Badge variant="outline">{t('runs.noneShort')}</Badge>}
                    <Button type="button" variant="outline" size="icon-sm" onClick={() => startEdit(selectedDefinition)} aria-label={t('action.edit')}>
                      <PencilIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <DetailField label={t('detail.workspace')} value={selectedDefinition.workspaceId ? workspaceMap[selectedDefinition.workspaceId] ?? t('common.unknown') : t('definition.workspaceNone')} />
                  <DetailField label={t('detail.rrule')} value={trigger?.rrule ?? t('trigger.noTrigger')} mono />
                  <DetailField label={t('detail.nextRun')} value={formatDateTime(selectedDefinition.nextRunAt, locale, t)} />
                  <DetailField label={t('detail.updated')} value={formatDateTime(selectedDefinition.updatedAt ?? selectedDefinition.createdAt, locale, t)} />
                </div>
              </section>

              <section className="grid grid-cols-[minmax(0,1fr)_280px] gap-4">
                <div className="rounded-lg border border-border/50">
                  <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <BotIcon className="size-3.5 text-muted-foreground" />
                      {t('recipe.section')}
                    </div>
                    <Badge variant="outline">{recipe?.kind ?? t('common.unknown')}</Badge>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-muted-foreground">{recipe?.prompt ?? t('recipe.noPromptSnapshot')}</pre>
                </div>
                <div className="rounded-lg border border-border/50">
                  <div className="border-b border-border/40 px-3 py-2 text-xs font-medium text-foreground">{t('recipe.inputsAndArtifacts')}</div>
                  <div className="space-y-3 p-3 text-xs text-muted-foreground">
                    <div>
                      <div className="mb-1 font-medium text-foreground">{t('inputs.title')}</div>
                      {(recipe?.inputs ?? []).length === 0 ? <div>{t('inputs.empty')}</div> : null}
                      {(recipe?.inputs ?? []).map(input => (
                        <div key={getInputKey(input)} className="truncate rounded bg-muted/40 px-2 py-1">
                          {input.type}
                          {input.name ? ` · ${input.name}` : ''}
                          {input.path ? ` · ${input.path}` : ''}
                          {input.url ? ` · ${input.url}` : ''}
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="mb-1 font-medium text-foreground">{t('artifact.requestsTitle')}</div>
                      {(recipe?.artifactRequests ?? []).length === 0 ? <div>{t('artifact.noRequests')}</div> : null}
                      {(recipe?.artifactRequests ?? []).map(request => (
                        <div key={request.name} className="truncate rounded bg-muted/40 px-2 py-1">
                          {request.name}
                          {request.kind ? ` · ${request.kind}` : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-border/50">
                <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
                  <span className="text-xs font-medium text-foreground">{t('runs.history')}</span>
                  <Badge variant="secondary">{runsQuery.data?.length ?? 0}</Badge>
                </div>
                <div className="divide-y divide-border/30 p-1">
                  {runsQuery.isLoading
? (
                    <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                      <Loader2Icon className="size-3.5 animate-spin" />
                      {t('runs.loading')}
                    </div>
                  )
: null}
                  {!runsQuery.isLoading && (runsQuery.data ?? []).length === 0
? (
                    <div className="px-2 py-4 text-xs text-muted-foreground">{t('runs.empty')}</div>
                  )
: null}
                  {(runsQuery.data ?? []).map(run => <RunRow key={run.id} run={run} />)}
                </div>
              </section>

              <section className="grid grid-cols-[320px_minmax(0,1fr)] gap-4">
                <div className="rounded-lg border border-border/50">
                  <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
                    <span className="text-xs font-medium text-foreground">{t('artifact.title')}</span>
                    <Badge variant="secondary">{artifactsQuery.data?.length ?? 0}</Badge>
                  </div>
                  <div className="p-1">
                    {artifactsQuery.isLoading
? (
                      <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                        <Loader2Icon className="size-3.5 animate-spin" />
                        {t('artifact.loading')}
                      </div>
                    )
: null}
                    {!artifactsQuery.isLoading && (artifactsQuery.data ?? []).length === 0
? (
                      <div className="px-2 py-4 text-xs text-muted-foreground">{t('artifact.empty')}</div>
                    )
: null}
                    {(artifactsQuery.data ?? []).map(artifact => (
                      <ArtifactRow
                        key={artifact.id}
                        artifact={artifact}
                        active={artifact.id === selectedArtifact?.id}
                        onSelect={() => setSelectedArtifactId(artifact.id)}
                      />
                    ))}
                  </div>
                </div>
                <div className="min-w-0 rounded-lg border border-border/50">
                  <div className="border-b border-border/40 px-3 py-2 text-xs font-medium text-foreground">
                    {selectedArtifact ? selectedArtifact.title ?? selectedArtifact.name ?? selectedArtifact.id : t('artifact.preview')}
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-muted-foreground">
                    {selectedArtifact?.content ?? JSON.stringify(selectedArtifact?.metadata ?? {}, null, 2)}
                  </pre>
                </div>
              </section>
            </div>
          )
: (
            <div className="flex h-full items-center justify-center">
              <Empty className="border-none">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CalendarClockIcon />
                  </EmptyMedia>
                  <EmptyTitle>{t('emptySelection.title')}</EmptyTitle>
                  <EmptyDescription>{t('emptySelection.description')}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm" variant="outline" onClick={startDraft}>
                    <PlusIcon className="size-3.5" />
                    {t('action.createAutomation')}
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
