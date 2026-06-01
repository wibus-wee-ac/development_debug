import {
  ArrowLeftIcon,
  BotIcon,
  CalendarClockIcon,
  CheckIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HashIcon,
  Loader2Icon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'

import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'

import type { AutomationArtifact, AutomationDefinition, AutomationInput, AutomationRecipe, AutomationRun, AutomationRunStatus, AutomationTrigger, CreateAutomationInput } from './types'
import { useAutomationArtifacts, useAutomationDefinitions, useAutomationRuns, useCreateAutomation, useRunAutomationNow } from './use-automations'

interface AutomationDashboardProps {
  onBack?: () => void
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

const RUNTIME_KIND_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'claude-agent', label: 'Claude Agent' },
  { value: 'codex', label: 'Codex' },
  { value: 'jar-core', label: 'Jar Core' },
  { value: 'acp-chat', label: 'ACP Chat' },
] as const

interface CreateAutomationDraft {
  title: string
  description: string
  enabled: boolean
  rrule: string
  timezone: string
  misfirePolicy: 'skip' | 'run_latest'
  providerTargetId: string
  runtimeKind: CreateAutomationInput['recipe']['runtimeKind']
  modelId: string
  thinkingEffort: '' | 'low' | 'medium' | 'high'
  prompt: string
  artifactName: string
}

function createDefaultDraft(providerTargetId = ''): CreateAutomationDraft {
  return {
    title: '',
    description: '',
    enabled: true,
    rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    misfirePolicy: 'run_latest',
    providerTargetId,
    runtimeKind: 'standard',
    modelId: '',
    thinkingEffort: '',
    prompt: '',
    artifactName: 'automation-run.md',
  }
}

function defaultRuntimeForProviderKind(providerKind: string): CreateAutomationDraft['runtimeKind'] {
  if (providerKind === 'anthropic') {
    return 'claude-agent'
  }
  return 'standard'
}

function toCreateAutomationInput(draft: CreateAutomationDraft): CreateAutomationInput {
  const title = draft.title.trim()
  const prompt = draft.prompt.trim()
  const providerTargetId = draft.providerTargetId.trim()
  const artifactName = draft.artifactName.trim()

  if (!title) {
    throw new Error('Title is required')
  }
  if (!draft.rrule.trim()) {
    throw new Error('RRULE is required')
  }
  if (!draft.timezone.trim()) {
    throw new Error('Timezone is required')
  }
  if (!providerTargetId) {
    throw new Error('Provider target is required')
  }
  if (!prompt) {
    throw new Error('Prompt is required')
  }
  if (!artifactName) {
    throw new Error('Artifact name is required')
  }

  return {
    title,
    description: draft.description.trim(),
    enabled: draft.enabled,
    trigger: {
      type: 'rrule',
      rrule: draft.rrule.trim(),
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
      modelId: draft.modelId.trim() || undefined,
      thinkingEffort: draft.thinkingEffort || undefined,
    },
    createdByKind: 'user',
  }
}

function formatDateTime(value: number | string | null | undefined): string {
  const unixSeconds = UnixSecondsSchema.parse(value)
  if (unixSeconds === null) {
    return 'Not recorded'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(unixSeconds * 1000))
}

function formatRelative(value: number | string | null | undefined): string {
  const unixSeconds = UnixSecondsSchema.parse(value)
  if (unixSeconds === null) {
    return 'Not recorded'
  }

  const diff = Math.floor(Date.now() / 1000) - unixSeconds
  if (diff < 60) {
    return 'just now'
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m`
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h`
  }
  return `${Math.floor(diff / 86400)}d`
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
  const normalized = (status ?? 'queued') as AutomationRunStatus
  const className = STATUS_STYLES[normalized] ?? STATUS_STYLES.queued

  return (
    <Badge variant="outline" className={cn('capitalize', className)}>
      {status ?? 'unknown'}
    </Badge>
  )
}

function DefinitionListItem({
  definition,
  active,
  latestRun,
  onSelect,
}: {
  definition: AutomationDefinition
  active: boolean
  latestRun: AutomationRun | null
  onSelect: () => void
}) {
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
            {definition.enabled === false ? <Badge variant="secondary">disabled</Badge> : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{definition.description || 'No description'}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">{trigger?.rrule ?? 'No RRULE'}</span>
        {latestRun ? <StatusBadge status={latestRun.status} /> : <Badge variant="outline">no runs</Badge>}
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
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)_minmax(0,1fr)_96px] items-center gap-3 rounded-md px-2 py-2 text-xs hover:bg-accent/40">
      <StatusBadge status={run.status} />
      <div className="min-w-0">
        <div className="truncate font-mono text-[11px] text-foreground">{run.id}</div>
        <div className="text-[11px] text-muted-foreground">{formatDateTime(run.startedAt ?? run.createdAt ?? run.scheduledFor)}</div>
      </div>
      <div className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5">
          <ExternalLinkIcon className="size-3 shrink-0" />
          <span className="truncate font-mono">{run.chatSessionId ?? 'No chat session'}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <HashIcon className="size-3 shrink-0" />
          <span className="truncate font-mono">{run.backendRunId ?? 'No backend run'}</span>
        </div>
      </div>
      <div className="truncate text-right text-[11px] text-muted-foreground">{run.errorText ?? run.reason ?? formatRelative(run.finishedAt ?? run.startedAt ?? run.createdAt)}</div>
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
      <span className="shrink-0 text-[11px] text-muted-foreground">{artifact.kind ?? artifact.mediaType ?? 'artifact'}</span>
    </button>
  )
}

function FormField({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[12px] text-foreground">{label}</Label>
      {children}
      {description ? <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p> : null}
    </div>
  )
}

function CreateAutomationPanel({
  draft,
  saving,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  draft: CreateAutomationDraft
  saving: boolean
  error: string | null
  onChange: (draft: CreateAutomationDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const { providerOptions, isLoading } = useProviderTargets()
  const enabledProviderOptions = useMemo(
    () => providerOptions.filter(option => option.enabled),
    [providerOptions],
  )

  useEffect(() => {
    if (draft.providerTargetId || enabledProviderOptions.length === 0) {
      return
    }
    const firstProvider = enabledProviderOptions[0]
    onChange({
      ...draft,
      providerTargetId: firstProvider.id,
      runtimeKind: defaultRuntimeForProviderKind(firstProvider.providerKind),
    })
  }, [draft, enabledProviderOptions, onChange])

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/40 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg border border-dashed border-foreground/15 text-muted-foreground">
              <SparklesIcon className="size-3.5" />
            </span>
            <h2 className="text-base font-semibold text-foreground text-balance">New automation</h2>
          </div>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            Create a provider-backed scheduled prompt. It will run through the normal chat runtime and save a run artifact.
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onCancel} aria-label="Cancel automation draft">
          <XIcon className="size-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <section className="grid gap-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-[13px] font-medium text-foreground">Definition</h3>
                <p className="mt-0.5 text-[12px] text-muted-foreground">Name the automation and decide whether it starts scheduling immediately.</p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                <span className="text-[12px] text-muted-foreground">Enabled</span>
                <Switch
                  size="sm"
                  checked={draft.enabled}
                  onCheckedChange={checked => onChange({ ...draft, enabled: checked })}
                />
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <FormField label="Title">
                <Input
                  value={draft.title}
                  onChange={event => onChange({ ...draft, title: event.target.value })}
                  placeholder="Weekly workspace summary"
                />
              </FormField>
              <FormField label="Description">
                <Input
                  value={draft.description}
                  onChange={event => onChange({ ...draft, description: event.target.value })}
                  placeholder="Generate a short report every Monday"
                />
              </FormField>
            </div>
          </section>

          <div className="border-t border-foreground/5" />

          <section className="grid gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-foreground">Schedule</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">RRULE is interpreted in the selected timezone.</p>
            </div>
            <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,0.8fr)_minmax(0,0.7fr)] gap-3">
              <FormField label="RRULE">
                <Input
                  value={draft.rrule}
                  onChange={event => onChange({ ...draft, rrule: event.target.value })}
                  className="font-mono text-[12px]"
                />
              </FormField>
              <FormField label="Timezone">
                <Input
                  value={draft.timezone}
                  onChange={event => onChange({ ...draft, timezone: event.target.value })}
                  className="font-mono text-[12px]"
                />
              </FormField>
              <FormField label="Misfire policy">
                <Select
                  value={draft.misfirePolicy}
                  onValueChange={value => onChange({ ...draft, misfirePolicy: value as CreateAutomationDraft['misfirePolicy'] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="run_latest">Run latest</SelectItem>
                    <SelectItem value="skip">Skip</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>
          </section>

          <div className="border-t border-foreground/5" />

          <section className="grid gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-foreground">Runtime</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">Provider-only is supported; no Agent identity is required.</p>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-3">
              <FormField label="Provider target" description={isLoading ? 'Loading providers...' : undefined}>
                <Select
                  value={draft.providerTargetId}
                  onValueChange={(value) => {
                    const provider = enabledProviderOptions.find(option => option.id === value)
                    onChange({
                      ...draft,
                      providerTargetId: value,
                      runtimeKind: provider ? defaultRuntimeForProviderKind(provider.providerKind) : draft.runtimeKind,
                    })
                  }}
                  disabled={enabledProviderOptions.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledProviderOptions.map(option => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Runtime">
                <Select
                  value={draft.runtimeKind}
                  onValueChange={value => onChange({ ...draft, runtimeKind: value as CreateAutomationDraft['runtimeKind'] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RUNTIME_KIND_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Model">
                <Input
                  value={draft.modelId}
                  onChange={event => onChange({ ...draft, modelId: event.target.value })}
                  placeholder="Optional"
                  className="font-mono text-[12px]"
                />
              </FormField>
              <FormField label="Thinking">
                <Select
                  value={draft.thinkingEffort}
                  onValueChange={value => onChange({ ...draft, thinkingEffort: value as CreateAutomationDraft['thinkingEffort'] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Default</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>
          </section>

          <div className="border-t border-foreground/5" />

          <section className="grid gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-foreground">Recipe</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">This prompt becomes the automation run message.</p>
            </div>
            <FormField label="Prompt">
              <Textarea
                value={draft.prompt}
                onChange={event => onChange({ ...draft, prompt: event.target.value })}
                placeholder="Summarize recent workspace activity and produce a concise markdown report."
                className="min-h-40 resize-y text-[13px] leading-relaxed"
              />
            </FormField>
            <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-3">
              <FormField label="Artifact name">
                <Input
                  value={draft.artifactName}
                  onChange={event => onChange({ ...draft, artifactName: event.target.value })}
                  placeholder="automation-run.md"
                />
              </FormField>
              <FormField label="Artifact kind" description="Current runs export the chat transcript as markdown.">
                <div className="flex h-8 items-center rounded-lg border border-input px-2.5 text-sm text-muted-foreground">
                  Markdown
                </div>
              </FormField>
            </div>
          </section>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border/40 px-5 py-3">
        <p className="text-[11px] text-muted-foreground">The automation will create a normal chat session for every run.</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={saving}>
            {saving ? <Loader2Icon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
            Create automation
          </Button>
        </div>
      </footer>
    </div>
  )
}

export function AutomationDashboard({ onBack }: AutomationDashboardProps) {
  const definitionsQuery = useAutomationDefinitions()
  const definitions = definitionsQuery.data ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CreateAutomationDraft | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const selectedDefinition = draft ? null : definitions.find(definition => definition.id === selectedId) ?? definitions[0] ?? null
  const selectedAutomationId = selectedDefinition?.id ?? null
  const runsQuery = useAutomationRuns(selectedAutomationId)
  const artifactsQuery = useAutomationArtifacts(selectedAutomationId)
  const createAutomationMutation = useCreateAutomation()
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

  const startDraft = useCallback((): void => {
    setDraft(createDefaultDraft())
    setDraftError(null)
    setSelectedId(null)
    setSelectedArtifactId(null)
  }, [])

  const cancelDraft = useCallback((): void => {
    setDraft(null)
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
    try {
      setDraftError(null)
      const created = await createAutomationMutation.mutateAsync(toCreateAutomationInput(draft))
      setDraft(null)
      setSelectedId(created.id)
      setSelectedArtifactId(null)
      toastManager.add({ type: 'success', title: 'Automation created' })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setDraftError(message)
      toastManager.add({ type: 'error', title: 'Create automation failed', description: message })
    }
  }, [createAutomationMutation, draft])

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
            <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to home">
              <ArrowLeftIcon className="size-4" />
            </Button>
          )
: null}
          <div>
            <h1 className="text-sm font-semibold text-foreground">Automations</h1>
            <p className="text-xs text-muted-foreground">Agent-authored definitions, runs, links, and artifacts</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={startDraft} disabled={!!draft}>
            <PlusIcon className="size-3.5" />
            Create
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void definitionsQuery.refetch()}>
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!selectedAutomationId || runNowMutation.isPending}
            onClick={() => selectedAutomationId && runNowMutation.mutate(selectedAutomationId)}
          >
            {runNowMutation.isPending ? <Loader2Icon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}
            Run now
          </Button>
        </div>
      </div>

      {definitionsQuery.isError
? (
        <div className="m-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">Automation API unavailable</div>
            <div className="mt-1 text-xs opacity-80">{definitionsQuery.error.message}</div>
          </div>
        </div>
      )
: null}

      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] divide-x divide-border/40 overflow-hidden">
        <aside className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs font-medium text-muted-foreground">Definitions</span>
            <Badge variant="secondary">{definitions.length}</Badge>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
            {draft ? (
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
                  <div className="text-sm font-medium text-foreground">New automation</div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    Configure a provider-backed scheduled prompt
                  </p>
                </div>
              </button>
            ) : null}
            {definitionsQuery.isLoading
? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Loader2Icon className="size-3.5 animate-spin" />
                Loading automations
              </div>
            )
: null}
            {!definitionsQuery.isLoading && definitions.length === 0
? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-xs text-muted-foreground">
                No automation definitions yet
              </div>
            )
: null}
            {definitions.map(definition => (
              <DefinitionListItem
                key={definition.id}
                definition={definition}
                active={definition.id === selectedAutomationId}
                latestRun={definition.id === selectedAutomationId ? latestRun : definition.latestRun ?? null}
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
              saving={createAutomationMutation.isPending}
              error={draftError}
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
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{selectedDefinition.description || 'No description'}</p>
                  </div>
                  {latestRun ? <StatusBadge status={latestRun.status} /> : <Badge variant="outline">no runs</Badge>}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <DetailField label="RRULE" value={trigger?.rrule ?? 'No trigger'} mono />
                  <DetailField label="Timezone" value={trigger?.timezone ?? 'Unknown'} />
                  <DetailField label="Next run" value={formatDateTime(selectedDefinition.nextRunAt)} />
                  <DetailField label="Updated" value={formatDateTime(selectedDefinition.updatedAt ?? selectedDefinition.createdAt)} />
                </div>
              </section>

              <section className="grid grid-cols-[minmax(0,1fr)_280px] gap-4">
                <div className="rounded-lg border border-border/50">
                  <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <BotIcon className="size-3.5 text-muted-foreground" />
                      Recipe
                    </div>
                    <Badge variant="outline">{recipe?.kind ?? 'unknown'}</Badge>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-muted-foreground">{recipe?.prompt ?? 'No prompt snapshot available'}</pre>
                </div>
                <div className="rounded-lg border border-border/50">
                  <div className="border-b border-border/40 px-3 py-2 text-xs font-medium text-foreground">Inputs and artifact requests</div>
                  <div className="space-y-3 p-3 text-xs text-muted-foreground">
                    <div>
                      <div className="mb-1 font-medium text-foreground">Inputs</div>
                      {(recipe?.inputs ?? []).length === 0 ? <div>No inputs</div> : null}
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
                      <div className="mb-1 font-medium text-foreground">Artifacts</div>
                      {(recipe?.artifactRequests ?? []).length === 0 ? <div>No requests</div> : null}
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
                  <span className="text-xs font-medium text-foreground">Run history</span>
                  <Badge variant="secondary">{runsQuery.data?.length ?? 0}</Badge>
                </div>
                <div className="divide-y divide-border/30 p-1">
                  {runsQuery.isLoading
? (
                    <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                      <Loader2Icon className="size-3.5 animate-spin" />
                      Loading runs
                    </div>
                  )
: null}
                  {!runsQuery.isLoading && (runsQuery.data ?? []).length === 0
? (
                    <div className="px-2 py-4 text-xs text-muted-foreground">No runs recorded</div>
                  )
: null}
                  {(runsQuery.data ?? []).map(run => <RunRow key={run.id} run={run} />)}
                </div>
              </section>

              <section className="grid grid-cols-[320px_minmax(0,1fr)] gap-4">
                <div className="rounded-lg border border-border/50">
                  <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
                    <span className="text-xs font-medium text-foreground">Artifacts</span>
                    <Badge variant="secondary">{artifactsQuery.data?.length ?? 0}</Badge>
                  </div>
                  <div className="p-1">
                    {artifactsQuery.isLoading
? (
                      <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                        <Loader2Icon className="size-3.5 animate-spin" />
                        Loading artifacts
                      </div>
                    )
: null}
                    {!artifactsQuery.isLoading && (artifactsQuery.data ?? []).length === 0
? (
                      <div className="px-2 py-4 text-xs text-muted-foreground">No artifacts recorded</div>
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
                    {selectedArtifact ? selectedArtifact.title ?? selectedArtifact.name ?? selectedArtifact.id : 'Artifact preview'}
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
                  <EmptyTitle>No automation selected</EmptyTitle>
                  <EmptyDescription>Select an automation definition or create a new scheduled prompt.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm" variant="outline" onClick={startDraft}>
                    <PlusIcon className="size-3.5" />
                    Create automation
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
