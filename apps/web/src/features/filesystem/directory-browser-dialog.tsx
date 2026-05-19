import { useQuery } from '@tanstack/react-query'
import {
  ArrowUpIcon,
  ChevronRightIcon,
  CodeIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  HomeIcon,
  Loader2Icon,
  MonitorIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getFilesystemBrowse, getFilesystemFavorites } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import { ScrollArea } from '~/components/ui/scroll-area'
import { cn } from '~/lib/cn'

const LAST_PATH_KEY = 'directory-browser-last-path'

interface FilesystemFavoriteEntry {
  name: string
  path: string
  icon: string
}

interface FilesystemBrowseEntry {
  name: string
  path: string
  type: 'file' | 'directory'
}

interface FilesystemBrowseResult {
  current: string
  parent?: string
  entries: FilesystemBrowseEntry[]
}

interface DirectoryBrowserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
  title?: string
  description?: string
}

export function DirectoryBrowserDialog({
  open,
  onOpenChange,
  onSelect,
  title = '选择目录',
  description,
}: DirectoryBrowserDialogProps) {
  const [currentPath, setCurrentPath] = useState<string | undefined>(() => {
    return localStorage.getItem(LAST_PATH_KEY) ?? undefined
  })
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null)
  const [lastResolvedPath, setLastResolvedPath] = useState<string>(localStorage.getItem(LAST_PATH_KEY) ?? '')

  const { data: favoritesData } = useQuery<FilesystemFavoriteEntry[]>({
    queryKey: ['filesystem-favorites'],
    queryFn: async () => {
      const result = await getFilesystemFavorites()
      return (result.data ?? []) as FilesystemFavoriteEntry[]
    },
    enabled: open,
    staleTime: 60_000,
  })

  const { data, isLoading, error } = useQuery<FilesystemBrowseResult>({
    queryKey: ['filesystem-browse', currentPath],
    queryFn: async () => {
      const result = await getFilesystemBrowse({
        query: currentPath ? { path: currentPath } : {},
      })
      return result.data as FilesystemBrowseResult
    },
    enabled: open,
    staleTime: 10_000,
  })

  const currentDirectory = data?.current ?? null

  useEffect(() => {
    if (currentDirectory) {
      setLastResolvedPath(currentDirectory)
    }
  }, [currentDirectory])

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path)
    setSelectedEntry(null)
    localStorage.setItem(LAST_PATH_KEY, path)
  }, [])

  const handleConfirm = useCallback(() => {
    const chosen = selectedEntry ?? currentDirectory
    if (chosen) {
      onSelect(chosen)
      onOpenChange(false)
    }
  }, [selectedEntry, currentDirectory, onSelect, onOpenChange])

  const handleDoubleClick = useCallback((path: string) => {
    navigateTo(path)
  }, [navigateTo])

  const directories = data?.entries.filter(e => e.type === 'directory') ?? []
  const files = data?.entries.filter(e => e.type === 'file') ?? []

  const handleListingKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget) {
      return
    }

    if (directories.length === 0) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedEntry(current => selectDirectoryByOffset(directories, current, 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedEntry(current => selectDirectoryByOffset(directories, current, -1))
      return
    }

    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    const target = selectedEntry ?? directories[0]?.path ?? null
    if (!target) {
      return
    }

    if (event.metaKey || event.ctrlKey) {
      onSelect(target)
      onOpenChange(false)
      return
    }

    navigateTo(target)
  }, [directories, navigateTo, onOpenChange, onSelect, selectedEntry])

  const handleDirectoryKeyDown = useCallback((path: string, event: React.KeyboardEvent) => {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    if (event.metaKey || event.ctrlKey) {
      onSelect(path)
      onOpenChange(false)
      return
    }

    navigateTo(path)
  }, [navigateTo, onOpenChange, onSelect])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl h-140 flex flex-col gap-0 p-0 overflow-hidden" data-testid="directory-browser-dialog">
        {/* Split pane */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <nav className="w-44 shrink-0 border-r py-3 px-2 flex flex-col gap-0.5">
            <DialogTitle className="px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="px-2 pb-2 text-[11px] leading-snug text-muted-foreground">
                {description}
              </DialogDescription>
            )}
            {favoritesData?.map(fav => (
              <SidebarItem
                key={fav.path}
                icon={<FavoriteIcon name={fav.icon} />}
                label={fav.name}
                active={data?.current === fav.path}
                onClick={() => navigateTo(fav.path)}
              />
            ))}
          </nav>

          {/* Main panel */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            {/* Editable breadcrumb / path bar */}
            <PathBar
              currentPath={currentDirectory ?? lastResolvedPath}
              onNavigate={navigateTo}
              onGoUp={data?.parent ? () => navigateTo(data.parent!) : undefined}
            />

            {/* Listing */}
            <ScrollArea className="flex-1 min-h-0">
              {isLoading && (
                <div className="flex items-center justify-center h-full min-h-40">
                  <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                </div>
              )}

              {error && (
                <div className="flex flex-col items-center justify-center h-full min-h-40 gap-1 px-6">
                  <p className="text-xs font-medium text-destructive">无法访问该路径</p>
                  <p className="text-[11px] text-muted-foreground text-center">
                    {(error as Error).message}
                  </p>
                </div>
              )}

              {!isLoading && !error && directories.length === 0 && files.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full min-h-40 gap-1">
                  <p className="text-xs text-muted-foreground">空目录</p>
                </div>
              )}

              {!isLoading && !error && (directories.length > 0 || files.length > 0) && (
                <div
                  className="py-0.5 outline-none"
                  tabIndex={0}
                  role="group"
                  aria-label="Directories"
                  onKeyDown={handleListingKeyDown}
                  data-testid="directory-browser-listing"
                >
                  {directories.map(entry => (
                    <DirectoryRow
                      key={entry.path}
                      name={entry.name}
                      path={entry.path}
                      isSelected={selectedEntry === entry.path}
                      onSelect={() => setSelectedEntry(entry.path)}
                      onDoubleClick={() => handleDoubleClick(entry.path)}
                      onKeyDown={event => handleDirectoryKeyDown(entry.path, event)}
                    />
                  ))}
                  {files.map(entry => (
                    <FileRow key={entry.path} name={entry.name} />
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        {/* Footer — just buttons */}
        <DialogFooter variant="bare" className="px-3 py-2 border-t gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            size="sm"
            className="text-xs"
            onClick={handleConfirm}
            disabled={!data?.current && !selectedEntry}
            data-testid="directory-browser-confirm"
          >
            选择
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Path bar (breadcrumb + editable) ──────────────────────────────────────────

function PathBar({
  currentPath,
  onNavigate,
  onGoUp,
}: {
  currentPath: string
  onNavigate: (path: string) => void
  onGoUp?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  // Determine the parent dir to browse for suggestions
  const lastSlash = editValue.lastIndexOf('/')
  const parentDir = lastSlash >= 0 ? editValue.slice(0, lastSlash) || '/' : undefined
  const prefix = lastSlash >= 0 ? editValue.slice(lastSlash + 1).toLowerCase() : ''

  const { data: suggestionsData } = useQuery<FilesystemBrowseResult>({
    queryKey: ['filesystem-browse', parentDir],
    queryFn: async () => {
      const result = await getFilesystemBrowse({
        query: parentDir ? { path: parentDir } : {},
      })
      return result.data as FilesystemBrowseResult
    },
    enabled: editing && !!parentDir,
    staleTime: 10_000,
  })

  const suggestions = (suggestionsData?.entries ?? [])
    .filter(e => e.type === 'directory' && e.name.toLowerCase().startsWith(prefix))
    .slice(0, 8)

  const segments = currentPath.split('/').filter(Boolean)

  useEffect(() => {
    if (!editing) {
      return
    }
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [editing])

  const startEditing = useCallback(() => {
    setEditValue(currentPath)
    setEditing(true)
    setShowSuggestions(true)
    setSelectedSuggestion(-1)
  }, [currentPath])

  const commitEdit = useCallback(() => {
    setEditing(false)
    setShowSuggestions(false)
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== currentPath) {
      onNavigate(trimmed)
    }
  }, [editValue, currentPath, onNavigate])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setShowSuggestions(false)
  }, [])

  const applySuggestion = useCallback((path: string) => {
    setEditValue(path)
    setShowSuggestions(false)
    onNavigate(path)
    setEditing(false)
  }, [onNavigate])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
        applySuggestion(suggestions[selectedSuggestion].path)
      }
      else {
        commitEdit()
      }
    }
    else if (e.key === 'Escape') {
      cancelEdit()
    }
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedSuggestion(i => Math.min(i + 1, suggestions.length - 1))
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedSuggestion(i => Math.max(i - 1, -1))
    }
    else if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault()
      const idx = selectedSuggestion >= 0 ? selectedSuggestion : 0
      if (suggestions[idx]) {
        setEditValue(`${suggestions[idx].path}/`)
        setSelectedSuggestion(-1)
      }
    }
  }, [commitEdit, cancelEdit, applySuggestion, suggestions, selectedSuggestion])

  if (editing) {
    return (
      <div className="relative">
        <div className="flex items-center h-8 px-3 border-b bg-muted/30">
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => {
              setEditValue(e.target.value)
              setShowSuggestions(true)
              setSelectedSuggestion(-1)
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Delay to allow clicking suggestions
              setTimeout(() => {
                setEditing(false)
                setShowSuggestions(false)
              }, 150)
            }}
            className="w-full h-full text-xs font-mono bg-transparent outline-none"
            data-testid="directory-browser-path-input"
          />
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-8 z-50 border-b bg-popover shadow-md max-h-48 overflow-y-auto">
            {suggestions.map((s, i) => (
              <button
                key={s.path}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  applySuggestion(s.path)
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                  'hover:bg-accent',
                  i === selectedSuggestion && 'bg-accent',
                )}
              >
                <FolderIcon className="size-3 text-muted-foreground shrink-0" />
                <span className="truncate font-mono">{s.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="flex items-center h-8 px-3 border-b text-xs gap-1 overflow-x-auto cursor-text select-none"
      onDoubleClick={startEditing}
      data-testid="directory-browser-breadcrumb"
    >
      {onGoUp && (
        <button
          type="button"
          onClick={onGoUp}
          className="shrink-0 p-0.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        >
          <ArrowUpIcon className="size-3" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors font-mono"
      >
        /
      </button>
      {segments.map((seg, i) => {
        const segPath = `/${segments.slice(0, i + 1).join('/')}`
        const isLast = i === segments.length - 1
        return (
          <span key={segPath} className="flex items-center gap-1 shrink-0">
            <ChevronRightIcon className="size-2.5 text-muted-foreground/40" />
            {isLast
              ? <span className="font-medium text-foreground">{seg}</span>
              : (
                <button
                  type="button"
                  onClick={() => onNavigate(segPath)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {seg}
                </button>
                )}
          </span>
        )
      })}
    </div>
  )
}

// ── Favorite icon mapping ─────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ReactNode> = {
  'home': <HomeIcon className="size-3.5" />,
  'monitor': <MonitorIcon className="size-3.5" />,
  'file-text': <FileTextIcon className="size-3.5" />,
  'download': <DownloadIcon className="size-3.5" />,
  'code': <CodeIcon className="size-3.5" />,
}

function FavoriteIcon({ name }: { name: string }) {
  return <>{ICON_MAP[name] ?? <FolderIcon className="size-3.5" />}</>
}

// ── Sidebar item ──────────────────────────────────────────────────────────────

function SidebarItem({
  icon,
  label,
  onClick,
  active,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
        'hover:bg-accent',
        active && 'bg-accent font-medium',
      )}
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

// ── Directory row ─────────────────────────────────────────────────────────────

function DirectoryRow({
  name,
  path,
  isSelected,
  onSelect,
  onDoubleClick,
  onKeyDown,
}: {
  name: string
  path: string
  isSelected: boolean
  onSelect: () => void
  onDoubleClick: () => void
  onKeyDown: (event: React.KeyboardEvent) => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      aria-pressed={isSelected}
      data-testid={`directory-entry-${name}`}
      data-path={path}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors',
        'hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none',
        isSelected && 'bg-accent',
      )}
    >
      <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate flex-1">{name}</span>
      <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/30" />
    </button>
  )
}

export function selectDirectoryByOffset(
  directories: FilesystemBrowseEntry[],
  selectedPath: string | null,
  offset: 1 | -1,
): string | null {
  if (directories.length === 0) {
    return null
  }

  const currentIndex = directories.findIndex(entry => entry.path === selectedPath)
  const nextIndex = currentIndex === -1
    ? offset > 0 ? 0 : directories.length - 1
    : Math.min(Math.max(currentIndex + offset, 0), directories.length - 1)

  return directories[nextIndex]?.path ?? null
}

// ── File row (disabled) ───────────────────────────────────────────────────────

function FileRow({ name }: { name: string }) {
  return (
    <div className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs opacity-40 cursor-default select-none">
      <FileIcon className="size-3.5 shrink-0" />
      <span className="truncate flex-1">{name}</span>
    </div>
  )
}
