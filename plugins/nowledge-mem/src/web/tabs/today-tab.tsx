/* Today tab — daily briefing (Working Memory) + Context Bundle + Quick Capture.
   This is the default landing surface. If the plugin is disabled or no API key
   is set, shows a guided empty state pointing to the Config tab. */

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import {
  AlertLine as AlertCircleIcon,
  BookmarksLine as BookmarksIcon,
  BrainLine as BrainIcon,
  Building2Line,
  Refresh1Line as RefreshIcon,
  Settings2Line as SettingsIcon,
  Sparkles2Line as SparklesIcon,
  Sun2Line as SunIcon,
  User3Line as UserIcon,
} from '@mingcute/react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { Skeleton } from '~/components/ui/skeleton'

import { QuickCapture } from '../components/quick-capture'
import { extractBundleRows, ReferencedMemories, WorkingMemoryView } from '../components/working-memory-view'
import { formatShortDate } from '../format'
import { useContextBundle, useNowledgeConfig, useWorkingMemory } from '../hooks'
import { setNowledgeUiState } from '../store'

interface TodayTabProps {
  ctx: WebPluginContext
}

export function TodayTab({ ctx }: TodayTabProps) {
  const { config } = useNowledgeConfig(ctx.routes, true)
  const spaceId = config?.spaceId ?? null
  const enabled = !!config?.enabled && config.hasApiKey

  const workingMemory = useWorkingMemory(ctx.routes, spaceId, enabled)
  const contextBundle = useContextBundle(ctx.routes, spaceId, enabled)

  if (!config) {
    return <TodaySkeleton />
  }

  if (!config.enabled || !config.hasApiKey) {
    return <DisabledEmpty onConfigure={() => setNowledgeUiState({ activeTab: 'config' })} />
  }

  const wm = workingMemory.data
  const bundle = contextBundle.data
  const bundleRows = extractBundleRows(bundle)

  return (
    <ScrollArea className="h-full" viewportClassName="max-h-full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6 lg:flex-row lg:items-start">
        {/* Left: Working Memory + Quick Capture */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <SunIcon className="size-4" aria-hidden="true" />
                </span>
                <span className="flex flex-col">
                  <span>Working Memory</span>
                </span>
              </CardTitle>
              <CardDescription>
                {wm?.date
                  ? `Briefing for ${formatShortDate(wm.date) ?? wm.date}`
                  : 'Today\'s agent-curated briefing.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <HeaderActions
                loading={workingMemory.loading}
                onRefresh={() => void workingMemory.refresh()}
              />
              {workingMemory.loading && !wm && (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-3 w-24 mt-2" />
                  <Skeleton className="h-5 w-full" />
                </div>
              )}
              {!workingMemory.loading && workingMemory.error && (
                <Alert variant="destructive">
                  <AlertCircleIcon aria-hidden="true" />
                  <AlertTitle>Couldn't load Working Memory</AlertTitle>
                  <AlertDescription>{workingMemory.error}</AlertDescription>
                </Alert>
              )}
              {!workingMemory.loading && !workingMemory.error && wm && <WorkingMemoryView data={wm} />}
              {!workingMemory.loading && !workingMemory.error && !wm && (
                <Empty className="border-none">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><SparklesIcon /></EmptyMedia>
                    <EmptyTitle>No briefing yet</EmptyTitle>
                    <EmptyDescription>
                      Working Memory is empty for this space. The Knowledge Agent updates it daily.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardContent className="pt-4">
              <QuickCapture ctx={ctx} onCreated={() => void workingMemory.refresh()} />
            </CardContent>
          </Card>
        </div>

        {/* Right: Context Bundle */}
        <div className="flex w-full flex-col gap-3 lg:w-80 lg:shrink-0">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2Line className="size-4" aria-hidden="true" />
                </span>
                Context Bundle
              </CardTitle>
              <CardDescription>Active identity, space, and rules.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {contextBundle.loading && !bundle && (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              )}
              {bundleRows.length > 0 && (
                <dl className="flex flex-col">
                  {bundleRows.map((row, idx) => (
                    <div key={row.label}>
                      {idx > 0 && <Separator />}
                      <div className="flex items-baseline justify-between gap-2 py-1.5">
                        <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <RowIcon label={row.label} />
                          {row.label}
                        </dt>
                        <dd className="truncate font-mono text-[12px] text-foreground" title={row.value ?? ''}>
                          {row.value}
                        </dd>
                      </div>
                    </div>
                  ))}
                </dl>
              )}
              {contextBundle.error && !bundle && (
                <Alert variant="destructive">
                  <AlertCircleIcon aria-hidden="true" />
                  <AlertDescription>{contextBundle.error}</AlertDescription>
                </Alert>
              )}
              {!contextBundle.loading && !contextBundle.error && bundle && bundleRows.length === 0 && (
                <p className="text-[12px] text-muted-foreground">No identity info returned.</p>
              )}
            </CardContent>
          </Card>

          {wm?.referenced_memories && wm.referenced_memories.length > 0 && (
            <Card size="sm">
              <CardContent className="pt-4">
                <ReferencedMemories
                  refs={wm.referenced_memories}
                  onSelect={() => setNowledgeUiState({ activeTab: 'memories' })}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}

function HeaderActions({ loading, onRefresh }: { loading: boolean, onRefresh: () => void }) {
  return (
    <div className="flex items-center justify-end">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={onRefresh}
        disabled={loading}
        aria-label="Refresh Working Memory"
      >
        <RefreshIcon className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
      </Button>
    </div>
  )
}

function RowIcon({ label }: { label: string }) {
  const lower = label.toLowerCase()
  if (lower.includes('owner')) { return <UserIcon className="size-3 !text-muted-foreground" aria-hidden="true" /> }
  if (lower.includes('agent')) { return <BrainIcon className="size-3 !text-muted-foreground" aria-hidden="true" /> }
  if (lower.includes('space')) { return <BookmarksIcon className="size-3 !text-muted-foreground" aria-hidden="true" /> }
  if (lower.includes('rule')) { return <SettingsIcon className="size-3 !text-muted-foreground" aria-hidden="true" /> }
  return null
}

function TodaySkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-6">
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}

function DisabledEmpty({ onConfigure }: { onConfigure: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Empty className="border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon"><SettingsIcon /></EmptyMedia>
          <EmptyTitle>Connect to Nowledge Mem</EmptyTitle>
          <EmptyDescription>
            Configure the API URL and provide an API key to load your daily briefing,
            search memories, and browse threads.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={onConfigure}>
            <SettingsIcon className="size-3.5" aria-hidden="true" />
            Open Config
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
