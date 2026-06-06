import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree as PierreFileTree, useFileTree, useFileTreeSearch, useFileTreeSelection } from '@pierre/trees/react'
import { useQuery } from '@tanstack/react-query'
import {
  FilePlusIcon,
  FolderPlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '~/components/ui/button'
import { DelayedSpinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { useGitFileStatuses } from '~/features/git/use-git'
import { getServerUrl, isElectron, nativeIpc } from '~/lib/electron'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'
import type { GitFileStatus } from '~/lib/types'
import { serializeWorkspaceFileDragPayload, writeWorkspaceFileDragData } from '~/lib/workspace-drag-data'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import {
  CreateWorkspaceFileDialog,
  createWorkspaceFileEntry,
  getWorkspaceFileDefaultView,
  joinWorkspacePath,
  renameWorkspaceFilePath,
  WorkspaceFileContextMenu,
} from './workspace-file-menu'
import {
  isCopyPathChordStart,
  isCopyPathShortcut,
  isCopyRelativePathShortcut,
  WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE,
} from './workspace-file-shortcuts'

// ── Git status mapper ─────────────────────────────────────────────────────────

type TreeGitStatus = { path: string, status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'ignored' }
const WorkspaceFileListSchema = z.array(z.object({
  type: z.enum(['file', 'directory']),
  name: z.string(),
  path: z.string(),
})).default([])
const WorkspaceFileEventSchema = z.object({
  type: z.enum(['ready', 'directory-changed']),
  workspaceId: z.string(),
  path: z.string().optional(),
  reason: z.enum(['direct', 'ancestor']).optional(),
  timestamp: z.number(),
})

const ROOT_DIRECTORY_KEY = ''

type WorkspaceFileEntry = z.infer<typeof WorkspaceFileListSchema>[number]

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

function getParentDirectoryPath(path: string): string {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
  const index = normalizedPath.lastIndexOf('/')
  return index < 0 ? ROOT_DIRECTORY_KEY : normalizedPath.slice(0, index)
}

function normalizeDirectoryPath(path: string): string {
  return path.replace(/\/+$/g, '')
}

function toTreeDirectoryPath(path: string): string {
  return path.endsWith('/') ? path : `${path}/`
}

function readExpandedTreePaths(model: ReturnType<typeof useFileTree>['model'], paths: string[]): string[] {
  const expandedPaths: string[] = []
  for (const path of paths) {
    if (!path.endsWith('/')) {
      continue
    }
    const item = model.getItem(path)
    if (item?.isDirectory() && 'isExpanded' in item && item.isExpanded()) {
      expandedPaths.push(path)
    }
  }
  return expandedPaths
}

function resetFileTreePaths(
  model: ReturnType<typeof useFileTree>['model'],
  paths: string[],
  preparedInput: ReturnType<typeof prepareFileTreeInput>,
): void {
  model.resetPaths(paths, {
    preparedInput,
    initialExpandedPaths: readExpandedTreePaths(model, paths),
  })
}

async function fetchWorkspaceFileChildren(workspaceId: string, path: string): Promise<WorkspaceFileEntry[]> {
  const url = new URL(`/workspaces/${encodeURIComponent(workspaceId)}/files/children`, getServerUrl())
  if (path.length > 0) {
    url.searchParams.set('path', path)
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Workspace file children request failed with status ${response.status}.`)
  }
  return WorkspaceFileListSchema.parse(await response.json())
}

function buildWorkspaceFileEventsUrl(workspaceId: string): string {
  return new URL(`/workspaces/${encodeURIComponent(workspaceId)}/files/events`, getServerUrl()).toString()
}

// ── Main component ────────────────────────────────────────────────────────────

interface FileTreeProps {
  workspaceId: string | null
  workspacePath?: string | null
}

export function FileTree({ workspaceId, workspacePath }: FileTreeProps) {
  const { t } = useTranslation('workspace')
  const [createDialog, setCreateDialog] = useState<{
    kind: 'file' | 'folder'
    parentPath: string
  } | null>(null)
  const [childrenByDirectory, setChildrenByDirectory] = useState<Map<string, WorkspaceFileEntry[]>>(() => new Map())
  const loadedDirectoriesRef = useRef<Set<string>>(new Set())
  const loadingDirectoriesRef = useRef<Set<string>>(new Set())
  const rootChildrenQuery = useQuery({
    queryKey: ['workspace-file-children', workspaceId, ROOT_DIRECTORY_KEY],
    queryFn: async () => fetchWorkspaceFileChildren(workspaceId!, ROOT_DIRECTORY_KEY),
    enabled: !!workspaceId,
    ...queryRefreshPolicies.active,
  })

  const gitStatusQuery = useGitFileStatuses(workspaceId)

  const gitStatuses = gitStatusQuery.data

  useEffect(() => {
    setChildrenByDirectory(new Map())
    loadedDirectoriesRef.current = new Set()
    loadingDirectoriesRef.current = new Set()
  }, [workspaceId])

  useEffect(() => {
    if (!rootChildrenQuery.data) {
      return
    }
    loadedDirectoriesRef.current.add(ROOT_DIRECTORY_KEY)
    setChildrenByDirectory((current) => {
      const next = new Map(current)
      next.set(ROOT_DIRECTORY_KEY, rootChildrenQuery.data)
      return next
    })
  }, [rootChildrenQuery.data])

  const paths = useMemo(() => {
    const seen = new Set<string>()
    const entries = [...childrenByDirectory.values()].flat().filter((entry) => {
      const key = entry.type === 'directory' ? `${entry.path}/` : entry.path
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    return getFileTreeInputPaths(entries)
  }, [childrenByDirectory])

  const preparedInput = useMemo(
    () => paths.length > 0 ? prepareFileTreeInput(paths, { flattenEmptyDirectories: true }) : null,
    [paths],
  )

  const treeGitStatus = useMemo(
    () => gitStatuses ? toTreeGitStatus(gitStatuses) : undefined,
    [gitStatuses],
  )
  const refreshWorkspaceFiles = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    const directories = [...loadedDirectoriesRef.current]
    const updates = await Promise.all(directories.map(async directoryPath => [
      directoryPath,
      await fetchWorkspaceFileChildren(workspaceId, directoryPath),
    ] as const))
    setChildrenByDirectory(new Map(updates))
  }, [workspaceId])
  const loadDirectoryChildren = useCallback(async (directoryPath: string, force = false) => {
    if (!workspaceId) {
      return
    }
    const normalizedPath = normalizeDirectoryPath(directoryPath)
    if (!force && loadedDirectoriesRef.current.has(normalizedPath)) {
      return
    }
    if (loadingDirectoriesRef.current.has(normalizedPath)) {
      return
    }

    loadingDirectoriesRef.current.add(normalizedPath)
    try {
      const children = await fetchWorkspaceFileChildren(workspaceId, normalizedPath)
      loadedDirectoriesRef.current.add(normalizedPath)
      setChildrenByDirectory((current) => {
        const next = new Map(current)
        next.set(normalizedPath, children)
        return next
      })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('fileTree.toast.loadFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
    finally {
      loadingDirectoriesRef.current.delete(normalizedPath)
    }
  }, [t, workspaceId])
  useEffect(() => {
    if (!workspaceId) {
      return
    }

    const eventSource = new EventSource(buildWorkspaceFileEventsUrl(workspaceId))
    eventSource.onmessage = (event) => {
      const message = WorkspaceFileEventSchema.parse(JSON.parse(event.data))
      if (message.type !== 'directory-changed') {
        return
      }
      const path = normalizeDirectoryPath(message.path ?? ROOT_DIRECTORY_KEY)
      if (!loadedDirectoriesRef.current.has(path)) {
        return
      }
      void loadDirectoryChildren(path, true)
    }
    eventSource.onerror = () => {
      // EventSource reconnects automatically.
    }
    return () => {
      eventSource.close()
    }
  }, [loadDirectoryChildren, workspaceId])
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

  if (rootChildrenQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <DelayedSpinner active className="size-4 text-muted-foreground/40" />
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
      ready={rootChildrenQuery.isSuccess && gitStatusQuery.isSuccess}
      gitStatus={treeGitStatus}
      onDirectoryExpanded={loadDirectoryChildren}
      onRefreshDirectory={loadDirectoryChildren}
      workspacePath={workspacePath ?? undefined}
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
  onDirectoryExpanded: (path: string) => Promise<void>
  onRefreshDirectory: (path: string, force?: boolean) => Promise<void>
  workspacePath?: string
}

function FileTreeInner({ workspaceId, paths, preparedInput, ready, gitStatus, onDirectoryExpanded, onRefreshDirectory, workspacePath }: FileTreeInnerProps) {
  const { t } = useTranslation('workspace')
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
    await onRefreshDirectory(ROOT_DIRECTORY_KEY, true)
  }, [onRefreshDirectory])
  const commitRename = useCallback(async (sourcePath: string, destinationPath: string) => {
    await renameWorkspaceFilePath({
      workspaceId,
      sourcePath,
      destinationPath,
      operationFailedMessage: t('fileTree.error.operationFailed'),
    })
    await onRefreshDirectory(getParentDirectoryPath(destinationPath), true)
  }, [onRefreshDirectory, t, workspaceId])
  const handleRenameError = useCallback((error: unknown) => {
    toastManager.add({
      type: 'error',
      title: t('fileTree.toast.renameFailed'),
      description: error instanceof Error ? error.message : String(error),
    })
    void onRefreshDirectory(ROOT_DIRECTORY_KEY, true)
  }, [onRefreshDirectory, t])

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

    await onRefreshDirectory(input.parentPath, true)
    model.focusPath(input.kind === 'folder' ? `${nextPath}/` : nextPath)
  }, [model, onRefreshDirectory, t, workspaceId])
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
  const openWorkspaceFileFromTree = useCallback((path: string) => {
    openWorkspaceFile(path, getWorkspaceFileDefaultView(path))
  }, [openWorkspaceFile])
  const openPeekFromTree = useCallback((path: string) => {
    openWorkspaceFile(path, 'preview')
  }, [openWorkspaceFile])
  const revealWorkspacePath = useCallback(async (path: string) => {
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
  }, [t, workspacePath])

  useEffect(() => {
    resetFileTreePaths(model, paths, preparedInput)
  }, [model, paths, preparedInput])

  // Update git status when it changes
  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

  useEffect(() => {
    activeWorkspaceFilePathRef.current = activeWorkspaceFilePath

    if (!activeWorkspaceFilePath) {
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

    function loadDirectoryIfCollapsed(path: string | null) {
      if (!path) {
        return
      }
      const item = model.getItem(path)
      if (!item || !item.isDirectory() || !('isExpanded' in item)) {
        return
      }
      if (item.isExpanded()) {
        return
      }
      void onDirectoryExpanded(normalizeDirectoryPath(path))
    }

    function handlePointerDown(event: MouseEvent) {
      const item = getTreeItemFromEvent(event)
      if (item?.kind === 'directory') {
        loadDirectoryIfCollapsed(item.path)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'ArrowRight' && event.key !== 'Enter') {
        return
      }
      loadDirectoryIfCollapsed(model.getFocusedPath())
    }

    container.addEventListener('pointerdown', handlePointerDown, { capture: true })
    container.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      container.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [model, onDirectoryExpanded])

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
  }, [copyAbsolutePath, copyRelativePath, model, openPeekFromTree, openWorkspaceFileFromTree])

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden pt-2"
      data-testid="right-aside-file-tree"
      data-right-aside-files-ready={ready ? 'true' : 'false'}
      {...{ [WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE]: 'true' }}
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
              model.focusPath(toTreeDirectoryPath(path))
            }}
            onOpenDefault={openInDefaultApplication}
            onRename={(path) => {
              model.startRenaming(path)
            }}
            onReveal={revealWorkspacePath}
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
