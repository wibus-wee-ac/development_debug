import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree as PierreFileTree, useFileTree, useFileTreeSearch, useFileTreeSelection } from '@pierre/trees/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FilePlusIcon,
  FolderPlusIcon,
  Loader2Icon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { getWorkspacesByIdFiles } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { toastManager } from '~/components/ui/toast'
import { useGitFileStatuses } from '~/features/git/use-git'
import { isElectron, nativeIpc } from '~/lib/electron'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'
import type { GitFileStatus } from '~/lib/types'
import { serializeWorkspaceFileDragPayload, writeWorkspaceFileDragData } from '~/lib/workspace-drag-data'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import {
  CreateWorkspaceFileDialog,
  createWorkspaceFileEntry,
  getWorkspaceFileDefaultView,
  isCopyPathChordStart,
  isCopyPathShortcut,
  isCopyRelativePathShortcut,
  joinWorkspacePath,
  renameWorkspaceFilePath,
  WorkspaceFileContextMenu,
} from './workspace-file-menu'

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

function getFileTreeInputPaths(entries: z.infer<typeof WorkspaceFileListSchema>): string[] {
  return entries.map(entry => entry.type === 'directory' ? `${entry.path}/` : entry.path)
}

// ── Main component ────────────────────────────────────────────────────────────

interface FileTreeProps {
  workspaceId: string | null
  workspacePath?: string | null
  onPackRequested?: (paths: string[]) => void
}

export function FileTree({ workspaceId, workspacePath, onPackRequested }: FileTreeProps) {
  const { t } = useTranslation('workspace')
  const queryClient = useQueryClient()
  const [createDialog, setCreateDialog] = useState<{
    kind: 'file' | 'folder'
    parentPath: string
  } | null>(null)
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

  const paths = useMemo(() => getFileTreeInputPaths(filesQuery.data ?? []), [filesQuery.data])

  const preparedInput = useMemo(
    () => paths.length > 0 ? prepareFileTreeInput(paths, { flattenEmptyDirectories: true }) : null,
    [paths],
  )

  const treeGitStatus = useMemo(
    () => gitStatuses ? toTreeGitStatus(gitStatuses) : undefined,
    [gitStatuses],
  )
  const refreshWorkspaceFiles = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['workspace-files', workspaceId] })
  }, [queryClient, workspaceId])
  const commitCreate = useCallback(async (input: { kind: 'file' | 'folder', parentPath: string, name: string }) => {
    if (!workspaceId) {
      return null
    }

    return createWorkspaceFileEntry({
      workspaceId,
      kind: input.kind,
      parentPath: input.parentPath,
      name: input.name,
      operationFailedMessage: t('fileTree.error.operationFailed'),
    })
  }, [t, workspaceId])

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
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-xs text-muted-foreground">{t('fileTree.status.empty')}</p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setCreateDialog({ kind: 'file', parentPath: '' })}
          >
            <FilePlusIcon />
            {t('fileTree.action.newFile')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setCreateDialog({ kind: 'folder', parentPath: '' })}
          >
            <FolderPlusIcon />
            {t('fileTree.action.newFolder')}
          </Button>
        </div>
        <CreateWorkspaceFileDialog
          request={createDialog}
          onOpenChange={open => !open && setCreateDialog(null)}
          onCommit={async (name) => {
            if (!createDialog) {
              return
            }
            try {
              await commitCreate({ ...createDialog, name })
              await refreshWorkspaceFiles()
              setCreateDialog(null)
            }
            catch (error) {
              toastManager.add({
                type: 'error',
                title: t('fileTree.toast.createFailed'),
                description: error instanceof Error ? error.message : String(error),
              })
              void refreshWorkspaceFiles()
            }
          }}
          t={t}
        />
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
  const queryClient = useQueryClient()
  const [createDialog, setCreateDialog] = useState<{
    kind: 'file' | 'folder'
    parentPath: string
  } | null>(null)
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
  const copyPathChordActiveRef = useRef(false)
  const refreshWorkspaceFiles = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['workspace-files', workspaceId] })
  }, [queryClient, workspaceId])
  const commitRename = useEffectEvent(async (sourcePath: string, destinationPath: string) => {
    await renameWorkspaceFilePath({
      workspaceId,
      sourcePath,
      destinationPath,
      operationFailedMessage: t('fileTree.error.operationFailed'),
    })
    await refreshWorkspaceFiles()
  })
  const handleRenameError = useEffectEvent((error: unknown) => {
    toastManager.add({
      type: 'error',
      title: t('fileTree.toast.renameFailed'),
      description: error instanceof Error ? error.message : String(error),
    })
    void refreshWorkspaceFiles()
  })

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
    renaming: {
      onError: handleRenameError,
      onRename: (event) => {
        void commitRename(event.sourcePath, event.destinationPath).catch(handleRenameError)
      },
    },
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
  const copyRelativePath = useCallback(async (path: string) => {
    await navigator.clipboard.writeText(path)
  }, [])
  const copyAbsolutePath = useCallback(async (path: string) => {
    await navigator.clipboard.writeText(workspacePath ? joinWorkspacePath(workspacePath, path) : path)
  }, [workspacePath])
  const openInDefaultApplication = useCallback(async (path: string) => {
    if (!workspacePath || !isElectron || !nativeIpc) {
      return
    }

    try {
      await nativeIpc.native.openPath(joinWorkspacePath(workspacePath, path))
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('fileTree.toast.openDefaultFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [t, workspacePath])
  const commitCreate = useCallback(async (input: { kind: 'file' | 'folder', parentPath: string, name: string }) => {
    const nextPath = await createWorkspaceFileEntry({
      workspaceId,
      kind: input.kind,
      parentPath: input.parentPath,
      name: input.name,
      operationFailedMessage: t('fileTree.error.operationFailed'),
    })
    if (!nextPath) {
      return
    }

    await refreshWorkspaceFiles()
    model.focusPath(input.kind === 'folder' ? `${nextPath}/` : nextPath)
  }, [model, refreshWorkspaceFiles, t, workspaceId])
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
    openWorkspaceFile(path, getWorkspaceFileDefaultView(path))
  })
  const openPeekFromTree = useEffectEvent((path: string) => {
    openWorkspaceFile(path, 'preview')
  })
  const revealWorkspacePath = useEffectEvent(async (path: string) => {
    if (!workspacePath || !isElectron || !nativeIpc) {
      return
    }

    try {
      await nativeIpc.native.showItemInFolder(joinWorkspacePath(workspacePath, path))
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('fileTree.toast.revealFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
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
      const selectedPath = model.getFocusedPath() ?? model.getSelectedPaths()[0]
      if (isCopyPathChordStart(event)) {
        event.preventDefault()
        copyPathChordActiveRef.current = true
        return
      }
      if (copyPathChordActiveRef.current) {
        copyPathChordActiveRef.current = false
        if (isCopyPathShortcut(event) && selectedPath) {
          event.preventDefault()
          void copyAbsolutePath(selectedPath)
        }
        return
      }
      if (isCopyRelativePathShortcut(event) && selectedPath) {
        event.preventDefault()
        void copyRelativePath(selectedPath)
        return
      }
      if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return
      }
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
  }, [copyAbsolutePath, copyRelativePath, model])

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
          <WorkspaceFileContextMenu
            context={context}
            item={item}
            onCopyAbsolutePath={copyAbsolutePath}
            onCopyRelativePath={copyRelativePath}
            onCreateRequest={(kind, parentPath) => setCreateDialog({ kind, parentPath })}
            onOpen={(path, kind) => {
              if (kind === 'file') {
                openWorkspaceFile(path, getWorkspaceFileDefaultView(path))
                return
              }
              model.focusPath(path)
            }}
            onOpenDefault={openInDefaultApplication}
            onPackRequested={onPackRequested}
            onRename={(path) => {
              model.startRenaming(path)
            }}
            onReveal={revealWorkspacePath}
            selectedPaths={selectedPaths}
            t={t}
            workspacePath={workspacePath}
          />
        )}
      />

      <CreateWorkspaceFileDialog
        request={createDialog}
        onOpenChange={open => !open && setCreateDialog(null)}
        onCommit={async (name) => {
          if (!createDialog) {
            return
          }
          try {
            await commitCreate({ ...createDialog, name })
            setCreateDialog(null)
          }
          catch (error) {
            toastManager.add({
              type: 'error',
              title: t('fileTree.toast.createFailed'),
              description: error instanceof Error ? error.message : String(error),
            })
            void refreshWorkspaceFiles()
          }
        }}
        t={t}
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
