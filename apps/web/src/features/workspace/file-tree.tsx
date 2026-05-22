import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree as PierreFileTree, useFileTree, useFileTreeSearch, useFileTreeSelection } from '@pierre/trees/react'
import { useQuery } from '@tanstack/react-query'
import { Loader2Icon, PackageIcon, SearchIcon, XIcon } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { z } from 'zod'

import { getWorkspacesByIdFiles, getWorkspacesByIdGitStatus } from '~/api-gen/sdk.gen'
import { markCradlePerformance, measureCradlePerformance } from '~/lib/perf-monitor'
import { serializeWorkspaceFileDragPayload, writeWorkspaceFileDragData } from '~/lib/workspace-drag-data'
import type { GitFileStatus } from '~/lib/types'

// ── Git status mapper ─────────────────────────────────────────────────────────

type TreeGitStatus = { path: string, status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'ignored' }
const WorkspaceFileListSchema = z.array(z.object({
  type: z.enum(['file', 'directory']),
  name: z.string(),
  path: z.string(),
})).default([])
const GitFileStatusListSchema = z.array(z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked']),
})).default([])
const GitStatusFileListSchema = z.object({
  files: GitFileStatusListSchema,
}).default({ files: [] })

function toTreeGitStatus(statuses: GitFileStatus[]): TreeGitStatus[] {
  return statuses.map(s => ({ path: s.path, status: s.status }))
}

function getDraggedTreeItemPath(event: DragEvent): string | null {
  const target = event.target instanceof HTMLElement
    ? event.target.closest('[data-item-path]')
    : null
  if (target instanceof HTMLElement && target.dataset.itemPath) {
    return target.dataset.itemPath
  }

  for (const entry of event.composedPath()) {
    if (entry instanceof HTMLElement && entry.dataset.itemPath) {
      return entry.dataset.itemPath
    }
  }

  return null
}

// ── Main component ────────────────────────────────────────────────────────────

interface FileTreeProps {
  workspaceId: string | null
  workspacePath?: string | null
  onPackRequested?: (paths: string[]) => void
}

export function FileTree({ workspaceId, workspacePath, onPackRequested }: FileTreeProps) {
  const filesQuery = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesByIdFiles({ path: { id: workspaceId! } })
      return WorkspaceFileListSchema.parse(data)
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  })

  const gitStatusQuery = useQuery({
    queryKey: ['git-file-statuses', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesByIdGitStatus({ path: { id: workspaceId! } })
      return GitStatusFileListSchema.parse(data).files satisfies GitFileStatus[]
    },
    enabled: !!workspaceId,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  const files = filesQuery.data ?? []
  const gitStatuses = gitStatusQuery.data

  // Only pass file paths — @pierre/trees auto-creates directory nodes from path hierarchy
  const paths = useMemo(() => files.flatMap(f => f.type === 'file' ? [f.path] : []), [files])

  const preparedInput = useMemo(
    () => paths.length > 0 ? prepareFileTreeInput(paths, { flattenEmptyDirectories: true }) : null,
    [paths],
  )

  const treeGitStatus = useMemo(
    () => gitStatuses ? toTreeGitStatus(gitStatuses) : undefined,
    [gitStatuses],
  )

  if (!workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">未关联工作区</p>
      </div>
    )
  }

  if (filesQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground/40" />
      </div>
    )
  }

  if (!preparedInput) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">工作区为空</p>
      </div>
    )
  }

  return (
    <FileTreeInner
      workspaceId={workspaceId}
      preparedInput={preparedInput}
      ready={filesQuery.isSuccess && gitStatusQuery.isSuccess}
      gitStatus={treeGitStatus}
      workspacePath={workspacePath ?? undefined}
      onPackRequested={onPackRequested}
    />
  )
}

// ── Inner tree (mounted once model exists) ────────────────────────────────────

interface FileTreeInnerProps {
  workspaceId: string
  preparedInput: ReturnType<typeof prepareFileTreeInput>
  ready: boolean
  gitStatus?: TreeGitStatus[]
  workspacePath?: string
  onPackRequested?: (paths: string[]) => void
}

function FileTreeInner({ workspaceId, preparedInput, ready, gitStatus, workspacePath, onPackRequested }: FileTreeInnerProps) {
  const { model } = useFileTree({
    preparedInput,
    initialSearchQuery: '',
    fileTreeSearchMode: 'hide-non-matches',
    dragAndDrop: {
      canDrop: () => false,
    },
    icons: { set: 'complete', colored: true },
    density: 'compact',
    initialExpansion: 'closed',
    initialExpandedPaths: ['src'],
    gitStatus,
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: 'both',
        buttonVisibility: 'when-needed',
      },
    },
  })

  const selectedPaths = useFileTreeSelection(model)
  const search = useFileTreeSearch(model)
  const hasSearchValue = search.value.length > 0
  const firstRenderedWorkspaceIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!ready || firstRenderedWorkspaceIdRef.current === workspaceId) {
      return
    }

    firstRenderedWorkspaceIdRef.current = workspaceId
    markCradlePerformance('cradle:first-right-aside-files-rendered')
    measureCradlePerformance(
      'cradle:right-aside-files-first-render',
      'cradle:right-aside-files-open-requested',
      'cradle:first-right-aside-files-rendered',
    )
  }, [ready, workspaceId])

  // Update git status when it changes
  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

  // Drag handler: expose workspace file paths to chat and TUI drop targets.
  useEffect(() => {
    const container = model.getFileTreeContainer()
    if (!container) {
      return
    }

    function handleDragStart(e: DragEvent) {
      const itemPath = getDraggedTreeItemPath(e)
      if (!itemPath || !e.dataTransfer) {
        return
      }

      writeWorkspaceFileDragData(
        e.dataTransfer,
        serializeWorkspaceFileDragPayload({ relativePath: itemPath, workspacePath }),
      )
      e.dataTransfer.effectAllowed = 'copy'
    }

    container.addEventListener('dragstart', handleDragStart)
    return () => container.removeEventListener('dragstart', handleDragStart)
  }, [model, workspacePath])

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden pt-2"
      data-testid="right-aside-file-tree"
      data-right-aside-files-ready={ready ? 'true' : 'false'}
    >
      <div className="shrink-0 px-2 pb-2">
        <div className="flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/15">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          <input
            value={search.value}
            onChange={event => search.setValue(event.target.value)}
            placeholder="Search files"
            aria-label="Search files"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/45"
          />
          {hasSearchValue && (
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55">
              {search.matchingPaths.length}
            </span>
          )}
          {hasSearchValue && (
            <button
              type="button"
              onClick={() => search.setValue('')}
              aria-label="Clear search"
              className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            >
              <XIcon className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Tree */}
      <PierreFileTree
        model={model}
        className="flex-1"
        style={{
          '--trees-theme-list-active-selection-bg': 'color-mix(in oklab, var(--color-accent) 30%, transparent)',
          '--trees-theme-list-hover-bg': 'color-mix(in oklab, var(--color-accent) 30%, transparent)',
          '--trees-theme-list-inactive-selection-bg': 'color-mix(in oklab, var(--color-accent) 18%, transparent)',
          '--trees-theme-focus-ring': 'var(--color-accent)',
          '--trees-theme-foreground': 'var(--color-sidebar-foreground)',
          '--trees-bg': 'transparent',
          '--trees-search-bg': 'transparent',
        } as React.CSSProperties}
        renderContextMenu={(item, context) => (
          <div className="min-w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
            <ContextMenuItem
              label="复制路径"
              onClick={() => {
                const absPath = workspacePath ? `${workspacePath}/${item.path}` : item.path
                navigator.clipboard.writeText(absPath)
                context.close({ restoreFocus: true })
              }}
            />
            <ContextMenuItem
              label="复制相对路径"
              onClick={() => {
                navigator.clipboard.writeText(item.path)
                context.close({ restoreFocus: true })
              }}
            />
            {workspacePath && (
              <ContextMenuItem
                label="在 Finder 中显示"
                onClick={() => {
                  context.close({ restoreFocus: true })
                }}
              />
            )}
            {onPackRequested && (
              <>
                <div className="mx-1 my-1 h-px bg-border/60" />
                <ContextMenuItem
                  label="Pack & Copy to AI"
                  icon={<PackageIcon className="size-3" />}
                  onClick={() => {
                    // Use current selection if it includes this item; otherwise just this item
                    const paths: string[] = selectedPaths.length > 0 && selectedPaths.includes(item.path)
                      ? [...selectedPaths]
                      : [item.path]
                    onPackRequested(paths)
                    context.close({ restoreFocus: true })
                  }}
                />
              </>
            )}
          </div>
        )}
      />

      {/* Status bar */}
      {selectedPaths.length > 0 && (
        <div className="shrink-0 border-t border-border px-2.5 py-1">
          <p className="truncate text-[10px] text-muted-foreground/50">
            {selectedPaths.length === 1 ? selectedPaths[0] : `${selectedPaths.length} 个文件`}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Context menu item ──────────────────────────────────────────────────────────

function ContextMenuItem({ label, icon, onClick }: { label: string, icon?: React.ReactNode, onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-popover-foreground transition-colors hover:bg-accent"
    >
      {icon}
      {label}
    </button>
  )
}
