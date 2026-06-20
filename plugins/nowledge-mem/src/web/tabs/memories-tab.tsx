/* Memories tab — search durable memories with master-detail layout.
   - Search input with fast/deep mode toggle
   - Result list (master) with importance dot, label chips, timestamp
   - Selected memory detail with content, labels, meta, source-thread link
*/

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import {
  AlertLine as AlertCircleIcon,
  BookmarkLine as TagIcon,
  BrainLine as BrainIcon,
  Calendar2Line as CalendarIcon,
  Chat3Line as ChatIcon,
  ClockLine as ClockIcon,
  CopyLine as CopyIcon,
  Search2Line as SearchIcon,
  SparklesLine as SparkleIcon,
  Building2Line,
} from '@mingcute/react'
import { LayoutGroup, m } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'

import { Alert, AlertDescription } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { Skeleton } from '~/components/ui/skeleton'
import { cn } from '~/lib/cn'

import { formatRelativeTime, firstLine, truncate } from '../format'
import { useMemorySearch, useNowledgeConfig } from '../hooks'
import { setNowledgeUiState, useNowledgeUiAction } from '../store'
import type { Memory } from '../types'

interface MemoriesTabProps {
  ctx: WebPluginContext
}

export function MemoriesTab({ ctx }: MemoriesTabProps) {
  const { config } = useNowledgeConfig(ctx.routes, true)
  const enabled = !!config?.enabled && config.hasApiKey
  const spaceId = config?.spaceId ?? null

  const query = useNowledgeUiAction(s => s.memoriesQuery)
  const mode = useNowledgeUiAction(s => s.memoriesMode)
  const selectedId = useNowledgeUiAction(s => s.selectedMemoryId)

  const [debouncedQuery, setDebouncedQuery] = useState(query)

  // Debounce search input
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQuery(query)
      setNowledgeUiState({ memoriesQuery: query })
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  const search = useMemorySearch(
    ctx.routes,
    { q: debouncedQuery, mode, limit: 30, spaceId },
    enabled && debouncedQuery.trim().length > 0,
  )

  const memories = search.data?.memories ?? []
  const selected = useMemo(
    () => memories.find(m => m.id === selectedId) ?? null,
    [memories, selectedId],
  )

  if (!config) {
    return <MemoriesSkeleton />
  }
  if (!enabled) {
    return <DisabledHint />
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* Master: search + list */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="flex flex-col gap-2 p-3">
          <SearchInput
            value={query}
            onChange={v => setNowledgeUiState({ memoriesQuery: v })}
            placeholder="Search memories…"
          />
          <ModeToggle mode={mode} onChange={next => setNowledgeUiState({ memoriesMode: next })} />
        </div>
        <Separator />
        <ScrollArea className="flex-1">
          <MemoryList
            loading={search.loading}
            error={search.error}
            memories={memories}
            hasQuery={debouncedQuery.trim().length > 0}
            selectedId={selectedId}
            onSelect={id => setNowledgeUiState({ selectedMemoryId: id })}
          />
        </ScrollArea>
      </aside>

      {/* Detail */}
      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <MemoryDetail memory={selected} ctx={ctx} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty className="border-none">
              <EmptyHeader>
                <EmptyMedia variant="icon"><BrainIcon /></EmptyMedia>
                <EmptyTitle>{debouncedQuery.trim() ? 'Select a memory' : 'Search to begin'}</EmptyTitle>
                <EmptyDescription>
                  {debouncedQuery.trim()
                    ? 'Pick a memory from the list to see its full content.'
                    : 'Type a query above to search across durable memory.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </section>
    </div>
  )
}

/* ─── Search input ────────────────────────────────────────────────────── */

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
}) {
  return (
    <div className="relative min-w-0">
      <SearchIcon
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="h-8 pl-8 pr-2 text-[12.5px]"
      />
    </div>
  )
}

/* ─── Mode toggle (fast/deep) ─────────────────────────────────────────── */

function ModeToggle({
  mode,
  onChange,
}: {
  mode: 'fast' | 'deep'
  onChange: (next: 'fast' | 'deep') => void
}) {
  return (
    <LayoutGroup id="memory-mode-toggle">
      <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
        {(['fast', 'deep'] as const).map(value => {
          const isActive = mode === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => onChange(value)}
              className={cn(
                'relative flex-1 rounded-[5px] px-2 py-1 text-[11.5px] font-medium',
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {isActive && (
                <m.span
                  layoutId="memory-mode-pill"
                  className="absolute inset-0 rounded-[5px] bg-card shadow-sm"
                  transition={{ type: 'spring', stiffness: 520, damping: 36, mass: 0.7 }}
                />
              )}
              <span className="relative">{value === 'fast' ? 'Fast' : 'Deep'}</span>
            </button>
          )
        })}
      </div>
    </LayoutGroup>
  )
}

/* ─── Memory list ─────────────────────────────────────────────────────── */

function MemoryList({
  loading,
  error,
  memories,
  hasQuery,
  selectedId,
  onSelect,
}: {
  loading: boolean
  error: string | null
  memories: Memory[]
  hasQuery: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (loading && memories.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 5 }).map((_, idx) => (
          <Skeleton key={idx} className="h-14 w-full rounded-md" />
        ))}
      </div>
    )
  }

  if (error && memories.length === 0) {
    return (
      <div className="p-3">
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (memories.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Empty className="border-none">
          <EmptyHeader>
            <EmptyMedia variant="icon"><SparkleIcon /></EmptyMedia>
            <EmptyTitle>{hasQuery ? 'No matches' : 'No memories yet'}</EmptyTitle>
            <EmptyDescription>
              {hasQuery
                ? 'Try a different query or switch to deep mode.'
                : 'Capture your first memory from the Today tab.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <LayoutGroup id="memory-list">
      <ul className="flex flex-col p-2">
        {memories.map(memory => {
          const isSelected = memory.id === selectedId
          return (
            <li key={memory.id}>
              <m.button
                type="button"
                layout
                onClick={() => onSelect(memory.id)}
                className={cn(
                  'group relative flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors',
                  isSelected ? 'bg-accent' : 'hover:bg-accent/60',
                )}
                data-selected={isSelected}
              >
                <div className="flex items-start gap-2">
                  <ImportanceDot value={memory.importance} />
                  <span className="line-clamp-2 flex-1 text-[12.5px] text-foreground">
                    {firstLine(memory.content) || memory.id}
                  </span>
                </div>
                <div className="flex items-center gap-2 pl-3.5">
                  {memory.unit_type && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">{memory.unit_type}</Badge>
                  )}
                  {memory.labels?.slice(0, 2).map(label => (
                    <Badge key={label} variant="secondary" className="h-4 gap-0.5 px-1 text-[10px]">
                      <TagIcon className="!size-2.5" aria-hidden="true" />
                      {label}
                    </Badge>
                  ))}
                  {memory.recorded_at && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {formatRelativeTime(memory.recorded_at)}
                    </span>
                  )}
                </div>
              </m.button>
            </li>
          )
        })}
      </ul>
    </LayoutGroup>
  )
}

/* ─── Importance dot ──────────────────────────────────────────────────── */

function ImportanceDot({ value }: { value?: number }) {
  if (value == null || Number.isNaN(value)) {
    return <span className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden="true" />
  }
  const color = value >= 0.8 ? 'bg-success' : value >= 0.5 ? 'bg-warning' : value > 0 ? 'bg-info' : 'bg-muted-foreground/40'
  return <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', color)} aria-hidden="true" />
}

/* ─── Memory detail ───────────────────────────────────────────────────── */

function MemoryDetail({ memory, ctx }: { memory: Memory, ctx: WebPluginContext }) {
  const handleCopy = () => {
    void navigator.clipboard.writeText(memory.content).then(() => {
      ctx.notifications.show({ title: 'Copied', type: 'success' })
    })
  }

  return (
    <ScrollArea className="h-full" viewportClassName="max-h-full">
      <article className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {memory.unit_type && (
                <Badge variant="outline" className="text-[10px]">{memory.unit_type}</Badge>
              )}
              <Badge variant="secondary" className="gap-0.5 text-[10px]">
                <Building2Line className="!size-2.5" aria-hidden="true" />
                {(memory.importance ?? 0).toFixed(2)}
              </Badge>
              {memory.review_status && (
                <Badge variant="outline" className="text-[10px]">{memory.review_status}</Badge>
              )}
            </div>
            {memory.labels && memory.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {memory.labels.map(label => (
                  <Badge key={label} variant="secondary" className="gap-0.5 text-[10px]">
                    <TagIcon className="!size-2.5" aria-hidden="true" />
                    {label}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={handleCopy}>
            <CopyIcon className="size-3.5" aria-hidden="true" />
            Copy
          </Button>
        </header>

        <Separator />

        <div className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed text-foreground">
          {memory.content}
        </div>

        <Separator />

        <footer className="flex flex-col gap-2 text-[11.5px] text-muted-foreground">
          <MetaRow icon={<CalendarIcon className="size-3.5" aria-hidden="true" />} label="Event">
            {[memory.event_start, memory.event_end].filter(Boolean).join(' → ') || '—'}
          </MetaRow>
          <MetaRow icon={<ClockIcon className="size-3.5" aria-hidden="true" />} label="Recorded">
            {memory.recorded_at ?? '—'}
          </MetaRow>
          {memory.source_thread_id && (
            <MetaRow icon={<ChatIcon className="size-3.5" aria-hidden="true" />} label="Source thread">
              <button
                type="button"
                className="font-mono text-[11px] text-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setNowledgeUiState({
                    activeTab: 'threads',
                    selectedThreadId: memory.source_thread_id!,
                  })
                }}
              >
                {truncate(memory.source_thread_id, 24)}
              </button>
            </MetaRow>
          )}
        </footer>
      </article>
    </ScrollArea>
  )
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1 text-muted-foreground/80">
        {icon}
        <span>{label}</span>
      </span>
      <span className="ml-auto truncate font-mono text-[11px] text-foreground">{children}</span>
    </div>
  )
}

/* ─── Skeletons + disabled ────────────────────────────────────────────── */

function MemoriesSkeleton() {
  return (
    <div className="flex h-full flex-1">
      <aside className="flex w-80 shrink-0 flex-col gap-3 border-r border-border p-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-6 w-24" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, idx) => (
            <Skeleton key={idx} className="h-14 w-full rounded-md" />
          ))}
        </div>
      </aside>
      <section className="flex flex-1 items-center justify-center p-6">
        <Skeleton className="h-40 w-2/3 rounded-lg" />
      </section>
    </div>
  )
}

function DisabledHint() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Empty className="border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon"><BrainIcon /></EmptyMedia>
          <EmptyTitle>Memories unavailable</EmptyTitle>
          <EmptyDescription>
            Enable the plugin and set an API key in Config to search durable memory.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
