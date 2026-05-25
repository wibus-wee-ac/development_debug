import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrainIcon,
  CircleDotIcon,
  CornerDownLeftIcon,
  FileIcon,
  MessageSquareIcon,
  SettingsIcon,
  SparklesIcon,
  TerminalIcon,
  UserIcon
} from 'lucide-react'
import { memo, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getIssuesSearch, getKanbanBoards, getWorkspacesByIdFiles } from '~/api-gen/sdk.gen'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '~/components/ui/command'
import { Kbd, KbdGroup } from '~/components/ui/kbd'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import { cn } from '~/lib/cn'
import type { ChronicleSearchHit, ThreadSearchHit } from '~/lib/types'
import { useLayoutStore } from '~/store/layout'
import { useCradleTabStore } from '~/tabs/registry'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'
import { selectFileSearchResult } from './global-search-actions'
import { HighlightedText } from './highlighted-text'
import { groupHitsByWorkspace } from './thread-search-groups'
import { useChronicleSearch } from './use-chronicle-search'
import { useThreadSearch } from './use-thread-search'

interface GlobalSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SearchTranslation = TFunction<'search'>

const DEBOUNCE_MS = 150
const SessionWorkspaceSchema = z
  .object({
    workspaceId: z.string().nullable()
  })
  .passthrough()

// ── Commands (static actions) ─────────────────────────────────────────────────

interface CommandAction {
  id: string
  label: string
  keywords: string
  icon: typeof SettingsIcon
  shortcut?: string
  handler: () => void
}

interface GlobalSearchIssue {
  id: string
  title: string
  priority: string
  workspaceId?: string
}

interface GlobalSearchBoard {
  id: string
  workspaceId: string
}

interface GlobalSearchFile {
  type: 'file' | 'directory'
  name: string
  path: string
}

const GlobalSearchIssueListSchema = z
  .array(
    z.object({
      id: z.string(),
      title: z.string(),
      priority: z.string(),
      workspaceId: z.string().optional()
    })
  )
  .default([])

const GlobalSearchFileListSchema = z
  .array(
    z.object({
      type: z.enum(['file', 'directory']),
      name: z.string(),
      path: z.string()
    })
  )
  .default([])

const GlobalSearchBoardListSchema = z
  .array(
    z.object({
      id: z.string(),
      workspaceId: z.string()
    })
  )
  .default([])

function useCommands(close: () => void): CommandAction[] {
  const { t } = useTranslation('search')
  const { openTab } = useCradleNavigation()
  const openSettings = useSettingsOverlayStore((s) => s.openSettings)
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar)

  return useMemo(
    () => [
      {
        id: 'new-chat',
        label: t('command.newChat.label'),
        keywords: t('command.newChat.keywords'),
        icon: MessageSquareIcon,
        handler: () => {
          close()
          openTab('new-chat', {})
        }
      },
      {
        id: 'open-settings',
        label: t('command.openSettings.label'),
        keywords: t('command.openSettings.keywords'),
        icon: SettingsIcon,
        shortcut: '⌘,',
        handler: () => {
          close()
          const activeTabId = useCradleTabStore.getState().activeTabId
          if (activeTabId) {
            openSettings(activeTabId)
          }
        }
      },
      {
        id: 'toggle-sidebar',
        label: t('command.toggleSidebar.label'),
        keywords: t('command.toggleSidebar.keywords'),
        icon: TerminalIcon,
        shortcut: '⌘B',
        handler: () => {
          close()
          toggleSidebar()
        }
      },
      {
        id: 'open-usage',
        label: t('command.openUsage.label'),
        keywords: t('command.openUsage.keywords'),
        icon: CircleDotIcon,
        handler: () => {
          close()
          openTab('usage', {})
        }
      }
    ],
    [close, openTab, openSettings, t, toggleSidebar]
  )
}

// ── Issue search hook ─────────────────────────────────────────────────────────

function useIssueSearch(query: string, enabled: boolean) {
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const timer = setTimeout(setDebouncedQuery, DEBOUNCE_MS, query)
    return () => clearTimeout(timer)
  }, [query])

  const currentTrimmed = query.trim()
  const trimmed = debouncedQuery.trim()

  const { data = [], isFetching } = useQuery({
    queryKey: ['search-issues', trimmed],
    queryFn: async () => {
      const { data } = await getIssuesSearch({ query: { q: trimmed, limit: '10' } })
      return GlobalSearchIssueListSchema.parse(data) satisfies GlobalSearchIssue[]
    },
    enabled: enabled && !!trimmed,
    staleTime: 5_000
  })

  return {
    issues: data,
    isPending: enabled && currentTrimmed.length > 0 && (isFetching || debouncedQuery !== query)
  }
}

// ── File search hook (client-side filter on cached file lists) ─────────────────

function useFileSearch(query: string, enabled: boolean) {
  // Get current workspace from active tab
  const activeTab = useCradleTabStore((s) => {
    const t = s.tabs.find((tab) => tab.id === s.activeTabId)
    return t?.type === 'chat' ? t.params : null
  })

  // Load sessions to get workspaceId
  const { data: session } = useQuery({
    ...getSessionsByIdOptions({ path: { id: activeTab?.sessionId ?? '' } }),
    enabled: !!activeTab?.sessionId,
    staleTime: 60_000,
    select: (data) => (data ? SessionWorkspaceSchema.parse(data) : undefined)
  })

  const workspaceId = session?.workspaceId ?? null

  const { data: files = [], isFetching } = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesByIdFiles({ path: { id: workspaceId! } })
      return GlobalSearchFileListSchema.parse(data) satisfies GlobalSearchFile[]
    },
    enabled: !!workspaceId,
    staleTime: 30_000
  })

  const trimmed = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!enabled || !trimmed || files.length === 0) {
      return []
    }
    return files
      .filter((f) => f.type === 'file' && f.path.toLowerCase().includes(trimmed))
      .slice(0, 10)
  }, [enabled, trimmed, files])

  return {
    files: filtered,
    workspaceId,
    isPending: enabled && !!trimmed && !!workspaceId && isFetching
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const { t } = useTranslation('search')
  const { openTab } = useCradleNavigation()
  const openSettings = useSettingsOverlayStore((s) => s.openSettings)
  const setSettingsSection = useSettingsOverlayStore((s) => s.setSettingsSection)
  const setChronicleFocusTarget = useSettingsOverlayStore((s) => s.setChronicleFocusTarget)
  const [query, setQuery] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const requestedQueryRef = useRef('')
  const measuredQueryRef = useRef('')
  const closeFromEscape = useEffectEvent(() => {
    onOpenChange(false)
  })

  useLayoutEffect(() => {
    if (!open) {
      setQuery('')
      requestedQueryRef.current = ''
      measuredQueryRef.current = ''
      return
    }

    panelRef.current?.querySelector<HTMLInputElement>('[data-slot="command-input"]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeFromEscape()
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const handleQueryChange = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery)

      const nextTrimmed = nextQuery.trim()
      if (!open || !nextTrimmed) {
        requestedQueryRef.current = ''
        measuredQueryRef.current = ''
        return
      }

      requestedQueryRef.current = nextTrimmed
      measuredQueryRef.current = ''
    },
    [open]
  )
  const commands = useCommands(close)
  const trimmed = query.trim()
  const hasQuery = trimmed.length > 0

  // Search sources
  const { hits: threadHits, isPending: threadsPending } = useThreadSearch({ query, enabled: open })
  const { hits: chronicleHits, isPending: chroniclePending } = useChronicleSearch({ query, enabled: open })
  const { issues, isPending: issuesPending } = useIssueSearch(query, open)
  const {
    files,
    workspaceId: fileWorkspaceId,
    isPending: filesPending
  } = useFileSearch(query, open)

  const threadGroups = useMemo(() => groupHitsByWorkspace(threadHits), [threadHits])

  // Filter commands by query
  const filteredCommands = useMemo(() => {
    if (!hasQuery) {
      return commands
    }
    const q = trimmed.toLowerCase()
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q)
    )
  }, [commands, hasQuery, trimmed])

  const isPending = threadsPending || chroniclePending || issuesPending || filesPending
  const hasResults =
    threadHits.length > 0
    || chronicleHits.length > 0
    || issues.length > 0
    || files.length > 0
    || filteredCommands.length > 0

  useEffect(() => {
    if (
      !open ||
      !hasQuery ||
      isPending ||
      requestedQueryRef.current !== trimmed ||
      measuredQueryRef.current === trimmed
    ) {
      return
    }

    const measuredQuery = trimmed
    requestAnimationFrame(() => {
      if (requestedQueryRef.current !== measuredQuery) {
        return
      }

      measuredQueryRef.current = measuredQuery
    })
  }, [hasQuery, isPending, open, trimmed])

  const handleSelectFile = useCallback(
    (filePath: string) => {
      if (!fileWorkspaceId) {
        return
      }

      void selectFileSearchResult({
        workspaceId: fileWorkspaceId,
        filePath,
        openTab,
        close,
        writeText: navigator.clipboard?.writeText?.bind(navigator.clipboard),
        notify: (notification) => toastManager.add(notification)
      })
    },
    [close, fileWorkspaceId, openTab]
  )

  const handleSelectThread = useCallback(
    (sessionId: string) => {
      close()
      openTab('chat', { sessionId })
    },
    [close, openTab]
  )

  const handleSelectChronicle = useCallback((hit: ChronicleSearchHit) => {
    const tabStore = useCradleTabStore.getState()
    const activeTabId = tabStore.activeTabId && tabStore.tabs.some(tab => tab.id === tabStore.activeTabId)
      ? tabStore.activeTabId
      : (() => {
          return tabStore.openTab('home', {}, { pinned: true })
        })()
    close()
    tabStore.setActiveTab(activeTabId)
    setSettingsSection('chronicle')
    setChronicleFocusTarget({ type: hit.type, id: hit.id })
    openSettings(activeTabId)
  }, [close, openSettings, setChronicleFocusTarget, setSettingsSection])

  const handleSelectIssue = useCallback(
    (issue: GlobalSearchIssue) => {
      close()
      void (async () => {
        let boards: GlobalSearchBoard[] = []
        try {
          if (issue.workspaceId) {
            const { data } = await getKanbanBoards({ query: { workspaceId: issue.workspaceId } })
            boards = GlobalSearchBoardListSchema.parse(data) satisfies GlobalSearchBoard[]
          }
        }
        catch (error) {
          console.error('[GlobalSearchDialog] failed to resolve issue board:', error)
        }

        const boardId = boards[0]?.id
        openTab('kanban-board', boardId ? { boardId, issue: issue.id } : {})
      })()
    },
    [close, openTab]
  )

  return createPortal(
    <div
      role="presentation"
      className={cn(
        'fixed inset-0 isolate z-50 flex items-start justify-center bg-black/10 px-4 pt-[18vh] supports-backdrop-filter:backdrop-blur-xs',
        open ? 'visible pointer-events-auto opacity-100' : 'invisible pointer-events-none opacity-0'
      )}
      aria-hidden={open ? undefined : 'true'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false)
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('aria.dialog')}
        className="w-full max-w-2xl overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-[0_20px_80px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.08)] ring-1 ring-foreground/10 dark:shadow-[0_20px_80px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.1)]"
      >
        <Command shouldFilter={false} data-testid="global-search-dialog">
          <div className="overflow-hidden rounded-xl!">
            <CommandInput
              placeholder={t('placeholder')}
              value={query}
              onValueChange={handleQueryChange}
              aria-label={t('aria.input')}
              data-testid="global-search-input"
            />
            <div>
              <CommandEmpty className="not-empty:py-12">
                {hasQuery ? isPending ? <LoadingState /> : <NoResults /> : <IdleState />}
              </CommandEmpty>
              <CommandList>
                {/* Commands (always show when idle or matching) */}
                {filteredCommands.length > 0 && !hasQuery && (
                  <>
                    <CommandGroup>
                      <GroupHeader label={t('group.commands')} count={filteredCommands.length} />
                      {filteredCommands.map((cmd) => (
                        <CommandActionRow key={cmd.id} command={cmd} />
                      ))}
                    </CommandGroup>
                    {hasResults && <CommandSeparator />}
                  </>
                )}

                {/* Commands matching query */}
                {filteredCommands.length > 0 && hasQuery && (
                  <>
                    <CommandGroup>
                      <GroupHeader label={t('group.commands')} count={filteredCommands.length} />
                      {filteredCommands.map((cmd) => (
                        <CommandActionRow key={cmd.id} command={cmd} />
                      ))}
                    </CommandGroup>
                    {(threadHits.length > 0 || chronicleHits.length > 0 || issues.length > 0 || files.length > 0) && (
                      <CommandSeparator />
                    )}
                  </>
                )}

                {/* Thread results */}
                {threadHits.length > 0 && (
                  <>
                    <CommandGroup>
                      <GroupHeader label={t('group.threads')} count={threadHits.length} />
                      {threadGroups.map((group) =>
                        group.items
                          .slice(0, 5)
                          .map((hit: ThreadSearchHit) => (
                            <ThreadSearchCommandRow
                              key={hit.sessionId}
                              hit={hit}
                              workspaceLabel={group.label}
                              onSelect={handleSelectThread}
                            />
                          ))
                      )}
                    </CommandGroup>
                    {(chronicleHits.length > 0 || issues.length > 0 || files.length > 0) && <CommandSeparator />}
                  </>
                )}

                {/* Chronicle results */}
                {chronicleHits.length > 0 && (
                  <>
                    <CommandGroup>
                      <GroupHeader label={t('group.chronicle')} count={chronicleHits.length} />
                      {chronicleHits.slice(0, 8).map((hit) => (
                        <ChronicleSearchCommandRow
                          key={`${hit.type}-${hit.id}`}
                          hit={hit}
                          onSelect={handleSelectChronicle}
                        />
                      ))}
                    </CommandGroup>
                    {(issues.length > 0 || files.length > 0) && <CommandSeparator />}
                  </>
                )}

                {/* Issue results */}
                {issues.length > 0 && (
                  <>
                    <CommandGroup>
                      <GroupHeader label={t('group.issues')} count={issues.length} />
                      {issues.slice(0, 8).map((issue) => (
                        <IssueSearchCommandRow
                          key={issue.id}
                          issue={issue}
                          onSelect={handleSelectIssue}
                        />
                      ))}
                    </CommandGroup>
                    {files.length > 0 && <CommandSeparator />}
                  </>
                )}

                {/* File results */}
                {files.length > 0 && (
                  <CommandGroup>
                    <GroupHeader label={t('group.files')} count={files.length} />
                    {files.map((file) => (
                      <FileSearchCommandRow
                        key={file.path}
                        file={file}
                        onSelect={handleSelectFile}
                      />
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-muted-foreground text-xs">
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
                  <span>{t('footer.select')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Kbd>
                    <CornerDownLeftIcon />
                  </Kbd>
                  <span>{t('footer.open')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Kbd>Esc</Kbd>
                  <span>{t('footer.close')}</span>
                </div>
              </div>
              {isPending && <Spinner className="size-3" />}
            </div>
          </div>
        </Command>
      </div>
    </div>,
    document.body
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

const CommandActionRow = memo(function CommandActionRow({ command }: { command: CommandAction }) {
  return (
    <CommandItem
      value={command.id}
      onSelect={command.handler}
      className="flex items-center gap-2.5 px-2.5 py-1.5"
      data-testid={`global-search-command-${command.id}`}
    >
      <command.icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm">{command.label}</span>
      {command.shortcut && (
        <span className="text-[10px] text-muted-foreground">{command.shortcut}</span>
      )}
    </CommandItem>
  )
})

const ThreadSearchCommandRow = memo(function ThreadSearchCommandRow({
  hit,
  workspaceLabel,
  onSelect
}: {
  hit: ThreadSearchHit
  workspaceLabel: string
  onSelect: (sessionId: string) => void
}) {
  const selectThread = useCallback(() => {
    onSelect(hit.sessionId)
  }, [hit.sessionId, onSelect])

  return (
    <CommandItem
      value={`thread-${hit.sessionId}`}
      onSelect={selectThread}
      className="flex-col items-stretch gap-1.5 px-2.5 py-2"
      data-testid={`global-search-thread-result-${hit.sessionId}`}
    >
      <ThreadSearchResultRow hit={hit} workspaceLabel={workspaceLabel} />
    </CommandItem>
  )
})

const ChronicleSearchCommandRow = memo(function ChronicleSearchCommandRow({
  hit,
  onSelect
}: {
  hit: ChronicleSearchHit
  onSelect: (hit: ChronicleSearchHit) => void
}) {
  const selectChronicleHit = useCallback(() => {
    onSelect(hit)
  }, [hit, onSelect])

  return (
    <CommandItem
      value={`chronicle-${hit.type}-${hit.id}`}
      onSelect={selectChronicleHit}
      className="flex-col items-stretch gap-1.5 px-2.5 py-2"
      data-testid={`global-search-chronicle-result-${hit.id}`}
    >
      <ChronicleSearchResultRow hit={hit} />
    </CommandItem>
  )
})

const IssueSearchCommandRow = memo(function IssueSearchCommandRow({
  issue,
  onSelect
}: {
  issue: GlobalSearchIssue
  onSelect: (issue: GlobalSearchIssue) => void
}) {
  const selectIssue = useCallback(() => {
    onSelect(issue)
  }, [issue, onSelect])

  return (
    <CommandItem
      value={`issue-${issue.id}`}
      onSelect={selectIssue}
      className="flex items-center gap-2.5 px-2.5 py-1.5"
      data-testid={`global-search-issue-result-${issue.id}`}
    >
      <CircleDotIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
      <PriorityBadge priority={issue.priority} />
    </CommandItem>
  )
})

const FileSearchCommandRow = memo(function FileSearchCommandRow({
  file,
  onSelect
}: {
  file: GlobalSearchFile
  onSelect: (filePath: string) => void
}) {
  const selectFile = useCallback(() => {
    onSelect(file.path)
  }, [file.path, onSelect])

  return (
    <CommandItem
      value={`file-${file.path}`}
      onSelect={selectFile}
      className="flex items-center gap-2.5 px-2.5 py-1.5"
      data-testid={`global-search-file-result-${file.path}`}
    >
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
    </CommandItem>
  )
})

function GroupHeader({ label, count }: { label: string; count: number }) {
  const { t } = useTranslation('search')

  return (
    <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
      <span className="font-medium">{label}</span>
      <span className="text-[10px] text-muted-foreground">
        {t('group.resultCount', { count })}
      </span>
    </div>
  )
}

function ThreadSearchResultRow({
  hit,
  workspaceLabel
}: {
  hit: ThreadSearchHit
  workspaceLabel: string
}) {
  const { t } = useTranslation('search')
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
        <span className="shrink-0 text-[10px] text-muted-foreground">{workspaceLabel}</span>
      </div>

      {snippets.length > 0 ? (
        <div className="flex flex-col gap-1 pl-6">
          {snippets.slice(0, 2).map((snippet) => (
            <ThreadSearchSnippetRow key={snippet.messageId} snippet={snippet} />
          ))}
        </div>
      ) : (
        <div className="pl-6 text-[11px] text-muted-foreground">{t('thread.match.titleOnly')}</div>
      )}
    </>
  )
}

function ThreadSearchSnippetRow({ snippet }: { snippet: ThreadSearchHit['snippets'][number] }) {
  const { t } = useTranslation('search')
  const isUser = snippet.messageRole === 'user'

  return (
    <div
      className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
      data-testid={`global-search-thread-snippet-${snippet.messageId}`}
    >
      <span
        className={cn(
          'mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm',
          isUser ? 'bg-primary/10 text-primary' : 'bg-foreground/10 text-foreground/70'
        )}
        title={isUser ? t('thread.role.user') : t('thread.role.assistant')}
        aria-hidden="true"
      >
        {isUser ? <UserIcon className="size-2.5" /> : <SparklesIcon className="size-2.5" />}
      </span>
      <span className="min-w-0 line-clamp-2 wrap-break-word">
        <HighlightedText text={snippet.text} ranges={snippet.ranges ?? []} />
      </span>
    </div>
  )
}

function ChronicleSearchResultRow({ hit }: { hit: ChronicleSearchHit }) {
  const { t } = useTranslation('search')
  const workspaceLabel = hit.workspaceName ?? t('workspace.none')
  const typeLabel = hit.type === 'memory' ? formatMemorySearchType(hit, t) : formatKnowledgeSearchType(hit, t)

  return (
    <>
      <div className="flex items-center gap-2.5">
        <BrainIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 flex-1 truncate text-sm"
          data-testid={`global-search-chronicle-title-${hit.id}`}
        >
          <HighlightedText text={hit.title} ranges={hit.titleRanges ?? []} />
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{workspaceLabel}</span>
      </div>
      <div className="flex items-start gap-2 pl-6 text-xs leading-relaxed text-muted-foreground">
        <span className="mt-0.5 shrink-0 rounded-sm bg-foreground/8 px-1.5 py-0.5 text-[10px] text-foreground/70">
          {typeLabel}
        </span>
        <span className="min-w-0 line-clamp-2 wrap-break-word">
          <HighlightedText text={hit.snippet.text} ranges={hit.snippet.ranges ?? []} />
        </span>
      </div>
    </>
  )
}

function formatMemorySearchType(hit: ChronicleSearchHit, t: SearchTranslation): string {
  if (hit.memorySource === 'imported') {
    return t('type.imported')
  }
  return hit.memoryType === '6h' ? t('type.memory.sixHour') : t('type.memory')
}

function formatKnowledgeSearchType(hit: ChronicleSearchHit, t: SearchTranslation): string {
  switch (hit.cardType) {
    case 'decision':
      return t('type.knowledge.decision')
    case 'insight':
      return t('type.knowledge.insight')
    case 'task':
      return t('type.knowledge.task')
    case 'pattern':
      return t('type.knowledge.pattern')
    default:
      return t('type.knowledge')
  }
}

const PRIORITY_CLASSES: Record<string, string> = {
  urgent: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-yellow-600',
  low: 'text-muted-foreground',
  none: 'text-muted-foreground'
}

function PriorityBadge({ priority }: { priority: string }) {
  const { t } = useTranslation('search')
  const priorityLabel = {
    urgent: t('priority.urgent'),
    high: t('priority.high'),
    medium: t('priority.medium'),
    low: t('priority.low'),
  }[priority]

  return (
    <span
      className={cn('text-[10px] shrink-0', PRIORITY_CLASSES[priority] ?? PRIORITY_CLASSES.none)}
    >
      {priorityLabel ?? ''}
    </span>
  )
}

function LoadingState() {
  const { t } = useTranslation('search')

  return (
    <div className="flex flex-col items-center gap-2">
      <Spinner className="size-4" />
      <span className="text-xs text-muted-foreground">{t('state.loading')}</span>
    </div>
  )
}

function NoResults() {
  const { t } = useTranslation('search')

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs text-muted-foreground">{t('state.noResults')}</span>
    </div>
  )
}

function IdleState() {
  const { t } = useTranslation('search')

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs text-muted-foreground">{t('state.idle')}</span>
    </div>
  )
}
