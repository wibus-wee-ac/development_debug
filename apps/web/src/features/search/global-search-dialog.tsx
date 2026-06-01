import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleDotIcon,
  CornerDownLeftIcon,
  FileIcon,
  MessageSquareIcon,
  PuzzleIcon,
  SettingsIcon,
  TerminalIcon,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { memo, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { useShallow } from 'zustand/react/shallow'

import { getIssuesSearchOptions, getKanbanBoardsOptions, getSearchThreadsOptions, getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { useLayoutSlotsCtx } from '~/components/layout/use-layout-slots'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '~/components/ui/command'
import { Kbd, KbdGroup } from '~/components/ui/kbd'
import { DelayedSpinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
import { useWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { cn } from '~/lib/cn'
import type { WebCommandRegistration } from '~/lib/plugin-store'
import { usePluginStore } from '~/lib/plugin-store'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'
import { useCradleTabStore } from '~/tabs/registry'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

import { selectFileSearchResult } from './global-search-actions'

interface GlobalSearchDialogProps {
  open: boolean
  initialQuery?: string
  onOpenChange: (open: boolean) => void
}

type SearchMessageKey = keyof typeof import('~/locales/default/search').default
type PaletteModeId = 'command' | 'quickOpen' | 'symbol' | 'line' | 'workspaceSymbol'
type FileSearchAvailability = 'available' | 'unsupported-tab' | 'missing-workspace'

interface PaletteMode {
  id: PaletteModeId
  prefix: string
  labelKey: SearchMessageKey
  descriptionKey: SearchMessageKey
  placeholderKey: SearchMessageKey
  query: string
}

const COMMAND_HISTORY_KEY = 'cradle.commandPalette.recentCommands'
const COMMAND_HISTORY_LIMIT = 12
const PALETTE_MODES = [
  {
    id: 'command',
    prefix: '>',
    labelKey: 'mode.command.label',
    descriptionKey: 'mode.command.description',
    placeholderKey: 'mode.command.placeholder',
  },
  {
    id: 'quickOpen',
    prefix: '',
    labelKey: 'mode.quickOpen.label',
    descriptionKey: 'mode.quickOpen.description',
    placeholderKey: 'mode.quickOpen.placeholder',
  },
  {
    id: 'symbol',
    prefix: '@',
    labelKey: 'mode.symbol.label',
    descriptionKey: 'mode.symbol.description',
    placeholderKey: 'mode.symbol.placeholder',
  },
  {
    id: 'line',
    prefix: ':',
    labelKey: 'mode.line.label',
    descriptionKey: 'mode.line.description',
    placeholderKey: 'mode.line.placeholder',
  },
  {
    id: 'workspaceSymbol',
    prefix: '#',
    labelKey: 'mode.workspaceSymbol.label',
    descriptionKey: 'mode.workspaceSymbol.description',
    placeholderKey: 'mode.workspaceSymbol.placeholder',
  },
] as const
const SessionWorkspaceSchema = z
  .object({
    workspaceId: z.string().nullable(),
  })
  .passthrough()
// ── Commands (static actions) ─────────────────────────────────────────────────

interface CommandAction {
  id: string
  label: string
  description?: string
  keywords: string
  icon: ComponentType<{ className?: string }>
  shortcut?: string
  source: 'app' | 'plugin'
  handler: () => void | Promise<void>
}

function parsePaletteInput(input: string): PaletteMode {
  const prefixedMode = PALETTE_MODES.find(mode => mode.prefix && input.startsWith(mode.prefix))
  const mode = prefixedMode ?? PALETTE_MODES[1]
  const query = prefixedMode ? input.slice(mode.prefix.length).trimStart() : input.trim()

  return { ...mode, query }
}

function scoreFuzzyMatch(source: string, query: string): number | null {
  const normalizedSource = source.toLowerCase()
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return 0
  }

  if (normalizedSource.includes(normalizedQuery)) {
    return normalizedSource.indexOf(normalizedQuery)
  }

  let score = 0
  let sourceIndex = 0
  for (const char of normalizedQuery) {
    const nextIndex = normalizedSource.indexOf(char, sourceIndex)
    if (nextIndex === -1) {
      return null
    }
    score += nextIndex - sourceIndex + 1
    sourceIndex = nextIndex + 1
  }

  return score + normalizedSource.length
}

function readCommandHistory(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMMAND_HISTORY_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  }
  catch {
    return []
  }
}

function writeCommandHistory(commandId: string): string[] {
  const nextHistory = [commandId, ...readCommandHistory().filter(id => id !== commandId)].slice(0, COMMAND_HISTORY_LIMIT)
  try {
    window.localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(nextHistory))
  }
  catch {
    return nextHistory
  }
  return nextHistory
}

function normalizeCommandKeywords(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.join(' ')
  }
  return value ?? ''
}

function getPluginCommandIcon(command: WebCommandRegistration): ComponentType<{ className?: string }> {
  return typeof command.icon === 'function' ? command.icon : PuzzleIcon
}

function useActiveFileSearchWorkspaceId(enabled: boolean): {
  availability: FileSearchAvailability
  workspaceId: string | null
} {
  const { slots } = useLayoutSlotsCtx()
  const activeTab = useCradleTabStore(useShallow((s) => {
    if (!enabled) {
      return null
    }
    const tab = s.tabs.find(item => item.id === s.activeTabId)
    return tab
      ? {
        type: tab.type,
        params: tab.params,
      }
      : null
  }))
  const chatSessionId = enabled && activeTab?.type === 'chat' ? activeTab.params.sessionId : null

  const { data: chatSession } = useQuery({
    ...getSessionsByIdOptions({ path: { id: chatSessionId ?? '' } }),
    enabled: enabled && !!chatSessionId,
    staleTime: 60_000,
    select: data => (data ? SessionWorkspaceSchema.parse(data) : undefined),
  })

  if (!enabled) {
    return { availability: 'unsupported-tab', workspaceId: null }
  }

  const canSearchFiles = activeTab?.type === 'new-chat'
    || activeTab?.type === 'chat'
    || activeTab?.type === 'workspace-detail'

  if (!canSearchFiles) {
    return { availability: 'unsupported-tab', workspaceId: null }
  }

  const workspaceId = activeTab?.type === 'workspace-detail'
    ? activeTab.params.workspaceId ?? null
    : activeTab?.type === 'chat'
      ? chatSession?.workspaceId ?? null
      : slots.asideWorkspaceId ?? null

  return {
    availability: workspaceId ? 'available' : 'missing-workspace',
    workspaceId,
  }
}

interface GlobalSearchFile {
  type: 'file' | 'directory'
  name: string
  path: string
}

const GlobalSearchFileListSchema = z
  .array(
    z.object({
      type: z.enum(['file', 'directory']),
      name: z.string(),
      path: z.string(),
    }),
  )
  .default([])

function useCommands(close: () => void): CommandAction[] {
  const { t } = useTranslation('search')
  const { openTab } = useCradleNavigation()
  const openSettings = useSettingsOverlayStore(s => s.openSettings)
  const toggleSidebar = useLayoutStore(s => s.toggleSidebar)
  const pluginCommands = usePluginStore(s => s.commands)

  return useMemo(
    () => {
      const appCommands: CommandAction[] = [
        {
          id: 'new-chat',
          label: t('command.newChat.label'),
          keywords: t('command.newChat.keywords'),
          icon: MessageSquareIcon,
          source: 'app',
          handler: () => {
            close()
            openTab('new-chat', {})
          },
        },
        {
          id: 'open-settings',
          label: t('command.openSettings.label'),
          keywords: t('command.openSettings.keywords'),
          icon: SettingsIcon,
          shortcut: '⌘,',
          source: 'app',
          handler: () => {
            close()
            const activeTabId = useCradleTabStore.getState().activeTabId
            if (activeTabId) {
              openSettings(activeTabId)
            }
          },
        },
        {
          id: 'toggle-sidebar',
          label: t('command.toggleSidebar.label'),
          keywords: t('command.toggleSidebar.keywords'),
          icon: TerminalIcon,
          shortcut: '⌘B',
          source: 'app',
          handler: () => {
            close()
            toggleSidebar()
          },
        },
        {
          id: 'open-usage',
          label: t('command.openUsage.label'),
          keywords: t('command.openUsage.keywords'),
          icon: CircleDotIcon,
          source: 'app',
          handler: () => {
            close()
            openTab('usage', {})
          },
        },
      ]

      const contributedCommands: CommandAction[] = pluginCommands.map(command => ({
        id: command.id,
        label: command.title,
        description: command.description ?? command.category ?? command.owner,
        keywords: [
          command.owner,
          command.localId,
          command.title,
          command.description ?? '',
          command.category ?? '',
          normalizeCommandKeywords(command.keywords),
        ].join(' '),
        icon: getPluginCommandIcon(command),
        shortcut: command.keybinding,
        source: 'plugin',
        handler: async () => {
          close()
          try {
            await command.execute()
          }
          catch (err) {
            toastManager.add({
              type: 'error',
              title: `Plugin command failed: ${command.title}`,
              description: err instanceof Error ? err.message : String(err),
            })
          }
        },
      }))

      return [...appCommands, ...contributedCommands]
    },
    [close, openTab, openSettings, pluginCommands, t, toggleSidebar],
  )
}

// ── File search hook ──────────────────────────────────────────────────────────

function useFileSearch(query: string, enabled: boolean, workspaceId: string | null | undefined) {
  const { files: rawFiles, isPending: searchDebouncing } = useWorkspaceFiles(workspaceId ?? null, {
    query,
    limit: 10,
    enabled: enabled && !!query.trim(),
  })
  const files = GlobalSearchFileListSchema.parse(rawFiles) satisfies GlobalSearchFile[]

  const trimmed = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!enabled || !trimmed || files.length === 0) {
      return []
    }
    return files
      .filter(file => file.type === 'file')
      .map(file => ({ file, matchScore: scoreFuzzyMatch(file.path, trimmed) ?? 0 }))
      .sort((a, b) => a.matchScore - b.matchScore || a.file.path.localeCompare(b.file.path))
      .map(result => result.file)
      .slice(0, 10)
  }, [enabled, trimmed, files])

  return {
    files: filtered,
    workspaceId,
    isPending: enabled && !!trimmed && !!workspaceId && searchDebouncing,
  }
}

// ── Thread search hook ────────────────────────────────────────────────────────

interface ThreadSearchHit {
  sessionId: string
  sessionTitle: string | null
  titleRanges: Array<{ start: number; end: number }>
  snippets: Array<{
    text: string
    ranges: Array<{ start: number; end: number }>
    messageRole: string
    messageId: string
  }>
}

function useThreadSearch(query: string, enabled: boolean) {
  const trimmed = query.trim()
  const { data, isPending } = useQuery({
    ...getSearchThreadsOptions({ query: { query: trimmed, limit: 10 } }),
    enabled: enabled && trimmed.length > 0,
    staleTime: 10_000,
  })

  const threads = (data ?? []) as ThreadSearchHit[]

  return {
    threads: enabled ? threads : [],
    isPending: enabled && trimmed.length > 0 && isPending,
  }
}

// ── Issue search hook ─────────────────────────────────────────────────────────

interface IssueSearchHit {
  id: string
  title: string
  workspaceId: string
  priority: string
  labels: string[]
}

function useIssueSearch(query: string, enabled: boolean) {
  const trimmed = query.trim()
  const { data, isPending } = useQuery({
    ...getIssuesSearchOptions({ query: { q: trimmed, limit: '10' } }),
    enabled: enabled && trimmed.length > 0,
    staleTime: 10_000,
  })

  const issues = (data ?? []) as IssueSearchHit[]

  // Derive workspace IDs from search results to batch-fetch boards
  const workspaceIds = useMemo(
    () => [...new Set(issues.map(issue => issue.workspaceId))],
    [issues],
  )

  const firstWorkspaceId = workspaceIds[0] ?? null

  const { data: boardsData } = useQuery({
    ...getKanbanBoardsOptions({ query: { workspaceId: firstWorkspaceId ?? undefined } }),
    enabled: enabled && !!firstWorkspaceId,
    staleTime: 60_000,
  })

  const boardId = (boardsData as Array<{ id: string }> | undefined)?.[0]?.id ?? null

  return {
    issues: enabled ? issues : [],
    isPending: enabled && trimmed.length > 0 && isPending,
    boardId,
  }
}

// ── Highlighted text renderer ─────────────────────────────────────────────────

function HighlightedText({ text, ranges }: { text: string; ranges: Array<{ start: number; end: number }> }) {
  if (!ranges || ranges.length === 0) {
    return <>{text}</>
  }

  const parts: React.ReactNode[] = []
  let cursor = 0

  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start))
    }
    parts.push(<mark key={range.start}>{text.slice(range.start, range.end)}</mark>)
    cursor = range.end
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return <>{parts}</>
}

// ── Main component ────────────────────────────────────────────────────────────

export const GlobalSearchDialog = memo(({ open, initialQuery = '>', onOpenChange }: GlobalSearchDialogProps) => {
  if (!open) {
    return null
  }

  return (
    <GlobalSearchDialogContent
      open={open}
      initialQuery={initialQuery}
      onOpenChange={onOpenChange}
    />
  )
})

const GlobalSearchDialogContent = memo(({ open, initialQuery = '>', onOpenChange }: GlobalSearchDialogProps) => {
  const { t } = useTranslation('search')
  const fileSearchWorkspace = useActiveFileSearchWorkspaceId(open)
  const openWorkspaceFile = useBrowserPanelStore(s => s.openWorkspaceFileTab)
  const setBrowserPanelOpen = useLayoutStore(s => s.setBrowserPanelOpen)
  const [query, setQuery] = useState('')
  const [commandHistory, setCommandHistory] = useState(readCommandHistory)
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

    setQuery(initialQuery)
    requestedQueryRef.current = ''
    measuredQueryRef.current = ''

    requestAnimationFrame(() => {
      const input = panelRef.current?.querySelector<HTMLInputElement>('[data-slot="command-input"]')
      input?.focus()
      input?.setSelectionRange(initialQuery.length, initialQuery.length)
    })
  }, [initialQuery, open])

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
    [open],
  )
  const commands = useCommands(close)
  const paletteMode = useMemo(() => parsePaletteInput(query), [query])
  const trimmed = paletteMode.query.trim()
  const hasQuery = trimmed.length > 0
  const isCommandMode = paletteMode.id === 'command'
  const isQuickOpenMode = paletteMode.id === 'quickOpen'
  const isUnsupportedMode = paletteMode.id === 'symbol'
    || paletteMode.id === 'line'
    || paletteMode.id === 'workspaceSymbol'

  const {
    files,
    workspaceId: fileWorkspaceId,
    isPending: filesPending,
  } = useFileSearch(
    trimmed,
    open && isQuickOpenMode && fileSearchWorkspace.availability === 'available',
    fileSearchWorkspace.workspaceId,
  )

  const { threads, isPending: threadsPending } = useThreadSearch(
    trimmed,
    open && isQuickOpenMode,
  )

  const { issues, isPending: issuesPending, boardId } = useIssueSearch(
    trimmed,
    open && isQuickOpenMode,
  )

  // Filter commands by query
  const filteredCommands = useMemo(() => {
    if (!isCommandMode) {
      return []
    }

    return commands
      .map((command) => {
        const searchTarget = `${command.label} ${command.keywords}`
        const matchScore = scoreFuzzyMatch(searchTarget, trimmed)
        if (matchScore === null) {
          return null
        }

        const historyIndex = commandHistory.indexOf(command.id)
        return {
          command,
          matchScore,
          historyIndex: historyIndex === -1 ? Number.MAX_SAFE_INTEGER : historyIndex,
        }
      })
      .filter((result): result is NonNullable<typeof result> => result !== null)
      .sort((a, b) => {
        if (!hasQuery && a.historyIndex !== b.historyIndex) {
          return a.historyIndex - b.historyIndex
        }
        if (a.matchScore !== b.matchScore) {
          return a.matchScore - b.matchScore
        }
        return a.command.label.localeCompare(b.command.label)
      })
      .map(result => result.command)
  }, [commandHistory, commands, hasQuery, isCommandMode, trimmed])

  const isPending = isQuickOpenMode && (filesPending || threadsPending || issuesPending)
  const hasResults = filteredCommands.length > 0 || files.length > 0 || threads.length > 0 || issues.length > 0
  const showModeGuide = !hasQuery && isCommandMode
  const showUnsupportedModeState = isUnsupportedMode && !isPending && !hasResults
  const showFileSearchUnavailableState = isQuickOpenMode
    && !hasResults
    && !isPending
    && fileSearchWorkspace.availability !== 'available'

  useEffect(() => {
    if (
      !open
      || !hasQuery
      || isPending
      || requestedQueryRef.current !== trimmed
      || measuredQueryRef.current === trimmed
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

  const handleSelectCommand = useCallback((command: CommandAction) => {
    setCommandHistory(writeCommandHistory(command.id))
    void command.handler()
  }, [])

  const handleSelectFile = useCallback(
    (filePath: string) => {
      if (!fileWorkspaceId) {
        return
      }

      selectFileSearchResult({
        workspaceId: fileWorkspaceId,
        filePath,
        close,
        openWorkspaceFile,
        setBrowserPanelOpen,
      })
    },
    [close, fileWorkspaceId, openWorkspaceFile, setBrowserPanelOpen],
  )

  const { openTab } = useCradleNavigation()

  const handleSelectThread = useCallback(
    (sessionId: string) => {
      close()
      openTab('chat', { sessionId })
    },
    [close, openTab],
  )

  const handleSelectIssue = useCallback(
    (issueId: string) => {
      close()
      if (boardId) {
        openTab('kanban-board', { boardId, issue: issueId })
      }
    },
    [boardId, close, openTab],
  )

  return createPortal(
    <div
      role="presentation"
      className={cn(
        'fixed inset-0 isolate z-50 flex items-start justify-center bg-black/10 px-4 pt-[18vh] supports-backdrop-filter:backdrop-blur-xs',
        open ? 'visible pointer-events-auto opacity-100' : 'invisible pointer-events-none opacity-0',
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
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-foreground/8 px-1.5 font-mono text-[11px] text-foreground/70">
                  {paletteMode.prefix || '⌘P'}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{t(paletteMode.labelKey)}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{t(paletteMode.descriptionKey)}</div>
                </div>
              </div>
              <DelayedSpinner active={isPending} className="size-3.5 shrink-0" />
            </div>
            <CommandInput
              placeholder={t(paletteMode.placeholderKey)}
              value={query}
              onValueChange={handleQueryChange}
              aria-label={t('aria.input')}
              data-testid="global-search-input"
            />
            <div>
              <CommandEmpty className="not-empty:py-12">
                {isPending
                  ? <LoadingState />
                  : showUnsupportedModeState
                    ? <ModeUnavailableState mode={paletteMode} />
                    : showFileSearchUnavailableState
                      ? <FileSearchUnavailableState availability={fileSearchWorkspace.availability} />
                      : hasQuery
                        ? <NoResults />
                        : <IdleState />}
              </CommandEmpty>
              <CommandList>
                {showModeGuide && (
                  <>
                    <CommandGroup>
                      <GroupHeader label={t('group.modes')} count={PALETTE_MODES.length} />
                      {PALETTE_MODES.map(mode => (
                        <PaletteModeRow key={mode.id} mode={mode} onSelect={setQuery} />
                      ))}
                    </CommandGroup>
                    {filteredCommands.length > 0 && <CommandSeparator />}
                  </>
                )}

                {filteredCommands.length > 0 && (
                  <>
                    <CommandGroup>
                      <GroupHeader label={t('group.commands')} count={filteredCommands.length} />
                      {filteredCommands.map(cmd => (
                        <CommandActionRow
                          key={cmd.id}
                          command={cmd}
                          recent={commandHistory.includes(cmd.id)}
                          onSelect={handleSelectCommand}
                        />
                      ))}
                    </CommandGroup>
                  </>
                )}

                {files.length > 0 && (
                  <CommandGroup>
                    <GroupHeader label={t('group.files')} count={files.length} />
                    {files.map(file => (
                      <FileSearchCommandRow
                        key={file.path}
                        file={file}
                        onSelect={handleSelectFile}
                      />
                    ))}
                  </CommandGroup>
                )}

                {threads.length > 0 && (
                  <CommandGroup>
                    <GroupHeader label={t('group.threads')} count={threads.length} />
                    {threads.map(thread => (
                      <ThreadSearchResultRow
                        key={thread.sessionId}
                        thread={thread}
                        onSelect={handleSelectThread}
                      />
                    ))}
                  </CommandGroup>
                )}

                {issues.length > 0 && (
                  <CommandGroup>
                    <GroupHeader label={t('group.issues')} count={issues.length} />
                    {issues.map(issue => (
                      <IssueSearchResultRow
                        key={issue.id}
                        issue={issue}
                        onSelect={handleSelectIssue}
                      />
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </div>

            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-muted-foreground text-xs">
              <div className="flex items-center gap-4">
                <div className="hidden items-center gap-1.5 sm:flex">
                  <Kbd>⌘P</Kbd>
                  <span>{t('footer.quickOpen')}</span>
                </div>
                <div className="hidden items-center gap-1.5 sm:flex">
                  <Kbd>⌘⇧P</Kbd>
                  <span>{t('footer.commands')}</span>
                </div>
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
              <span className="hidden font-mono text-[10px] text-muted-foreground/60 sm:inline">
                &gt; @ : #
              </span>
            </div>
          </div>
        </Command>
      </div>
    </div>,
    document.body,
  )
})

// ── Shared sub-components ─────────────────────────────────────────────────────

const PaletteModeRow = memo(({
  mode,
  onSelect,
}: {
  mode: (typeof PALETTE_MODES)[number]
  onSelect: (query: string) => void
}) => {
  const { t } = useTranslation('search')
  const selectMode = useCallback(() => {
    onSelect(mode.prefix)
  }, [mode.prefix, onSelect])

  return (
    <CommandItem
      value={`mode-${mode.id}`}
      onSelect={selectMode}
      className="flex items-center gap-2.5 px-2.5 py-1.5"
      data-testid={`global-search-mode-${mode.id}`}
    >
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded bg-foreground/8 font-mono text-[11px] text-foreground/70">
        {mode.prefix || '⌘P'}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{t(mode.labelKey)}</span>
      <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
        {t(mode.descriptionKey)}
      </span>
    </CommandItem>
  )
})

const CommandActionRow = memo(({
  command,
  recent,
  onSelect,
}: {
  command: CommandAction
  recent: boolean
  onSelect: (command: CommandAction) => void
}) => {
  const { t } = useTranslation('search')
  const selectCommand = useCallback(() => {
    onSelect(command)
  }, [command, onSelect])

  return (
    <CommandItem
      value={command.id}
      onSelect={selectCommand}
      className="flex items-center gap-2.5 px-2.5 py-1.5"
      data-testid={`global-search-command-${command.id}`}
    >
      <command.icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{command.label}</span>
        {command.description && (
          <span className="truncate text-[11px] text-muted-foreground">{command.description}</span>
        )}
      </span>
      {command.source === 'plugin' && (
        <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">Plugin</span>
      )}
      {recent && (
        <span className="hidden text-[10px] text-muted-foreground sm:inline">{t('command.recent')}</span>
      )}
      {command.shortcut && (
        <span className="font-mono text-[10px] text-muted-foreground">{command.shortcut}</span>
      )}
    </CommandItem>
  )
})

const FileSearchCommandRow = memo(({
  file,
  onSelect,
}: {
  file: GlobalSearchFile
  onSelect: (filePath: string) => void
}) => {
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

const ThreadSearchResultRow = memo(({
  thread,
  onSelect,
}: {
  thread: ThreadSearchHit
  onSelect: (sessionId: string) => void
}) => {
  const { t } = useTranslation('search')
  const selectThread = useCallback(() => {
    onSelect(thread.sessionId)
  }, [thread.sessionId, onSelect])

  const title = thread.sessionTitle ?? thread.snippets[0]?.text ?? ''
  const snippet = thread.snippets[0]

  return (
    <CommandItem
      value={`thread-${thread.sessionId}`}
      onSelect={selectThread}
      className="flex flex-col items-start gap-1 px-2.5 py-1.5 text-left"
      data-testid={`global-search-thread-result-${thread.sessionId}`}
    >
      <span
        className="w-full min-w-0 truncate text-sm"
        data-testid={`global-search-thread-title-${thread.sessionId}`}
      >
        <HighlightedText text={title} ranges={thread.titleRanges} />
      </span>
      {snippet && (
        <span
          className="w-full min-w-0 truncate text-xs text-muted-foreground"
          data-testid={`global-search-thread-snippet-${thread.sessionId}`}
        >
          <HighlightedText text={snippet.text} ranges={snippet.ranges} />
        </span>
      )}
      {thread.snippets.length === 0 && (
        <span className="text-[11px] text-muted-foreground">{t('thread.match.titleOnly')}</span>
      )}
    </CommandItem>
  )
})

const IssueSearchResultRow = memo(({
  issue,
  onSelect,
}: {
  issue: IssueSearchHit
  onSelect: (issueId: string) => void
}) => {
  const selectIssue = useCallback(() => {
    onSelect(issue.id)
  }, [issue.id, onSelect])

  return (
    <CommandItem
      value={`issue-${issue.id}`}
      onSelect={selectIssue}
      className="flex items-center gap-2.5 px-2.5 py-1.5"
      data-testid={`global-search-issue-result-${issue.title}`}
    >
      <CircleDotIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
    </CommandItem>
  )
})

function GroupHeader({ label, count }: { label: string, count: number }) {
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

function LoadingState() {
  const { t } = useTranslation('search')

  return (
    <div className="flex flex-col items-center gap-2">
      <DelayedSpinner active className="size-4" />
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

function ModeUnavailableState({ mode }: { mode: PaletteMode }) {
  const { t } = useTranslation('search')

  return (
    <div className="flex flex-col items-center gap-2 px-8">
      <span className="text-xs font-medium text-foreground">{t(mode.labelKey)}</span>
      <span className="text-center text-xs text-muted-foreground">{t('state.modeUnavailable')}</span>
    </div>
  )
}

function FileSearchUnavailableState({ availability }: { availability: FileSearchAvailability }) {
  const { t } = useTranslation('search')
  const message = availability === 'missing-workspace'
    ? t('state.fileSearchMissingWorkspace')
    : t('state.fileSearchUnsupportedTab')

  return (
    <div className="flex flex-col items-center gap-2 px-8">
      <span className="text-xs font-medium text-foreground">{t('mode.quickOpen.label')}</span>
      <span className="text-center text-xs text-muted-foreground">{message}</span>
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
