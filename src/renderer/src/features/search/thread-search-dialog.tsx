// Input: ThreadSearchHit from @main/ipc-types, groupHitsByWorkspace helper, useThreadSearch hook, COSS Command primitives, TanStack Router navigate, HighlightedText
// Output: ThreadSearchDialog — global search palette using COSS Command (Autocomplete-based) with workspace-grouped session results and user+assistant snippets
// Position: Search feature root UI component; controlled open state from parent (sidebar button / ⌘K shortcut)

import type { ThreadSearchHit } from '@main/ipc-types'
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
} from '@renderer/components/ui/command'
import { EmptyMedia } from '@renderer/components/ui/empty'
import { Kbd, KbdGroup } from '@renderer/components/ui/kbd'
import { Spinner } from '@renderer/components/ui/spinner'
import { cn } from '@renderer/lib/utils'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CornerDownLeftIcon,
  MessageSquareIcon,
  SearchIcon,
  SparklesIcon,
  UserIcon,
} from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

import { groupHitsByWorkspace, type GroupedSearchHits } from './thread-search-groups'
import { HighlightedText } from './highlighted-text'
import { useThreadSearch } from './use-thread-search'

interface ThreadSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatRelativeTime(unix: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - unix
  if (diff < 60) {
    return '刚刚'
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)} 分钟前`
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)} 小时前`
  }
  if (diff < 2592000) {
    return `${Math.floor(diff / 86400)} 天前`
  }
  return `${Math.floor(diff / 2592000)} 月前`
}

// Pass-through filter: our data is already jieba-filtered on the main process,
// so the autocomplete primitive should render whatever we give it as-is.
const passthroughFilter = () => true

export function ThreadSearchDialog({ open, onOpenChange }: ThreadSearchDialogProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  // Reset the query whenever the dialog closes so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setQuery('')
    }
  }, [open])

  const { hits, isPending, hasQuery } = useThreadSearch({
    query,
    enabled: open,
  })

  const groups = useMemo(() => groupHitsByWorkspace(hits), [hits])

  const handleSelect = useCallback(
    (hit: ThreadSearchHit) => {
      onOpenChange(false)
      navigate({ to: '/chat/$sessionId', params: { sessionId: hit.sessionId }, search: { tearoff: false } })
    },
    [navigate, onOpenChange],
  )

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup className="max-w-2xl">
        <Command
          items={groups}
          filter={passthroughFilter}
          autoHighlight="always"
          keepHighlight
        >
          <CommandInput
            placeholder="搜索会话标题和消息内容..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="搜索会话"
          />
          <CommandPanel>
            <CommandEmpty className="not-empty:py-12">
              {hasQuery
                ? isPending
                  ? <LoadingEmpty />
                  : <NoResultsEmpty query={query} />
                : <IdleEmpty />}
            </CommandEmpty>
            <CommandList>
              {(group: GroupedSearchHits) => (
                <Fragment key={group.value}>
                  <CommandGroup items={group.items}>
                    <CommandGroupLabel className="flex items-center justify-between">
                      <span>{group.label}</span>
                      <span className="font-normal text-muted-foreground/60 text-[10px]">
                        {group.items.length}
                        {' '}
                        个结果
                      </span>
                    </CommandGroupLabel>
                    <CommandCollection>
                      {(hit: ThreadSearchHit) => (
                        <CommandItem
                          key={hit.sessionId}
                          value={hit}
                          onClick={() => handleSelect(hit)}
                          className="flex-col items-stretch gap-1.5 px-2.5 py-2"
                        >
                          <SessionRow hit={hit} />
                        </CommandItem>
                      )}
                    </CommandCollection>
                  </CommandGroup>
                  <CommandSeparator />
                </Fragment>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <KbdGroup>
                  <Kbd>
                    <ArrowUpIcon />
                  </Kbd>
                  <Kbd>
                    <ArrowDownIcon />
                  </Kbd>
                </KbdGroup>
                <span>选择</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Kbd>
                  <CornerDownLeftIcon />
                </Kbd>
                <span>打开</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Kbd>Esc</Kbd>
                <span>关闭</span>
              </div>
            </div>
            <div className="ms-auto flex items-center gap-1.5">
              {isPending
                ? <Spinner className="size-3" />
                : (
                    <SparklesIcon className="size-3 text-primary/70" aria-hidden="true" />
                  )}
              <span className="font-medium">jieba 智能分词</span>
            </div>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}

// ── Session row ───────────────────────────────────────────────────────────────

function SessionRow({ hit }: { hit: ThreadSearchHit }) {
  const titleRanges = hit.titleRanges ?? []
  const snippets = hit.snippets ?? []

  return (
    <>
      <div className="flex items-center gap-2">
        <MessageSquareIcon
          className="size-3.5 shrink-0 opacity-60"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-sm">
          <HighlightedText text={hit.sessionTitle} ranges={titleRanges} />
        </span>
        <span className="shrink-0 tabular-nums text-[10px] opacity-50">
          {formatRelativeTime(hit.updatedAt)}
        </span>
      </div>

      {snippets.length > 0
        ? (
            <div className="flex flex-col gap-1 pl-5.5">
              {snippets.map(snippet => (
                <SnippetRow key={snippet.messageId} snippet={snippet} />
              ))}
            </div>
          )
        : (
            <div className="pl-5.5 text-[11px] opacity-60">
              仅标题匹配 ·
              {' '}
              <span className="tabular-nums">{hit.matchCount}</span>
              {' '}
              处
            </div>
          )}
    </>
  )
}

function SnippetRow({ snippet }: { snippet: ThreadSearchHit['snippets'][number] }) {
  const isUser = snippet.messageRole === 'user'
  const ranges = snippet.ranges ?? []
  return (
    <div className="flex items-start gap-1.5 text-xs leading-relaxed opacity-80">
      <span
        className={cn(
          'mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm',
          isUser
            ? 'bg-primary/10 text-primary'
            : 'bg-foreground/10 text-foreground/70',
        )}
        title={isUser ? '用户' : '助手'}
        aria-hidden="true"
      >
        {isUser
          ? (
              <UserIcon className="size-2.5" />
            )
          : (
              <SparklesIcon className="size-2.5" />
            )}
      </span>
      <span className="min-w-0 line-clamp-2 wrap-break-word">
        <HighlightedText text={snippet.text} ranges={ranges} />
      </span>
    </div>
  )
}

// ── Empty states ──────────────────────────────────────────────────────────────

function IdleEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 text-center">
      <EmptyMedia variant="icon">
        <SparklesIcon />
      </EmptyMedia>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">输入关键词开始搜索</p>
        <p className="text-xs text-muted-foreground/60">
          支持中文分词，同时搜索标题、用户提问和助手回复
        </p>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
        <span className="text-muted-foreground/50">试试：</span>
        <ExamplePill label="部署错误" />
        <ExamplePill label="北京烤鸭" />
        <ExamplePill label="TypeScript" />
      </div>
    </div>
  )
}

function ExamplePill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground/80">
      {label}
    </span>
  )
}

function LoadingEmpty() {
  return (
    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground/60">
      <Spinner className="size-3" />
      <span className="animate-pulse">搜索中...</span>
    </div>
  )
}

function NoResultsEmpty({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 text-center">
      <EmptyMedia variant="icon">
        <SearchIcon />
      </EmptyMedia>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">没有匹配结果</p>
        <p className="wrap-break-word text-xs text-muted-foreground/60">
          没有会话或消息包含 “
          <strong className="font-medium text-foreground">{query}</strong>
          ”
        </p>
      </div>
    </div>
  )
}
