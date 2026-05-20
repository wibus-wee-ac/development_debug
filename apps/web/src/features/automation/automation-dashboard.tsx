// Input: automation query hooks
// Output: AutomationDashboard registry/viewer for definitions, latest state, runs, links, and artifacts
// Position: Feature-owned UI surface embedded from Home until a dedicated tab exists

import {
  ArrowLeftIcon,
  BotIcon,
  CalendarClockIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HashIcon,
  Loader2Icon,
  PlayIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import type { AutomationArtifact, AutomationDefinition, AutomationInput, AutomationRecipe, AutomationRun, AutomationRunStatus, AutomationTrigger } from './types'
import { useAutomationArtifacts, useAutomationDefinitions, useAutomationRuns, useRunAutomationNow } from './use-automations'

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

function asUnixSeconds(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : value
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000)
}

function formatDateTime(value: number | string | null | undefined): string {
  const unixSeconds = asUnixSeconds(value)
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
  const unixSeconds = asUnixSeconds(value)
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
  return asUnixSeconds(run?.createdAt ?? run?.startedAt ?? run?.scheduledFor) ?? 0
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

export function AutomationDashboard({ onBack }: AutomationDashboardProps) {
  const definitionsQuery = useAutomationDefinitions()
  const definitions = definitionsQuery.data ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedDefinition = definitions.find(definition => definition.id === selectedId) ?? definitions[0] ?? null
  const selectedAutomationId = selectedDefinition?.id ?? null
  const runsQuery = useAutomationRuns(selectedAutomationId)
  const artifactsQuery = useAutomationArtifacts(selectedAutomationId)
  const runNowMutation = useRunAutomationNow()
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)

  const latestRun = selectedDefinition ? getLatestRun(selectedDefinition, runsQuery.data) : null
  const trigger = selectedDefinition ? getTrigger(selectedDefinition) : null
  const recipe = selectedDefinition ? getRecipe(selectedDefinition) : null
  const selectedArtifact = useMemo(() => {
    const artifacts = artifactsQuery.data ?? []
    return artifacts.find(artifact => artifact.id === selectedArtifactId) ?? artifacts[0] ?? null
  }, [artifactsQuery.data, selectedArtifactId])

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background" data-testid="automation-dashboard">
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
          {selectedDefinition
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
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select an automation definition
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
