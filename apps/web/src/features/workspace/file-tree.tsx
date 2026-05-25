import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree as PierreFileTree, useFileTree, useFileTreeSearch, useFileTreeSelection } from '@pierre/trees/react'
import { useQuery } from '@tanstack/react-query'
import { Loader2Icon, PackageIcon, SearchIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { getWorkspacesByIdFiles } from '~/api-gen/sdk.gen'
import { useGitFileStatuses } from '~/features/git/use-git'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'
import type { GitFileStatus } from '~/lib/types'
import { serializeWorkspaceFileDragPayload, writeWorkspaceFileDragData } from '~/lib/workspace-drag-data'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

// ── Git status mapper ─────────────────────────────────────────────────────────

type TreeGitStatus = { path: string, status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'ignored' }
const WorkspaceFileListSchema = z.array(z.object({
  type: z.enum(['file', 'directory']),
  name: z.string(),
  path: z.string(),
})).default([])
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

function getTreeItemFromEvent(event: Event): { path: string, kind: 'file' | 'directory' } | null {
  const target = event.target instanceof HTMLElement
    ? event.target.closest('[data-item-path]')
    : null

  if (target instanceof HTMLElement && target.dataset.itemPath) {
    return {
      path: target.dataset.itemPath,
      kind: target.dataset.itemType === 'folder' ? 'directory' : 'file',
    }
  }

  for (const entry of event.composedPath()) {
    if (entry instanceof HTMLElement && entry.dataset.itemPath) {
      return {
        path: entry.dataset.itemPath,
        kind: entry.dataset.itemType === 'folder' ? 'directory' : 'file',
      }
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
  const { t } = useTranslation('workspace')
  const filesQuery = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesByIdFiles({ path: { id: workspaceId! } })
      return WorkspaceFileListSchema.parse(data)
    },
    enabled: !!workspaceId,
    ...queryRefreshPolicies.active,
  })

  const gitStatusQuery = useGitFileStatuses(workspaceId)

  const gitStatuses = gitStatusQuery.data

  // Only pass file paths — @pierre/trees auto-creates directory nodes from path hierarchy
  const paths = useMemo(() => (filesQuery.data ?? []).flatMap(f => f.type === 'file' ? [f.path] : []), [filesQuery.data])

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
        <p className="text-xs text-muted-foreground">{t('fileTree.status.noWorkspace')}</p>
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
        <p className="text-xs text-muted-foreground">{t('fileTree.status.empty')}</p>
      </div>
    )
  }

  return (
    <FileTreeInner
      workspaceId={workspaceId}
      paths={paths}
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
  paths: string[]
  preparedInput: ReturnType<typeof prepareFileTreeInput>
  ready: boolean
  gitStatus?: TreeGitStatus[]
  workspacePath?: string
  onPackRequested?: (paths: string[]) => void
}

function FileTreeInner({ workspaceId, paths, preparedInput, ready, gitStatus, workspacePath, onPackRequested }: FileTreeInnerProps) {
  const { t } = useTranslation('workspace')
  const activeWorkspaceFilePath = useBrowserPanelStore((state) => {
    const activeTab = state.tabs.find(tab => tab.id === state.activeTabId)
    if (activeTab?.kind !== 'workspace-file' || activeTab.workspaceId !== workspaceId) {
      return null
    }
    return activeTab.path
  })
  const openWorkspaceFileTab = useBrowserPanelStore(state => state.openWorkspaceFileTab)
  const setBrowserPanelOpen = useLayoutStore(state => state.setBrowserPanelOpen)
  const activeWorkspaceFilePathRef = useRef<string | null>(null)

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
    // renderRowDecoration: ({ item }) => {
    //   if (item.kind !== 'file' || item.path !== activeWorkspaceFilePathRef.current) {
    //     return null
    //   }
    //   return { text: 'OPEN', title: 'Active editor tab' }
    // },
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

  const openWorkspaceFile = useCallback((path: string, view: 'editor' | 'preview') => {
    openWorkspaceFileTab({ workspaceId, path, view })
    setBrowserPanelOpen(true)
  }, [openWorkspaceFileTab, setBrowserPanelOpen, workspaceId])
  const startDragFromTree = useEffectEvent((event: DragEvent) => {
    const itemPath = getDraggedTreeItemPath(event)
    if (!itemPath || !event.dataTransfer) {
      return
    }

    writeWorkspaceFileDragData(
      event.dataTransfer,
      serializeWorkspaceFileDragPayload({ relativePath: itemPath, workspacePath }),
    )
    event.dataTransfer.effectAllowed = 'copy'
  })
  const openWorkspaceFileFromTree = useEffectEvent((path: string) => {
    openWorkspaceFile(path, 'editor')
  })
  const openPeekFromTree = useEffectEvent((path: string) => {
    openWorkspaceFile(path, 'preview')
  })

  useEffect(() => {
    model.resetPaths(paths, { preparedInput })
  }, [model, paths, preparedInput])

  // Update git status when it changes
  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

  useEffect(() => {
    activeWorkspaceFilePathRef.current = activeWorkspaceFilePath

    if (!activeWorkspaceFilePath) {
      model.resetPaths(paths, { preparedInput })
      return
    }

    const item = model.getItem(activeWorkspaceFilePath)
    if (!item || item.isDirectory()) {
      return
    }

    for (const selectedPath of model.getSelectedPaths()) {
      if (selectedPath !== activeWorkspaceFilePath) {
        model.getItem(selectedPath)?.deselect()
      }
    }
    if (!item.isSelected()) {
      item.select()
    }
    item.focus()
  }, [activeWorkspaceFilePath, model, paths, preparedInput])

  // Drag handler: expose workspace file paths to chat and TUI drop targets.
  useEffect(() => {
    const container = model.getFileTreeContainer()
    if (!container) {
      return
    }

    function handleDragStart(event: DragEvent) {
      startDragFromTree(event)
    }

    container.addEventListener('dragstart', handleDragStart)
    return () => container.removeEventListener('dragstart', handleDragStart)
  }, [model])

  useEffect(() => {
    const container = model.getFileTreeContainer()
    if (!container) {
      return
    }

    function handleDoubleClick(event: MouseEvent) {
      const item = getTreeItemFromEvent(event)
      if (!item || item.kind !== 'file') {
        return
      }
      event.preventDefault()
      model.focusPath(item.path)
      const handle = model.getItem(item.path)
      handle?.select()
      openWorkspaceFileFromTree(item.path)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return
      }
      const selectedPath = model.getFocusedPath() ?? model.getSelectedPaths()[0]
      if (!selectedPath) {
        return
      }
      const selectedItem = model.getItem(selectedPath)
      if (!selectedItem || selectedItem.isDirectory()) {
        return
      }
      event.preventDefault()
      openPeekFromTree(selectedPath)
    }

    container.addEventListener('dblclick', handleDoubleClick)
    container.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('dblclick', handleDoubleClick)
      container.removeEventListener('keydown', handleKeyDown)
    }
  }, [model])

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
            placeholder={t('fileTree.search.placeholder')}
            aria-label={t('fileTree.search.aria')}
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/45"
          />
          {hasSearchValue && (
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55" data-testid="right-aside-file-search-count">
              {search.matchingPaths.length}
            </span>
          )}
          {hasSearchValue && (
            <button
              type="button"
              onClick={() => search.setValue('')}
              aria-label={t('fileTree.action.clearSearch')}
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
              label={t('fileTree.action.copyPath')}
              onClick={() => {
                const absPath = workspacePath ? `${workspacePath}/${item.path}` : item.path
                navigator.clipboard.writeText(absPath)
                context.close({ restoreFocus: true })
              }}
            />
            <ContextMenuItem
              label={t('fileTree.action.copyRelativePath')}
              onClick={() => {
                navigator.clipboard.writeText(item.path)
                context.close({ restoreFocus: true })
              }}
            />
            {workspacePath && (
              <ContextMenuItem
                label={t('fileTree.action.revealInFinder')}
                onClick={() => {
                  context.close({ restoreFocus: true })
                }}
              />
            )}
            {onPackRequested && (
              <>
                <div className="mx-1 my-1 h-px bg-border/60" />
                <ContextMenuItem
                  label={t('fileTree.action.packToAi')}
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
            {selectedPaths.length === 1 ? selectedPaths[0] : t('fileTree.selection.files', { count: selectedPaths.length })}
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
