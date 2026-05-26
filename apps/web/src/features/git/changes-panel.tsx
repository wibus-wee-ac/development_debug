// Renders workspace Git changes in the right-aside Changes tab.
import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree as PierreFileTree, useFileTree } from '@pierre/trees/react'
import { FileDiffIcon, Loader2Icon, ScanEyeIcon } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { WorkspaceFileIcon, WorkspaceFileIconSpriteSheet } from '~/components/common/workspace-file-icon'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'
import type { GitFileStatus } from '~/lib/types'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import type { ChangeSection } from './changes-grouping'
import { groupGitFileStatuses } from './changes-grouping'
import { resolveTreeItemFromEvent } from './tree-event-target'
import { useGitFileStatuses } from './use-git'

type ChangesViewMode = 'type' | 'tree'
type TreeGitStatus = { path: string, status: GitFileStatus['status'] }

interface ChangesPanelProps {
  workspaceId: string | null | undefined
}

export function ChangesPanel({ workspaceId }: ChangesPanelProps) {
  const [viewMode, setViewMode] = useState<ChangesViewMode>('type')
  const { data: files, isLoading, isError, isSuccess } = useGitFileStatuses(workspaceId)
  const sections = useMemo(() => groupGitFileStatuses(files ?? []), [files])
  const changedFiles = files ?? []
  const changedFileCount = files?.length ?? 0

  const openDiffTab = useBrowserPanelStore(s => s.openWorkspaceDiffTab)
  const setBrowserPanelOpen = useLayoutStore(s => s.setBrowserPanelOpen)

  const requestScrollToFilePath = useBrowserPanelStore(s => s.requestScrollToFilePath)

  const handleReviewAll = useCallback(() => {
    if (!workspaceId) {
      return
    }
    openDiffTab({ workspaceId, title: 'All Changes' })
    setBrowserPanelOpen(true)
  }, [workspaceId, openDiffTab, setBrowserPanelOpen])

  const handleReviewFile = useCallback(
    (path: string) => {
      if (!workspaceId) {
        return
      }
      const tabId = openDiffTab({ workspaceId, title: 'All Changes' })
      setBrowserPanelOpen(true)
      requestScrollToFilePath({ path, tabId })
    },
    [workspaceId, openDiffTab, setBrowserPanelOpen, requestScrollToFilePath],
  )

  let changesContent: ReactNode = (
    <ChangesTypeView sections={sections} onFileClick={handleReviewFile} />
  )
  if (changedFileCount === 0) {
    changesContent = (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="changes-panel-empty"
      >
        <p className="text-xs text-muted-foreground">No working tree changes</p>
      </div>
    )
  }
  if (changedFileCount > 0 && viewMode === 'tree') {
    changesContent = <ChangesTreeView files={changedFiles} onFileClick={handleReviewFile} />
  }

  if (!workspaceId) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="changes-panel-empty-workspace"
      >
        <p className="text-xs text-muted-foreground">Select a workspace first</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center" data-testid="changes-panel-loading">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground/40" aria-hidden />
      </div>
    )
  }

  if (isError) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="changes-panel-error"
      >
        <div className="flex flex-col items-center gap-2">
          <FileDiffIcon className="size-5 text-muted-foreground/30" aria-hidden />
          <p className="text-xs text-muted-foreground">Git changes unavailable</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="changes-panel"
      data-right-aside-changes-ready={isSuccess ? 'true' : 'false'}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2.5">
        <FileDiffIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">
          Changes
        </span>
        <span
          className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55"
          data-testid="changes-panel-count"
        >
          {changedFileCount}
        </span>
        {changedFileCount > 0 && (
          <button
            type="button"
            onClick={handleReviewAll}
            className="flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
            data-testid="changes-review-all"
          >
            <ScanEyeIcon className="size-3" aria-hidden />
            Review
          </button>
        )}
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(value) => {
            if (value === 'type' || value === 'tree') {
              setViewMode(value)
            }
          }}
          variant="outline"
          size="sm"
          className="h-5 shrink-0 gap-px rounded-md"
          aria-label="Changes view mode"
          data-testid="changes-view-mode"
        >
          <ToggleGroupItem
            value="type"
            aria-label="Show changes by type"
            className="h-5 px-1.5 text-[10px]"
          >
            Type
          </ToggleGroupItem>
          <ToggleGroupItem
            value="tree"
            aria-label="Show changes as tree"
            className="h-5 px-1.5 text-[10px]"
          >
            Tree
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {changesContent}
    </div>
  )
}

function ChangesTypeView({
  sections,
  onFileClick,
}: {
  sections: ChangeSection[]
  onFileClick: (path: string) => void
}) {
  return (
    <div
      className="relative min-h-0 flex-1 overflow-y-auto py-2"
      data-testid="changes-panel-sections"
    >
      <WorkspaceFileIconSpriteSheet />
      {sections
        .filter(section => section.files.length > 0)
        .map(section => (
          <ChangeSectionView key={section.id} section={section} onFileClick={onFileClick} />
        ))}
    </div>
  )
}

function ChangeSectionView({
  section,
  onFileClick,
}: {
  section: ChangeSection
  onFileClick: (path: string) => void
}) {
  return (
    <section
      className="px-2 pb-3 last:pb-1"
      data-testid={`changes-section-${section.id}`}
      aria-label={section.label}
    >
      <div className="mb-1 flex h-5 items-center gap-2 px-1">
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-normal text-muted-foreground/70">
          {section.label}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/45">
          {section.files.length}
        </span>
      </div>
      <div
        className="overflow-hidden rounded-md border border-border/35 bg-background/30"
        role="list"
      >
        {section.files.map(file => (
          <ChangeFileRow key={file.path} file={file} onClick={onFileClick} />
        ))}
      </div>
    </section>
  )
}

function ChangesTreeView({
  files,
  onFileClick,
}: {
  files: GitFileStatus[]
  onFileClick: (path: string) => void
}) {
  const paths = useMemo(() => files.map(file => file.path), [files])
  const filePathSet = useMemo(() => new Set(paths), [paths])
  const preparedInput = useMemo(
    () => prepareFileTreeInput(paths, { flattenEmptyDirectories: true }),
    [paths],
  )
  const gitStatus = useMemo<TreeGitStatus[]>(
    () => files.map(file => ({ path: file.path, status: file.status })),
    [files],
  )

  const { model } = useFileTree({
    preparedInput,
    density: 'compact',
    dragAndDrop: {
      canDrop: () => false,
    },
    fileTreeSearchMode: 'hide-non-matches',
    gitStatus,
    icons: { set: 'complete', colored: true },
    initialExpansion: 'open',
  })

  useEffect(() => {
    model.resetPaths(paths, { preparedInput })
    model.setGitStatus(gitStatus)
  }, [model, paths, preparedInput, gitStatus])

  const handleTreeDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const item = resolveTreeItemFromEvent(event.nativeEvent)
      if (!item || item.kind !== 'file' || !filePathSet.has(item.path)) {
        return
      }
      event.preventDefault()
      model.focusPath(item.path)
      model.getItem(item.path)?.select()
      onFileClick(item.path)
    },
    [filePathSet, model, onFileClick],
  )

  return (
    <div
      className="min-h-0 flex-1"
      data-testid="changes-panel-tree"
      onDoubleClick={handleTreeDoubleClick}
    >
      <PierreFileTree
        model={model}
        className="h-full"
        style={
          {
            '--trees-theme-list-active-selection-bg':
              'color-mix(in oklab, var(--color-accent) 30%, transparent)',
            '--trees-theme-list-hover-bg':
              'color-mix(in oklab, var(--color-accent) 30%, transparent)',
            '--trees-theme-list-inactive-selection-bg':
              'color-mix(in oklab, var(--color-accent) 18%, transparent)',
            '--trees-theme-focus-ring': 'var(--color-accent)',
            '--trees-theme-foreground': 'var(--color-sidebar-foreground)',
            '--trees-bg': 'transparent',
            '--trees-search-bg': 'transparent',
            '--trees-padding-inline': '0px',
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function ChangeFileRow({
  file,
  onClick,
}: {
  file: GitFileStatus
  onClick: (path: string) => void
}) {
  const display = getFileDisplay(file.path)

  return (
    <button
      type="button"
      className="flex h-7 min-w-0 w-full items-center gap-2 border-b border-border/25 px-2 text-xs last:border-b-0 hover:bg-accent/35 text-left"
      title={file.path}
      data-testid="changes-file-row"
      data-path={file.path}
      data-status={file.status}
      onClick={() => onClick(file.path)}
    >
      <WorkspaceFileIcon path={file.path} />
      <span className="min-w-0 flex-1 truncate text-foreground/85">{display.name}</span>
      {display.directory && (
        <span className="min-w-0 max-w-24 shrink truncate text-[10px] text-muted-foreground/45">
          {display.directory}
        </span>
      )}
      <span
        className={cn(
          'flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm px-1 text-[9px] font-semibold uppercase tabular-nums',
          {
            'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400': file.status === 'added',
            'bg-sky-500/10 text-sky-600 dark:text-sky-400': file.status === 'modified',
            'bg-red-500/10 text-red-600 dark:text-red-400': file.status === 'deleted',
            'bg-violet-500/10 text-violet-600 dark:text-violet-400': file.status === 'renamed',
            'bg-amber-500/10 text-amber-600 dark:text-amber-400': file.status === 'untracked',
          },
        )}
      >
        {getStatusLabel(file.status)}
      </span>
    </button>
  )
}

function getFileDisplay(path: string): { directory: string | null, name: string } {
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash < 0) {
    return { directory: null, name: path }
  }

  return {
    directory: path.slice(0, lastSlash),
    name: path.slice(lastSlash + 1),
  }
}

function getStatusLabel(status: GitFileStatus['status']): string {
  switch (status) {
    case 'added':
      return 'A'
    case 'modified':
      return 'M'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'untracked':
      return 'U'
  }
}
