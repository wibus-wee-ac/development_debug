// Input: workspaceId, @pierre/trees React, SDK workspace + git APIs
// Output: FileTree component — full-feature file tree using @pierre/trees
// Position: Content for the File Tree tab in the right aside panel

import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree as PierreFileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import { useQuery } from '@tanstack/react-query'
import { Loader2Icon, PackageIcon } from 'lucide-react'
import { normalize } from 'pathe'
import { useEffect, useMemo } from 'react'

import { getWorkspacesByIdFiles, getWorkspacesByIdGitStatus } from '~/api-gen/sdk.gen'
import type { GitFileStatus } from '~/lib/types'

// ── Git status mapper ─────────────────────────────────────────────────────────

type TreeGitStatus = { path: string, status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'ignored' }

function toTreeGitStatus(statuses: GitFileStatus[]): TreeGitStatus[] {
  return statuses.map(s => ({ path: s.path, status: s.status }))
}

// ── Path quoting for drag ─────────────────────────────────────────────────────

function quotePath(p: string): string {
  const normalized = normalize(p)
  return normalized.includes(' ') ? `"${normalized}"` : normalized
}

// ── Main component ────────────────────────────────────────────────────────────

interface FileTreeProps {
  workspaceId: string | null
  workspacePath?: string | null
  onPackRequested?: (paths: string[]) => void
}

export function FileTree({ workspaceId, onPackRequested }: FileTreeProps) {
  const { data: files = [], isLoading } = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesByIdFiles({ path: { id: workspaceId! } })
      return (data ?? []) as Array<{ type: string, name: string, path: string }>
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  })

  const { data: gitStatuses } = useQuery({
    queryKey: ['git-file-statuses', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesByIdGitStatus({ path: { id: workspaceId! } })
      const status = data as { files?: GitFileStatus[] } | null
      return (status?.files ?? []) as GitFileStatus[]
    },
    enabled: !!workspaceId,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

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

  if (isLoading) {
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
      preparedInput={preparedInput}
      gitStatus={treeGitStatus}
      onPackRequested={onPackRequested}
    />
  )
}

// ── Inner tree (mounted once model exists) ────────────────────────────────────

interface FileTreeInnerProps {
  preparedInput: ReturnType<typeof prepareFileTreeInput>
  gitStatus?: TreeGitStatus[]
  workspacePath?: string
  onPackRequested?: (paths: string[]) => void
}

function FileTreeInner({ preparedInput, gitStatus, workspacePath, onPackRequested }: FileTreeInnerProps) {
  const { model } = useFileTree({
    preparedInput,
    search: true,
    fileTreeSearchMode: 'hide-non-matches',
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

  // Update git status when it changes
  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

  // Drag handler: copy absolute path for shell insertion
  useEffect(() => {
    const container = model.getFileTreeContainer()
    if (!container || !workspacePath) {
      return
    }

    function handleDragStart(e: DragEvent) {
      const target = (e.target as HTMLElement)?.closest('[data-item-path]') as HTMLElement | null
      const itemPath = target?.dataset.itemPath
      if (itemPath) {
        const absPath = `${workspacePath}/${itemPath}`
        e.dataTransfer?.setData('text/plain', quotePath(absPath))
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'copy'
        }
      }
    }

    container.addEventListener('dragstart', handleDragStart)
    return () => container.removeEventListener('dragstart', handleDragStart)
  }, [model, workspacePath])

  return (
    <div className="flex flex-1 flex-col overflow-hidden pt-2">
      {/* Tree — library handles search UI internally */}
      <PierreFileTree
        model={model}
        className="flex-1"
        style={{
          '--trees-theme-list-active-selection-bg': 'color-mix(in oklab, var(--color-accent) 30%, transparent)',
          '--trees-theme-list-hover-bg': 'color-mix(in oklab, var(--color-accent) 14%, transparent)',
          '--trees-theme-list-inactive-selection-bg': 'color-mix(in oklab, var(--color-accent) 18%, transparent)',
          '--trees-theme-focus-ring': 'var(--color-accent)',
          '--trees-theme-foreground': 'var(--color-sidebar-foreground)',
          '--trees-theme-background': 'transparent',
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
