/* Threads tab — search and browse conversation threads.
   - Search input with source filter
   - Master list of thread summaries
   - Detail view: messages with role-coded bubbles
*/

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import {
  AlertLine as AlertCircleIcon,
  Chat3Line as ChatIcon,
  Refresh1Line as RefreshIcon,
  Search2Line as SearchIcon,
  Sparkles2Line as SparklesIcon,
  Sparkles2Fill as SparklesFillIcon,
  User3Line as UserIcon,
} from '@mingcute/react'
import { LayoutGroup, m } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'

import { Alert, AlertDescription } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Separator } from '~/components/ui/separator'
import { Skeleton } from '~/components/ui/skeleton'
import { cn } from '~/lib/cn'

import { formatRelativeTime, truncate } from '../format'
import { useNowledgeConfig, useThread, useThreadSearch } from '../hooks'
import { setNowledgeUiState, useNowledgeUiAction } from '../store'
import type { ThreadDetail as ThreadDetailData, ThreadMessage, ThreadSummary } from '../types'

interface ThreadsTabProps {
  ctx: WebPluginContext
}

const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'cradle', label: 'Cradle' },
  { value: 'claude-agent', label: 'Cradle agent' },
  { value: 'claude', label: 'Claude' },
]

export function ThreadsTab({ ctx }: ThreadsTabProps) {
  const { config } = useNowledgeConfig(ctx.routes, true)
  const enabled = !!config?.enabled && config.hasApiKey
  const spaceId = config?.spaceId ?? null

  const query = useNowledgeUiAction(s => s.threadsQuery)
  const source = useNowledgeUiAction(s => s.threadsSource)
  const selectedId = useNowledgeUiAction(s => s.selectedThreadId)

  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQuery(query)
      setNowledgeUiState({ threadsQuery: query })
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  const search = useThreadSearch(
    ctx.routes,
    { query: debouncedQuery, source: source || undefined, limit: 30, spaceId },
    enabled && debouncedQuery.trim().length > 0,
  )

  const thread = useThread(ctx.routes, selectedId, spaceId, enabled && !!selectedId)

  const threads = search.data?.threads ?? []

  if (!config) { return <ThreadsSkeleton /> }
  if (!enabled) { return <DisabledHint /> }

  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* Master: search + filter + list */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="flex flex-col gap-2 p-3">
          <div className="relative min-w-0">
            <SearchIcon
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={e => setNowledgeUiState({ threadsQuery: e.target.value })}
              placeholder="Search threads…"
              autoComplete="off"
              spellCheck={false}
              className="h-8 pl-8 pr-2 text-[12.5px]"
            />
          </div>
          <Select
            value={source || 'all'}
            onValueChange={v => setNowledgeUiState({ threadsSource: v === 'all' ? '' : v })}
          >
            <SelectTrigger size="sm" className="h-8 text-[12px]">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map(opt => (
                <SelectItem key={opt.value || 'all'} value={opt.value || 'all'}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Separator />
        <ScrollArea className="flex-1">
          <ThreadList
            loading={search.loading}
            error={search.error}
            threads={threads}
            hasQuery={debouncedQuery.trim().length > 0}
            selectedId={selectedId}
            onSelect={id => setNowledgeUiState({ selectedThreadId: id })}
          />
        </ScrollArea>
      </aside>

      {/* Detail */}
      <section className="flex min-w-0 flex-1 flex-col">
        {selectedId ? (
          <ThreadDetail
            threadId={selectedId}
            loading={thread.loading}
            error={thread.error}
            data={thread.data}
            onRefresh={() => void thread.refresh()}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty className="border-none">
              <EmptyHeader>
                <EmptyMedia variant="icon"><ChatIcon /></EmptyMedia>
                <EmptyTitle>{debouncedQuery.trim() ? 'Select a thread' : 'Search to begin'}</EmptyTitle>
                <EmptyDescription>
                  {debouncedQuery.trim()
                    ? 'Pick a thread from the list to read its messages.'
                    : 'Type a query above to search across conversation threads.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </section>
    </div>
  )
}

/* ─── Thread list ─────────────────────────────────────────────────────── */

function ThreadList({
  loading,
  error,
  threads,
  hasQuery,
  selectedId,
  onSelect,
}: {
  loading: boolean
  error: string | null
  threads: ThreadSummary[]
  hasQuery: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (loading && threads.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 5 }).map((_, idx) => (
          <Skeleton key={idx} className="h-14 w-full rounded-md" />
        ))}
      </div>
    )
  }

  if (error && threads.length === 0) {
    return (
      <div className="p-3">
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Empty className="border-none">
          <EmptyHeader>
            <EmptyMedia variant="icon"><SparklesIcon /></EmptyMedia>
            <EmptyTitle>{hasQuery ? 'No matches' : 'No threads yet'}</EmptyTitle>
            <EmptyDescription>
              {hasQuery ? 'Try a different query or source.' : 'Threads appear here after agents log conversations.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <LayoutGroup id="thread-list">
      <ul className="flex flex-col p-2">
        {threads.map(thread => {
          const isSelected = thread.thread_id === selectedId
          return (
            <li key={thread.thread_id}>
              <m.button
                type="button"
                layout
                onClick={() => onSelect(thread.thread_id)}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors',
                  isSelected ? 'bg-accent' : 'hover:bg-accent/60',
                )}
                data-selected={isSelected}
              >
                <span className="line-clamp-1 text-[12.5px] font-medium text-foreground">
                  {thread.title || thread.thread_id}
                </span>
                <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
                  {thread.source && <SourceBadge source={thread.source} />}
                  {typeof thread.message_count === 'number' && (
                    <span>{thread.message_count} msgs</span>
                  )}
                  {(thread.last_message_at ?? thread.created_at) && (
                    <span className="ml-auto">
                      {formatRelativeTime(thread.last_message_at ?? thread.created_at)}
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

function SourceBadge({ source }: { source: string }) {
  return (
    <Badge variant="outline" className="h-4 gap-0.5 px-1 text-[10px]">
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: sourceColor(source) }}
        aria-hidden="true"
      />
      {source}
    </Badge>
  )
}

function sourceColor(source: string): string {
  const hash = Array.from(source).reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  const hues = [12, 32, 96, 168, 200, 264, 292]
  const idx = hash % hues.length
  return `hsl(${hues[idx]} 65% 55%)`
}

/* ─── Thread detail (message viewer) ──────────────────────────────────── */

function ThreadDetail({
  threadId,
  loading,
  error,
  data,
  onRefresh,
}: {
  threadId: string
  loading: boolean
  error: string | null
  data: ThreadDetailData | null
  onRefresh: () => void
}) {
  if (loading && !data) {
    return (
      <div className="flex flex-1 flex-col gap-2 p-6">
        <Skeleton className="h-6 w-2/3" />
        <Separator />
        {Array.from({ length: 4 }).map((_, idx) => (
          <Skeleton key={idx} className="h-20 w-full rounded-md" />
        ))}
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!data) { return null }
  const messages = data.messages ?? []

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-1 text-[13px] font-medium font-heading text-foreground">
            {data.title || data.thread_id}
          </span>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {data.source && <SourceBadge source={data.source} />}
            <span className="font-mono">{truncate(threadId, 20)}</span>
            <span>· {messages.length} messages</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Refresh thread"
        >
          <RefreshIcon className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
        </button>
      </header>
      <ScrollArea className="flex-1">
        <ol className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
          {messages.map((msg, idx) => (
            <MessageBubble key={msg.id ?? idx} message={msg} />
          ))}
          {messages.length === 0 && (
            <Empty className="border-none">
              <EmptyHeader>
                <EmptyMedia variant="icon"><ChatIcon /></EmptyMedia>
                <EmptyTitle>Empty thread</EmptyTitle>
                <EmptyDescription>This thread has no messages yet.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </ol>
      </ScrollArea>
    </div>
  )
}

function MessageBubble({ message }: { message: ThreadMessage }) {
  const role = (message.role ?? 'user').toLowerCase()
  const isUser = role === 'user' || role === 'human' || role === 'tool'
  const content = renderMessageContent(message.content)

  return (
    <li className={cn('flex gap-2.5', isUser ? 'flex-row' : 'flex-row-reverse')}>
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-muted text-foreground' : 'bg-primary/10 text-primary',
        )}
        aria-hidden="true"
      >
        {isUser ? <UserIcon className="size-3.5" /> : <SparklesFillIcon className="size-3.5" />}
      </span>
      <div
        className={cn(
          'flex min-w-0 max-w-[80%] flex-col gap-1 rounded-lg px-3 py-2 text-[13px] leading-relaxed',
          isUser
            ? 'bg-card text-foreground ring-1 ring-foreground/10'
            : 'bg-muted text-foreground',
        )}
      >
        <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{role}</span>
        <div className="whitespace-pre-wrap break-words">{content}</div>
      </div>
    </li>
  )
}

function renderMessageContent(content: unknown): string {
  if (typeof content === 'string') { return content }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') { return item }
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>
          const text = obj.text ?? obj.content ?? obj.value
          if (typeof text === 'string') { return text }
        }
        return null
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    try { return JSON.stringify(content, null, 2) }
    catch { return '[unserializable content]' }
  }
  return ''
}

/* ─── Skeletons + disabled ────────────────────────────────────────────── */

function ThreadsSkeleton() {
  return (
    <div className="flex h-full flex-1">
      <aside className="flex w-80 shrink-0 flex-col gap-3 border-r border-border p-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
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
          <EmptyMedia variant="icon"><ChatIcon /></EmptyMedia>
          <EmptyTitle>Threads unavailable</EmptyTitle>
          <EmptyDescription>
            Enable the plugin and set an API key in Config to browse conversation threads.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
