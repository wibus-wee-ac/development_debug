// Renders workspace Git changes in the right-aside Changes tab.
import { createFileTreeIconResolver, getBuiltInFileIconColor, getBuiltInSpriteSheet, prepareFileTreeInput } from '@pierre/trees'
import { FileTree as PierreFileTree, useFileTree } from '@pierre/trees/react'
import { FileDiffIcon, Loader2Icon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'
import type { GitFileStatus } from '~/lib/types'

import type { ChangeSection } from './changes-grouping'
import { groupGitFileStatuses } from './changes-grouping'
import { useGitFileStatuses } from './use-git'

const FILE_ICON_RESOLVER = createFileTreeIconResolver({ set: 'complete', colored: true })
const FILE_ICON_SPRITE_SHEET = getBuiltInSpriteSheet('complete')

type ChangesViewMode = 'type' | 'tree'
type TreeGitStatus = { path: string, status: GitFileStatus['status'] }

interface ChangesPanelProps {
  workspaceId: string | null | undefined
}

export function ChangesPanel({ workspaceId }: ChangesPanelProps) {
  const [viewMode, setViewMode] = useState<ChangesViewMode>('type')
  const {
    data: files,
    isLoading,
    isError,
    isSuccess,
  } = useGitFileStatuses(workspaceId)
  const sections = useMemo(() => groupGitFileStatuses(files ?? []), [files])
  const changedFiles = files ?? []
  const changedFileCount = files?.length ?? 0

  if (!workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center" data-testid="changes-panel-empty-workspace">
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
      <div className="flex flex-1 items-center justify-center p-4 text-center" data-testid="changes-panel-error">
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
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">Changes</span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55" data-testid="changes-panel-count">
          {changedFileCount}
        </span>
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
          <ToggleGroupItem value="type" aria-label="Show changes by type" className="h-5 px-1.5 text-[10px]">
            Type
          </ToggleGroupItem>
          <ToggleGroupItem value="tree" aria-label="Show changes as tree" className="h-5 px-1.5 text-[10px]">
            Tree
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {changedFileCount === 0
        ? (
          <div className="flex flex-1 items-center justify-center p-4 text-center" data-testid="changes-panel-empty">
            <p className="text-xs text-muted-foreground">No working tree changes</p>
          </div>
        )
        : viewMode === 'tree'
          ? (
            <ChangesTreeView files={changedFiles} />
          )
        : (
            <ChangesTypeView sections={sections} />
          )}
    </div>
  )
}

function ChangesTypeView({ sections }: { sections: ChangeSection[] }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto py-2" data-testid="changes-panel-sections">
      {/* Trees exposes its built-in icons as a trusted package-owned sprite sheet. */}
      {/* eslint-disable-next-line react-dom/no-dangerously-set-innerhtml */}
      <span className="pointer-events-none absolute size-0 overflow-hidden" dangerouslySetInnerHTML={{ __html: FILE_ICON_SPRITE_SHEET }} />
      {sections.filter(section => section.files.length > 0).map(section => (
        <ChangeSectionView key={section.id} section={section} />
      ))}
    </div>
  )
}

function ChangeSectionView({ section }: { section: ChangeSection }) {
  return (
    <section className="px-2 pb-3 last:pb-1" data-testid={`changes-section-${section.id}`} aria-label={section.label}>
      <div className="mb-1 flex h-5 items-center gap-2 px-1">
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-normal text-muted-foreground/70">
          {section.label}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/45">
          {section.files.length}
        </span>
      </div>
      <div className="overflow-hidden rounded-md border border-border/35 bg-background/30" role="list">
        {section.files.map(file => (
          <ChangeFileRow key={file.path} file={file} />
        ))}
      </div>
    </section>
  )
}

function ChangesTreeView({ files }: { files: GitFileStatus[] }) {
  const paths = useMemo(() => files.map(file => file.path), [files])
  const preparedInput = useMemo(() => prepareFileTreeInput(paths, { flattenEmptyDirectories: true }), [paths])
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

  return (
    <div className="min-h-0 flex-1 px-2 py-2" data-testid="changes-panel-tree">
      <PierreFileTree
        model={model}
        className="h-full rounded-md border border-border/35 bg-background/30"
        style={{
          '--trees-theme-list-active-selection-bg': 'color-mix(in oklab, var(--color-accent) 30%, transparent)',
          '--trees-theme-list-hover-bg': 'color-mix(in oklab, var(--color-accent) 30%, transparent)',
          '--trees-theme-list-inactive-selection-bg': 'color-mix(in oklab, var(--color-accent) 18%, transparent)',
          '--trees-theme-focus-ring': 'var(--color-accent)',
          '--trees-theme-foreground': 'var(--color-sidebar-foreground)',
          '--trees-bg': 'transparent',
          '--trees-search-bg': 'transparent',
        } as React.CSSProperties}
      />
    </div>
  )
}

function ChangeFileRow({ file }: { file: GitFileStatus }) {
  const display = getFileDisplay(file.path)
  const icon = FILE_ICON_RESOLVER.resolveIcon('file-tree-icon-file', file.path)
  const color = icon.token ? getBuiltInFileIconColor(icon.token) : undefined

  return (
    <div
      className="flex h-7 min-w-0 items-center gap-2 border-b border-border/25 px-2 text-xs last:border-b-0 hover:bg-accent/35"
      role="listitem"
      title={file.path}
      data-testid="changes-file-row"
      data-path={file.path}
      data-status={file.status}
    >
      <svg
        className="size-4 shrink-0 text-muted-foreground"
        viewBox={icon.viewBox ?? '0 0 16 16'}
        width={icon.width ?? 16}
        height={icon.height ?? 16}
        style={color ? { color } : undefined}
        aria-hidden
      >
        <use href={`#${icon.name}`} />
      </svg>
      <span className="min-w-0 flex-1 truncate text-foreground/85">{display.name}</span>
      {display.directory && (
        <span className="min-w-0 max-w-24 shrink truncate text-[10px] text-muted-foreground/45">
          {display.directory}
        </span>
      )}
      <span className={cn(
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
    </div>
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
