// Input: CommandDialog/cmdk, useThreadSearch, ipc (kanban.searchIssues, workspace.listFiles), useCradleNavigation, layout store
// Output: GlobalSearchDialog — unified command palette searching threads, files, issues, and commands
// Position: Primary search entry point triggered by ⌘K

import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleDotIcon,
  CornerDownLeftIcon,
  FileIcon,
  MessageSquareIcon,
  SettingsIcon,
  SparklesIcon,
  TerminalIcon,
  UserIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getKanbanIssuesSearch, getSessionsById, getWorkspacesByIdFiles } from '~/api-gen/sdk.gen'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '~/components/ui/command'
import { Kbd, KbdGroup } from '~/components/ui/kbd'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import type { Session, ThreadSearchHit } from '~/lib/types'
import { useLayoutStore } from '~/store/layout'
import { useCradleTabStore } from '~/tabs/registry'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

import { HighlightedText } from './highlighted-text'
import { groupHitsByWorkspace } from './thread-search-groups'
import { useThreadSearch } from './use-thread-search'

interface GlobalSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DEBOUNCE_MS = 150

// ── Commands (static actions) ─────────────────────────────────────────────────

interface CommandAction {
  id: string
  label: string
  keywords: string
  icon: typeof SettingsIcon
  shortcut?: string
  handler: () => void
}

function useCommands(close: () => void): CommandAction[] {
  const { openTab } = useCradleNavigation()
  const { openSettings, toggleSidebar } = useLayoutStore()

  return useMemo(() => [
    {
      id: 'new-chat',
      label: '新建对话',
      keywords: 'new chat session 新建',
      icon: MessageSquareIcon,
      handler: () => {
        close()
        openTab('new-chat', {})
      },
    },
    {
      id: 'open-settings',
      label: '打开设置',
      keywords: 'settings preferences 设置',
      icon: SettingsIcon,
      shortcut: '⌘,',
      handler: () => {
        close()
        openSettings()
      },
    },
    {
      id: 'toggle-sidebar',
      label: '切换侧栏',
      keywords: 'sidebar toggle 侧栏',
      icon: TerminalIcon,
      shortcut: '⌘B',
      handler: () => {
        close()
        toggleSidebar()
      },
    },
    {
      id: 'open-usage',
      label: '用量统计',
      keywords: 'usage cost token 用量 费用',
      icon: CircleDotIcon,
      handler: () => {
        close()
        openTab('usage', {})
      },
    },
  ], [close, openTab, openSettings, toggleSidebar])
}

// ── Issue search hook ─────────────────────────────────────────────────────────

function useIssueSearch(query: string, enabled: boolean) {
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const timer = setTimeout(setDebouncedQuery, DEBOUNCE_MS, query)
    return () => clearTimeout(timer)
  }, [query])

  const trimmed = debouncedQuery.trim()

  const { data = [], isFetching } = useQuery({
    queryKey: ['search-issues', trimmed],
    queryFn: async () => {
      const { data } = await getKanbanIssuesSearch({ query: { q: trimmed, limit: '10' } })
      return (data ?? []) as Array<{ id: string, title: string, priority: string, workspaceId?: string }>
    },
    enabled: enabled && !!trimmed,
    staleTime: 5_000,
  })

  return {
    issues: data,
    isPending: enabled && trimmed.length > 0 && (isFetching || debouncedQuery !== query),
  }
}

// ── File search hook (client-side filter on cached file lists) ─────────────────

function useFileSearch(query: string, enabled: boolean) {
  // Get current workspace from active tab
  const activeTab = useCradleTabStore((s) => {
    const t = s.tabs.find(tab => tab.id === s.activeTabId)
    return t?.type === 'chat' ? t.params : null
  })

  // Load sessions to get workspaceId
  const { data: session } = useQuery({
    queryKey: ['chat-session', activeTab?.sessionId],
    queryFn: async () => {
      const { data } = await getSessionsById({ path: { id: activeTab!.sessionId! } })
      return data as Session | undefined
    },
    enabled: !!activeTab?.sessionId,
    staleTime: 60_000,
  })

  const workspaceId = session?.workspaceId ?? null

  const { data: files = [] } = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesByIdFiles({ path: { id: workspaceId! } })
      return (data ?? []) as Array<{ type: 'file' | 'directory', name: string, path: string }>
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  })

  const trimmed = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!enabled || !trimmed || files.length === 0) {
      return []
    }
    return files
      .filter(f => f.type === 'file' && f.path.toLowerCase().includes(trimmed))
      .slice(0, 10)
  }, [enabled, trimmed, files])

  return { files: filtered, workspaceId }
}

// ── Main component ────────────────────────────────────────────────────────────

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const { openTab } = useCradleNavigation()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) {
      setQuery('')
    }
  }, [open])

  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const commands = useCommands(close)
  const trimmed = query.trim()
  const hasQuery = trimmed.length > 0

  // Search sources
  const { hits: threadHits, isPending: threadsPending } = useThreadSearch({ query, enabled: open })
  const { issues, isPending: issuesPending } = useIssueSearch(query, open)
  const { files } = useFileSearch(query, open)

  const threadGroups = useMemo(() => groupHitsByWorkspace(threadHits), [threadHits])

  // Filter commands by query
  const filteredCommands = useMemo(() => {
    if (!hasQuery) {
      return commands
    }
    const q = trimmed.toLowerCase()
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q))
  }, [commands, hasQuery, trimmed])

  const isPending = threadsPending || issuesPending
  const hasResults = threadHits.length > 0 || issues.length > 0 || files.length > 0 || filteredCommands.length > 0

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="max-w-2xl">
      <Command shouldFilter={false} data-testid="global-search-dialog">
        <div className="overflow-hidden rounded-xl!">
          <CommandInput
            placeholder="搜索对话、文件、Issue、命令..."
            value={query}
            onValueChange={setQuery}
            aria-label="全局搜索"
            data-testid="global-search-input"
          />
          <div>
            <CommandEmpty className="not-empty:py-12">
              {hasQuery
                ? isPending
                  ? <LoadingState />
                  : <NoResults />
                : <IdleState />}
            </CommandEmpty>
            <CommandList>
              {/* Commands (always show when idle or matching) */}
              {filteredCommands.length > 0 && !hasQuery && (
                <>
                  <CommandGroup>
                    <GroupHeader label="命令" count={filteredCommands.length} />
                    {filteredCommands.map(cmd => (
                      <CommandItem
                        key={cmd.id}
                        value={cmd.id}
                        onSelect={cmd.handler}
                        className="flex items-center gap-2.5 px-2.5 py-1.5"
                      >
                        <cmd.icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 text-sm">{cmd.label}</span>
                        {cmd.shortcut && (
                          <span className="text-[10px] text-muted-foreground">{cmd.shortcut}</span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {hasResults && <CommandSeparator />}
                </>
              )}

              {/* Commands matching query */}
              {filteredCommands.length > 0 && hasQuery && (
                <>
                  <CommandGroup>
                    <GroupHeader label="命令" count={filteredCommands.length} />
                    {filteredCommands.map(cmd => (
                      <CommandItem
                        key={cmd.id}
                        value={cmd.id}
                        onSelect={cmd.handler}
                        className="flex items-center gap-2.5 px-2.5 py-1.5"
                      >
                        <cmd.icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 text-sm">{cmd.label}</span>
                        {cmd.shortcut && (
                          <span className="text-[10px] text-muted-foreground">{cmd.shortcut}</span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {(threadHits.length > 0 || issues.length > 0 || files.length > 0) && <CommandSeparator />}
                </>
              )}

              {/* Thread results */}
              {threadHits.length > 0 && (
                <>
                  <CommandGroup>
                    <GroupHeader label="对话" count={threadHits.length} />
                    {threadGroups.map(group =>
                      group.items.slice(0, 5).map((hit: ThreadSearchHit) => (
                        <CommandItem
                          key={hit.sessionId}
                          value={`thread-${hit.sessionId}`}
                          onSelect={() => {
                            close()
                            openTab('chat', { sessionId: hit.sessionId })
                          }}
                          className="flex-col items-stretch gap-1.5 px-2.5 py-2"
                          data-testid={`global-search-thread-result-${hit.sessionId}`}
                        >
                          <ThreadSearchResultRow hit={hit} workspaceLabel={group.label} />
                        </CommandItem>
                      )))}
                  </CommandGroup>
                  {(issues.length > 0 || files.length > 0) && <CommandSeparator />}
                </>
              )}

              {/* Issue results */}
              {issues.length > 0 && (
                <>
                  <CommandGroup>
                    <GroupHeader label="Issue" count={issues.length} />
                    {issues.slice(0, 8).map(issue => (
                      <CommandItem
                        key={issue.id}
                        value={`issue-${issue.id}`}
                        onSelect={() => {
                          close()
                          openTab('kanban-board', { workspaceId: issue.workspaceId })
                        }}
                        className="flex items-center gap-2.5 px-2.5 py-1.5"
                      >
                        <CircleDotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
                        <PriorityBadge priority={issue.priority} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {files.length > 0 && <CommandSeparator />}
                </>
              )}

              {/* File results */}
              {files.length > 0 && (
                <CommandGroup>
                  <GroupHeader label="文件" count={files.length} />
                  {files.map(file => (
                    <CommandItem
                      key={file.path}
                      value={`file-${file.path}`}
                      onSelect={close}
                      className="flex items-center gap-2.5 px-2.5 py-1.5"
                    >
                      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border/30 px-3 py-2 text-muted-foreground text-xs">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <KbdGroup>
                  <Kbd><ArrowUpIcon /></Kbd>
                  <Kbd><ArrowDownIcon /></Kbd>
                </KbdGroup>
                <span>选择</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Kbd><CornerDownLeftIcon /></Kbd>
                <span>打开</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Kbd>Esc</Kbd>
                <span>关闭</span>
              </div>
            </div>
            {isPending && <Spinner className="size-3" />}
          </div>
        </div>
      </Command>
    </CommandDialog>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function GroupHeader({ label, count }: { label: string, count: number }) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
      <span className="font-medium">{label}</span>
      <span className="text-[10px] text-muted-foreground">
        {count}
        {' 个结果'}
      </span>
    </div>
  )
}

function ThreadSearchResultRow({
  hit,
  workspaceLabel,
}: {
  hit: ThreadSearchHit
  workspaceLabel: string
}) {
  const snippets = hit.snippets ?? []

  return (
    <>
      <div className="flex items-center gap-2.5">
        <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 flex-1 truncate text-sm"
          data-testid={`global-search-thread-title-${hit.sessionId}`}
        >
          <HighlightedText text={hit.sessionTitle} ranges={hit.titleRanges ?? []} />
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {workspaceLabel}
        </span>
      </div>

      {snippets.length > 0
        ? (
          <div className="flex flex-col gap-1 pl-6">
            {snippets.slice(0, 2).map(snippet => (
              <ThreadSearchSnippetRow key={snippet.messageId} snippet={snippet} />
            ))}
          </div>
        )
        : (
          <div className="pl-6 text-[11px] text-muted-foreground">
            仅标题匹配
          </div>
        )}
    </>
  )
}

function ThreadSearchSnippetRow({ snippet }: { snippet: ThreadSearchHit['snippets'][number] }) {
  const isUser = snippet.messageRole === 'user'

  return (
    <div
      className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
      data-testid={`global-search-thread-snippet-${snippet.messageId}`}
    >
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
          ? <UserIcon className="size-2.5" />
          : <SparklesIcon className="size-2.5" />}
      </span>
      <span className="min-w-0 line-clamp-2 wrap-break-word">
        <HighlightedText text={snippet.text} ranges={snippet.ranges ?? []} />
      </span>
    </div>
  )
}

const PRIORITY_CLASSES: Record<string, string> = {
  urgent: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-yellow-600',
  low: 'text-muted-foreground',
  none: 'text-muted-foreground',
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn('text-[10px] shrink-0', PRIORITY_CLASSES[priority] ?? PRIORITY_CLASSES.none)}>
      {priority === 'none' ? '' : priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center gap-2">
      <Spinner className="size-4" />
      <span className="text-xs text-muted-foreground">搜索中...</span>
    </div>
  )
}

function NoResults() {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs text-muted-foreground">没有找到匹配的结果</span>
    </div>
  )
}

function IdleState() {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs text-muted-foreground">输入关键词开始搜索</span>
    </div>
  )
}
