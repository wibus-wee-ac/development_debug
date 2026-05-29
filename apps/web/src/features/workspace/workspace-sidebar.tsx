import type { ScreenCoordinates } from '@cradle/tabs-next'
import { getEventScreenCoordinates, isPointerOutsideWindow, Link } from '@cradle/tabs-next'
import { useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import {
  BarChart3Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardCopyIcon,
  CopyIcon,
  ExternalLinkIcon,
  FilePlusIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitBranchIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PackageIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deleteSessionsById,
  getSessionsByIdExportMarkdown,
  patchSessionsById,
  patchWorkspacesById,
  postWorkspacesByIdFilesFile,
  postWorkspacesByIdFilesFolder,
} from '~/api-gen'
import { getSessionsByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '~/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '~/components/ui/menu'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { ScrollArea } from '~/components/ui/scroll-area'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { PROVIDER_ICONS, RUNTIME_ICON_KEYS } from '~/features/agent-management/provider-icons'
import { KanbanSidebar } from '~/features/kanban/kanban-sidebar'
import { PackCodebaseDialog } from '~/features/pack-codebase/pack-codebase-dialog'
import { PluginsSidebar } from '~/features/plugins/plugins-sidebar'
import { useGlobalSearchStore } from '~/features/search/global-search-store'
import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import { cn } from '~/lib/cn'
import { isElectron, isTearoffWindow, nativeIpc } from '~/lib/electron'
import type { Workspace } from '~/lib/types'
import { useSessionActivityStore } from '~/store/session-activity'
import { useSessionLayoutStore } from '~/store/session-layout'
import { useCradleTabStore } from '~/tabs/registry'
import { detachTearoffSessionTab } from '~/tabs/tearoff-tabs'
import { useCradleNavigation, useIsActiveTab } from '~/tabs/use-cradle-navigation'

import type { WorkspaceSession } from './use-session'
import { sessionsQueryKey, useSessions } from './use-session'
import { useAddWorkspace, useDeleteWorkspace, useToggleWorkspacePin, useWorkspaces, WORKSPACES_QUERY_KEY } from './use-workspace'

type WorkspaceTranslation = TFunction<'workspace'>
const SESSION_PREVIEW_LIMIT = 5
const COLLAPSED_WORKSPACE_POPOVER_CLOSE_DELAY = 140
const DEFAULT_WORKSPACE_FILE_NAME = 'untitled'
const DEFAULT_WORKSPACE_FOLDER_NAME = 'untitled-folder'

function SessionRenameInput({
  initialTitle,
  sessionId,
  pinned,
  updatedAt,
  onCommit,
  onCancel,
}: {
  initialTitle: string
  sessionId: string
  pinned: boolean
  updatedAt: number
  onCommit: (nextTitle: string) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation('workspace')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      role="group"
      className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-sidebar-foreground/80"
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
    >
      {pinned
        ? <PinIcon className="size-3 shrink-0 text-primary/60" aria-label={t('session.aria.pinned')} data-testid={`session-pin-indicator-${sessionId}`} />
        : null}
      <input
        ref={renameInputRef}
        defaultValue={initialTitle}
        onBlur={(e) => { void onCommit(e.currentTarget.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void onCommit(e.currentTarget.value)
          }
          else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        data-testid={`session-rename-input-${sessionId}`}
        className="min-w-0 flex-1 bg-transparent text-left text-xs text-sidebar-foreground/90 outline-none placeholder:text-muted-foreground/40"
      />
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {formatRelativeTime(updatedAt, t)}
      </span>
    </div>
  )
}

function formatRelativeTime(unixTimestamp: number, t: WorkspaceTranslation): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - unixTimestamp
  if (diff < 60) {
    return t('session.relative.now')
  }
  if (diff < 3600) {
    return t('session.relative.minutes', { count: Math.floor(diff / 60) })
  }
  if (diff < 86400) {
    return t('session.relative.hours', { count: Math.floor(diff / 3600) })
  }
  if (diff < 2592000) {
    return t('session.relative.days', { count: Math.floor(diff / 86400) })
  }
  return t('session.relative.months', { count: Math.floor(diff / 2592000) })
}

type SessionMenuAction = {
  key: string
  label: string
  icon: React.ReactNode
  testId: string
  invoke: () => void | Promise<void>
  variant?: 'default' | 'destructive'
}

type WorkspaceMenuAction = {
  key: string
  label: string
  icon: React.ReactNode
  testId: string
  invoke: () => void | Promise<void>
  variant?: 'default' | 'destructive'
  separatorBefore?: boolean
}

function SessionMenuActionItems({ actions, surface }: { actions: SessionMenuAction[], surface: 'button' | 'context' }) {
  return actions.map((action) => {
    const content = (
      <>
        {action.icon}
        {action.label}
      </>
    )

    if (surface === 'context') {
      return (
        <Fragment key={action.key}>
          {action.variant === 'destructive' && <ContextMenuSeparator />}
          <ContextMenuItem
            variant={action.variant}
            onSelect={() => { void action.invoke() }}
            data-testid={`${action.testId}-context`}
          >
            {content}
          </ContextMenuItem>
        </Fragment>
      )
    }

    return (
      <Fragment key={action.key}>
        {action.variant === 'destructive' && <MenuSeparator />}
        <MenuItem
          variant={action.variant}
          onClick={() => { void action.invoke() }}
          data-testid={action.testId}
        >
          {content}
        </MenuItem>
      </Fragment>
    )
  })
}

function WorkspaceMenuActionItems({ actions, surface }: { actions: WorkspaceMenuAction[], surface: 'button' | 'context' }) {
  return actions.map((action) => {
    const content = (
      <>
        {action.icon}
        {action.label}
      </>
    )

    if (surface === 'context') {
      return (
        <Fragment key={action.key}>
          {action.separatorBefore && <ContextMenuSeparator />}
          <ContextMenuItem
            variant={action.variant}
            onSelect={() => { void action.invoke() }}
            data-testid={`${action.testId}-context`}
          >
            {content}
          </ContextMenuItem>
        </Fragment>
      )
    }

    return (
      <Fragment key={action.key}>
        {action.separatorBefore && <MenuSeparator />}
        <MenuItem
          variant={action.variant}
          onClick={() => { void action.invoke() }}
          data-testid={action.testId}
        >
          {content}
        </MenuItem>
      </Fragment>
    )
  })
}

function WorkspaceTextInputDialog({
  open,
  title,
  initialValue,
  label,
  confirmLabel,
  onOpenChange,
  onCommit,
}: {
  open: boolean
  title: string
  initialValue: string
  label: string
  confirmLabel: string
  onOpenChange: (open: boolean) => void
  onCommit: (value: string) => Promise<void>
}) {
  const { t } = useTranslation('workspace')
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) {
      setValue(initialValue)
    }
  }, [initialValue, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void onCommit(value)
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={event => setValue(event.currentTarget.value)}
            onFocus={event => event.currentTarget.select()}
            aria-label={label}
          />
          <DialogFooter variant="bare">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('workspace.dialog.cancel')}
            </Button>
            <Button type="submit">
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Session item ──────────────────────────────────────────────────────────────

function SessionItem({
  session,
  workspaceId,
  workspacePath,
}: {
  session: WorkspaceSession
  workspaceId: string
  workspacePath: string
}) {
  'use no memo'
  const { t } = useTranslation('workspace')
  const isActive = useIsActiveTab('chat', { sessionId: session.id })
  const { openNewTab, openTab } = useCradleNavigation()
  const queryClient = useQueryClient()
  const isUnread = useSessionActivityStore(s => s.unread.has(session.id))
  const [isRenaming, setIsRenaming] = useState(false)
  const dragPointerRef = useRef<ScreenCoordinates | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const dragWasTornOffRef = useRef(false)
  const sessionTitle = session.title ?? t('session.fallbackTitle')

  const recordSessionLayout = useCallback(() => {
    useSessionLayoutStore.getState().upsertSession({
      sessionId: session.id,
      sessionTitle,
      workspaceId: session.workspaceId ?? workspaceId,
      workspacePath,
      runtimeKind: session.runtimeKind,
    })
  }, [session.id, session.runtimeKind, session.workspaceId, sessionTitle, workspaceId, workspacePath])

  const releaseSessionDrag = useCallback(() => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
    dragPointerRef.current = null
    dragWasTornOffRef.current = false
  }, [])

  const recordDragPointer = useCallback((event: Event) => {
    const pointer = getEventScreenCoordinates(event, window)
    if (!pointer) {
      return
    }

    if (event.type.startsWith('drag') && pointer.screenX === 0 && pointer.screenY === 0 && dragPointerRef.current) {
      return
    }

    dragPointerRef.current = pointer
  }, [])
  const RuntimeIcon = PROVIDER_ICONS[RUNTIME_ICON_KEYS[session.runtimeKind]] ?? PROVIDER_ICONS.custom!

  const invalidateSessionQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: getSessionsByIdQueryKey({ path: { id: session.id } }) }),
    ])
  }, [queryClient, session.id, workspaceId])

  const handleDelete = useCallback(async () => {
    await deleteSessionsById({ path: { id: session.id } })
    queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) })
    if (isActive) {
      openTab('home')
    }
  }, [session.id, workspaceId, queryClient, isActive, openTab])

  const handleTogglePin = useCallback(async () => {
    await patchSessionsById({ path: { id: session.id }, body: { pinned: !session.pinned } })
    queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) })
  }, [session.id, session.pinned, workspaceId, queryClient])

  const handleRename = useCallback(async (nextTitleRaw: string) => {
    const nextTitle = nextTitleRaw.trim()
    setIsRenaming(false)

    if (!nextTitle || nextTitle === sessionTitle) {
      return
    }

    await patchSessionsById({ path: { id: session.id }, body: { title: nextTitle } })
    await invalidateSessionQueries()
  }, [invalidateSessionQueries, session.id, sessionTitle])

  const handleRenameCancel = useCallback(() => {
    setIsRenaming(false)
  }, [])

  const handleStartRename = useCallback(() => {
    setIsRenaming(true)
  }, [])

  const handleExport = useCallback(async () => {
    const { data } = await getSessionsByIdExportMarkdown({ path: { id: session.id } })
    const md = (data as { markdown?: string } | null)?.markdown
    if (md) {
      await navigator.clipboard.writeText(md)
    }
  }, [session.id])

  const handleOpenInNewTab = useCallback(() => {
    recordSessionLayout()
    openNewTab('chat', { sessionId: session.id })
  }, [openNewTab, recordSessionLayout, session.id])

  const handleOpenInNewWindow = useCallback(() => {
    if (!isElectron || !nativeIpc) {
      return
    }

    const screenX = window.screenX + Math.round(window.outerWidth / 2)
    const screenY = window.screenY + Math.round(window.outerHeight / 2)
    void nativeIpc.window.tearOffSession(session.id, screenX, screenY)
      .then(() => {
        if (!isTearoffWindow) {
          detachTearoffSessionTab(useCradleTabStore, session.id)
        }
      })
      .catch(() => {})
  }, [session.id])

  const checkSessionTearOff = useCallback(() => {
    if (dragWasTornOffRef.current || !isElectron || !nativeIpc) {
      return false
    }

    const pointer = dragPointerRef.current
    if (!pointer || !isPointerOutsideWindow(pointer, window)) {
      return false
    }

    dragWasTornOffRef.current = true
    dragCleanupRef.current?.()
    dragCleanupRef.current = null

    void nativeIpc.window.tearOffSession(session.id, pointer.screenX, pointer.screenY)
      .then(() => {
        if (!isTearoffWindow) {
          detachTearoffSessionTab(useCradleTabStore, session.id)
        }
      })
      .catch(() => {
        dragWasTornOffRef.current = false
      })

    return true
  }, [session.id])

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-cradle-session', session.id)
    e.dataTransfer.effectAllowed = 'move'
    recordDragPointer(e.nativeEvent)
    dragWasTornOffRef.current = false
    dragCleanupRef.current?.()

    const handleDragMove = (event: DragEvent | MouseEvent | PointerEvent | TouchEvent) => {
      recordDragPointer(event)
    }

    window.addEventListener('dragover', handleDragMove, true)
    window.addEventListener('mousemove', handleDragMove, true)
    window.addEventListener('pointermove', handleDragMove, true)
    window.addEventListener('touchmove', handleDragMove, true)
    dragCleanupRef.current = () => {
      window.removeEventListener('dragover', handleDragMove, true)
      window.removeEventListener('mousemove', handleDragMove, true)
      window.removeEventListener('pointermove', handleDragMove, true)
      window.removeEventListener('touchmove', handleDragMove, true)
    }
  }, [recordDragPointer, session.id])

  const handleDrag = useCallback((e: React.DragEvent) => {
    recordDragPointer(e.nativeEvent)
  }, [recordDragPointer])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    recordDragPointer(e.nativeEvent)
    if (!dragWasTornOffRef.current) {
      checkSessionTearOff()
    }
    releaseSessionDrag()
  }, [checkSessionTearOff, recordDragPointer, releaseSessionDrag])

  useEffect(() => {
    return releaseSessionDrag
  }, [releaseSessionDrag])

  const sessionActions: SessionMenuAction[] = [
    {
      key: 'open-new-tab',
      label: t('session.action.openInNewTab'),
      icon: <PlusIcon />,
      testId: `session-menu-open-new-tab-${session.id}`,
      invoke: handleOpenInNewTab,
    },
    ...(isElectron
      ? [
        {
          key: 'open-new-window',
          label: t('session.action.openInNewWindow'),
          icon: <ExternalLinkIcon />,
          testId: `session-menu-open-new-window-${session.id}`,
          invoke: handleOpenInNewWindow,
        },
      ]
      : []),
    {
      key: 'rename',
      label: t('session.action.rename'),
      icon: <PencilIcon />,
      testId: `session-menu-rename-${session.id}`,
      invoke: handleStartRename,
    },
    {
      key: 'toggle-pin',
      label: session.pinned ? t('session.action.unpin') : t('session.action.pin'),
      icon: session.pinned ? <PinOffIcon /> : <PinIcon />,
      testId: `session-menu-toggle-pin-${session.id}`,
      invoke: handleTogglePin,
    },
    {
      key: 'copy-markdown',
      label: t('session.action.copyMarkdown'),
      icon: <ClipboardCopyIcon />,
      testId: `session-menu-copy-markdown-${session.id}`,
      invoke: handleExport,
    },
    //
    ...(import.meta.env.DEV
      ? [
        {
          key: 'copy-session-id',
          label: t('session.action.copySessionId'),
          icon: <ClipboardCopyIcon />,
          testId: `session-menu-copy-session-id-${session.id}`,
          invoke: () => { navigator.clipboard.writeText(session.id) },
        },
      ]
      : []), // Hide export in production until we add a proper UI for it
    {
      key: 'delete',
      label: t('session.action.delete'),
      icon: <Trash2Icon />,
      testId: `session-menu-delete-${session.id}`,
      invoke: handleDelete,
      variant: 'destructive',
    },
  ]

  const itemContent = (
    <div
      draggable={!isRenaming}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      className={cn(
        'group flex min-w-0 w-full items-center rounded-lg text-left text-xs hover:bg-accent/50',
        !isRenaming && 'cursor-grab active:cursor-grabbing',
        isActive && 'bg-accent/80 text-sidebar-foreground',
      )}
      data-testid={`session-item-${session.id}`}
      data-session-pinned={session.pinned ? 'true' : 'false'}
    >
      {isRenaming
        ? (
          <SessionRenameInput
            key={`${session.id}:${sessionTitle}`}
            initialTitle={sessionTitle}
            sessionId={session.id}
            pinned={Boolean(session.pinned)}
            updatedAt={session.updatedAt}
            onCommit={handleRename}
            onCancel={handleRenameCancel}
          />
        )
        : (
          <>
            <Link
              to="chat"
              params={{ sessionId: session.id }}
              onClick={recordSessionLayout}
              onPointerDown={recordSessionLayout}
              data-testid={`session-open-${session.id}`}
              className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2.5 py-1.5 text-sidebar-foreground/80"
            >
              <RuntimeIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              {session.pinned
                ? (
                  <PinIcon className="size-3 shrink-0 text-primary/60" aria-label={t('session.aria.pinned')} data-testid={`session-pin-indicator-${session.id}`} />
                )
                : null}
              <span className="min-w-0 flex-1 truncate text-left" data-testid={`session-title-${session.id}`}>{sessionTitle}</span>
              {isUnread && !isActive && (
                <span className="shrink-0 size-1.5 rounded-full bg-primary" aria-label={t('session.aria.newReply')} />
              )}
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatRelativeTime(session.updatedAt, t)}
              </span>
            </Link>
            <Menu>
              <MenuTrigger
                render={(
                  <button
                    type="button"
                    className="mr-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 hover:bg-accent/80 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
                    onClick={e => e.stopPropagation()}
                    aria-label={t('session.aria.menu')}
                  />
                )}
                data-testid={`session-menu-trigger-${session.id}`}
              >
                <MoreHorizontalIcon className="size-3" aria-hidden="true" />
              </MenuTrigger>
              <MenuPopup align="start" side="bottom" sideOffset={4}>
                <SessionMenuActionItems actions={sessionActions} surface="button" />
              </MenuPopup>
            </Menu>
          </>
        )}
    </div>
  )

  if (isRenaming) {
    return itemContent
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {itemContent}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <SessionMenuActionItems actions={sessionActions} surface="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ── Workspace group ───────────────────────────────────────────────────────────

function WorkspaceGroup({
  workspace,
  onDelete,
  onTogglePin,
}: {
  workspace: Workspace
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
}) {
  const { t } = useTranslation('workspace')
  const queryClient = useQueryClient()
  const { openTab } = useCradleNavigation()
  const [expanded, setExpanded] = useState(true)
  const [sessionListExpanded, setSessionListExpanded] = useState(false)
  const [packOpen, setPackOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [createRequest, setCreateRequest] = useState<{
    kind: 'file' | 'folder'
  } | null>(null)
  const workspacePinned = Boolean(workspace.pinned)
  const { sessions } = useSessions(expanded ? workspace.id : null)
  const sortedSessions = useMemo(() => {
    return sessions.toSorted((a, b) => {
      const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      if (pinDiff !== 0) {
        return pinDiff
      }
      return b.createdAt - a.createdAt
    })
  }, [sessions])
  const hasHiddenSessions = sortedSessions.length > SESSION_PREVIEW_LIMIT
  const hiddenSessionCount = Math.max(sortedSessions.length - SESSION_PREVIEW_LIMIT, 0)
  const visibleSessions = sessionListExpanded
    ? sortedSessions
    : sortedSessions.slice(0, SESSION_PREVIEW_LIMIT)
  const toggleExpanded = useCallback(() => {
    setExpanded(prev => !prev)
  }, [])
  const toggleSessionListExpanded = useCallback(() => {
    setSessionListExpanded(prev => !prev)
  }, [])
  const recordWorkspaceLayout = useCallback(() => {
    useSessionLayoutStore.getState().upsertWorkspace({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspacePath: workspace.path,
    })
  }, [workspace.id, workspace.name, workspace.path])
  const handleTogglePin = useCallback(() => {
    onTogglePin(workspace.id, !workspacePinned)
  }, [onTogglePin, workspace.id, workspacePinned])
  const handleOpenWorkspace = useCallback(() => {
    recordWorkspaceLayout()
    openTab('workspace-detail', { workspaceId: workspace.id })
  }, [openTab, recordWorkspaceLayout, workspace.id])
  const handleOpenDefault = useCallback(async () => {
    if (!isElectron || !nativeIpc) {
      return
    }

    try {
      await nativeIpc.native.openPath(workspace.path)
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('workspace.toast.openDefaultFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [t, workspace.path])
  const handleRevealInFinder = useCallback(async () => {
    if (!isElectron || !nativeIpc) {
      return
    }

    try {
      await nativeIpc.native.showItemInFolder(workspace.path)
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('workspace.toast.openInFinderFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [t, workspace.path])
  const handleCopyAbsolutePath = useCallback(async () => {
    await navigator.clipboard.writeText(workspace.path)
  }, [workspace.path])
  const handleRenameWorkspace = useCallback(async (value: string) => {
    const name = value.trim()
    if (!name || name === workspace.name) {
      setRenameOpen(false)
      return
    }

    try {
      await patchWorkspacesById({ path: { id: workspace.id }, body: { name } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['workspace', workspace.id] }),
      ])
      setRenameOpen(false)
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('workspace.toast.renameFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [queryClient, t, workspace.id, workspace.name])
  const handleCreateWorkspaceChild = useCallback(async (nameValue: string) => {
    if (!createRequest) {
      return
    }

    const name = nameValue.trim()
    if (!name) {
      return
    }

    const request = {
      path: { id: workspace.id },
      body: {
        path: name,
        confirmedNonCradleOwnedWrite: true,
      },
    }
    try {
      const { data } = createRequest.kind === 'file'
        ? await postWorkspacesByIdFilesFile(request)
        : await postWorkspacesByIdFilesFolder(request)

      if (!(data as { success?: boolean } | null)?.success) {
        toastManager.add({
          type: 'error',
          title: t('workspace.toast.createFailed'),
        })
        return
      }

      await queryClient.invalidateQueries({ queryKey: ['workspace-file-search', workspace.id] })
      setCreateRequest(null)
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('workspace.toast.createFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [createRequest, queryClient, t, workspace.id])
  const workspaceActions = useMemo<WorkspaceMenuAction[]>(() => [
    {
      key: 'open',
      label: t('workspace.action.open'),
      icon: <ExternalLinkIcon />,
      testId: `workspace-open-action-${workspace.id}`,
      invoke: handleOpenWorkspace,
    },
    {
      key: 'open-default',
      label: t('workspace.action.openDefault'),
      icon: <ExternalLinkIcon />,
      testId: `workspace-open-default-${workspace.id}`,
      invoke: handleOpenDefault,
    },
    {
      key: 'open-in-finder',
      label: t('workspace.action.openInFinder'),
      icon: <FolderOpenIcon />,
      testId: `workspace-open-in-finder-${workspace.id}`,
      invoke: handleRevealInFinder,
    },
    {
      key: 'new-file',
      label: t('workspace.action.newFile'),
      icon: <FilePlusIcon />,
      testId: `workspace-new-file-${workspace.id}`,
      invoke: () => setCreateRequest({ kind: 'file' }),
      separatorBefore: true,
    },
    {
      key: 'new-folder',
      label: t('workspace.action.newFolder'),
      icon: <FolderPlusIcon />,
      testId: `workspace-new-folder-${workspace.id}`,
      invoke: () => setCreateRequest({ kind: 'folder' }),
    },
    {
      key: 'rename',
      label: t('workspace.action.rename'),
      icon: <PencilIcon />,
      testId: `workspace-rename-${workspace.id}`,
      invoke: () => setRenameOpen(true),
    },
    {
      key: 'copy-path',
      label: t('workspace.action.copyPath'),
      icon: <CopyIcon />,
      testId: `workspace-copy-path-${workspace.id}`,
      invoke: handleCopyAbsolutePath,
      separatorBefore: true,
    },
    {
      key: 'copy-relative-path',
      label: t('workspace.action.copyRelativePath'),
      icon: <ClipboardCopyIcon />,
      testId: `workspace-copy-relative-path-${workspace.id}`,
      invoke: async () => navigator.clipboard.writeText('.'),
    },
    {
      key: 'pack-codebase',
      label: t('workspace.action.packCodebase'),
      icon: <PackageIcon />,
      testId: `workspace-pack-codebase-${workspace.id}`,
      invoke: () => setPackOpen(true),
      separatorBefore: true,
    },
    {
      key: 'toggle-pin',
      label: workspacePinned ? t('workspace.action.unpin') : t('workspace.action.pin'),
      icon: workspacePinned ? <PinOffIcon /> : <PinIcon />,
      testId: `workspace-toggle-pin-${workspace.id}`,
      invoke: handleTogglePin,
    },
    {
      key: 'remove',
      label: t('workspace.action.remove'),
      icon: <Trash2Icon />,
      testId: `workspace-remove-${workspace.id}`,
      invoke: () => onDelete(workspace.id),
      variant: 'destructive',
      separatorBefore: true,
    },
  ], [
    handleCopyAbsolutePath,
    handleOpenDefault,
    handleOpenWorkspace,
    handleRevealInFinder,
    handleTogglePin,
    onDelete,
    t,
    workspace.id,
    workspacePinned,
  ])

  const headerContent = (
    <div className="group flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-accent/50">
      <button
        type="button"
        onClick={toggleExpanded}
        aria-label={t('workspace.aria.toggleExpanded')}
        className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70"
      >
        {expanded
          ? <FolderOpenIcon className="size-3.5" aria-hidden="true" />
          : <FolderClosedIcon className="size-3.5" aria-hidden="true" />}
      </button>

      <Link
        to="workspace-detail"
        params={{ workspaceId: workspace.id }}
        onClick={recordWorkspaceLayout}
        onPointerDown={recordWorkspaceLayout}
        data-testid={`workspace-open-${workspace.id}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {workspacePinned
          ? <PinIcon className="size-3 shrink-0 text-primary/60" aria-label={t('workspace.aria.pinned')} data-testid={`workspace-pin-indicator-${workspace.id}`} />
          : null}
        <span className="truncate text-xs font-medium text-sidebar-foreground/80">
          {workspace.name}
        </span>
      </Link>

      <Menu>
        <MenuTrigger
          render={(
            <Button
              variant="ghost"
              size="icon-xs"
              className="opacity-0 group-hover:opacity-100 -mr-1"
              onClick={e => e.stopPropagation()}
            />
          )}
        >
          <MoreHorizontalIcon />
        </MenuTrigger>
        <MenuPopup align="start" side="bottom" sideOffset={4}>
          <WorkspaceMenuActionItems actions={workspaceActions} surface="button" />
        </MenuPopup>
      </Menu>
    </div>
  )

  return (
    <div className="flex min-w-0 flex-col" data-testid={`workspace-group-${workspace.id}`} data-workspace-pinned={workspacePinned ? 'true' : 'false'}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {headerContent}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <WorkspaceMenuActionItems actions={workspaceActions} surface="context" />
        </ContextMenuContent>
      </ContextMenu>

      <PackCodebaseDialog
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        open={packOpen}
        onOpenChange={setPackOpen}
      />
      <WorkspaceTextInputDialog
        open={renameOpen}
        title={t('workspace.dialog.renameTitle')}
        initialValue={workspace.name}
        label={t('workspace.dialog.nameLabel')}
        confirmLabel={t('workspace.dialog.rename')}
        onOpenChange={setRenameOpen}
        onCommit={handleRenameWorkspace}
      />
      <WorkspaceTextInputDialog
        open={createRequest !== null}
        title={createRequest?.kind === 'folder' ? t('workspace.dialog.newFolderTitle') : t('workspace.dialog.newFileTitle')}
        initialValue={createRequest?.kind === 'folder' ? DEFAULT_WORKSPACE_FOLDER_NAME : DEFAULT_WORKSPACE_FILE_NAME}
        label={t('workspace.dialog.nameLabel')}
        confirmLabel={t('workspace.dialog.create')}
        onOpenChange={open => !open && setCreateRequest(null)}
        onCommit={handleCreateWorkspaceChild}
      />

      {/* Session list with expand/collapse animation */}
      <AnimatePresence initial={false}>
        {expanded && (
          <m.div
            key="sessions"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
            className="min-w-0 overflow-hidden"
          >
            <div className="ml-4.25 flex min-w-0 flex-col gap-0.5 border-l border-sidebar-border/50 pl-2 py-0.5">
              {sessions.length === 0 && (
                <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{t('session.empty')}</p>
              )}
              {visibleSessions.map(session => (
                <SessionItem key={session.id} session={session} workspaceId={workspace.id} workspacePath={workspace.path} />
              ))}
              {hasHiddenSessions && (
                <button
                  type="button"
                  onClick={toggleSessionListExpanded}
                  className="mt-0.5 flex h-6 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-left text-[11px] text-muted-foreground hover:bg-accent/50 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-expanded={sessionListExpanded}
                  data-testid={`workspace-sessions-toggle-${workspace.id}`}
                >
                  {sessionListExpanded
                    ? <ChevronUpIcon className="size-3 shrink-0" aria-hidden="true" />
                    : <ChevronDownIcon className="size-3 shrink-0" aria-hidden="true" />}
                  <span className="min-w-0 truncate">
                    {sessionListExpanded
                      ? t('session.action.showLess')
                      : t('session.action.showAll', { count: hiddenSessionCount })}
                  </span>
                </button>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CollapsedWorkspaceItem({
  workspace,
  onDelete,
  onTogglePin,
}: {
  workspace: Workspace
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  const workspacePinned = Boolean(workspace.pinned)
  const isActive = useIsActiveTab('workspace-detail', { workspaceId: workspace.id })

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current === null) {
      return
    }

    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
    }, COLLAPSED_WORKSPACE_POPOVER_CLOSE_DELAY)
  }, [cancelClose])

  useEffect(() => {
    return cancelClose
  }, [cancelClose])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'relative flex size-10 items-center justify-center rounded-lg',
                  'text-muted-foreground/70 transition-colors duration-150',
                  'hover:bg-accent/50 hover:text-sidebar-foreground',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  isActive && 'bg-accent/80 text-sidebar-foreground',
                )}
                aria-label={workspace.name}
                data-testid={`workspace-avatar-${workspace.id}`}
                onPointerEnter={() => {
                  cancelClose()
                  setOpen(true)
                }}
                onPointerLeave={scheduleClose}
                onFocus={() => {
                  cancelClose()
                  setOpen(true)
                }}
                onBlur={scheduleClose}
              >
                <FolderOpenIcon className="size-5 text-muted-foreground/70" aria-hidden="true" />
                {workspacePinned && (
                  <span className="absolute -right-0.5 -top-0.5 flex size-3 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-sidebar">
                    <PinIcon className="size-2" aria-hidden="true" />
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>{workspace.name}</TooltipContent>
          </Tooltip>
        )}
      />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={6}
        className="w-80 gap-0 p-2"
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        onOpenAutoFocus={event => event.preventDefault()}
        data-testid={`workspace-popover-${workspace.id}`}
      >
        <WorkspaceGroup
          workspace={workspace}
          onDelete={onDelete}
          onTogglePin={onTogglePin}
        />
      </PopoverContent>
    </Popover>
  )
}

function CollapsedWorkspaceRail({
  workspaces,
  onAddWorkspace,
  adding,
  onDelete,
  onTogglePin,
}: {
  workspaces: Workspace[]
  onAddWorkspace: () => void
  adding: boolean
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
}) {
  const { t } = useTranslation('workspace')

  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 px-1 py-2" data-testid="workspace-avatar-rail">
      {workspaces.map(workspace => (
        <CollapsedWorkspaceItem
          key={workspace.id}
          workspace={workspace}
          onDelete={onDelete}
          onTogglePin={onTogglePin}
        />
      ))}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mt-1 size-10 rounded-lg text-muted-foreground/70 hover:bg-accent hover:text-accent-foreground active:scale-[0.96] transition-[background-color,color,scale]"
            onClick={onAddWorkspace}
            disabled={adding}
            data-testid="add-workspace-avatar-btn"
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>{t('sidebar.action.addProject')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

// ── Top nav items ─────────────────────────────────────────────────────────────

interface NavItemProps {
  icon: React.ReactNode
  label: string
  shortcut?: string
  collapsed?: boolean
  onClick?: () => void
  to?: string
  params?: Record<string, string>
  dataTestId?: string
}

function TopNavItem({ icon, label, shortcut, collapsed, onClick, to, params, dataTestId }: NavItemProps) {
  const className = 'group flex h-7 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-sidebar-foreground/80 hover:bg-accent/50 hover:text-sidebar-foreground overflow-hidden'
  const iconNode = (
    <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70">
      {icon}
    </span>
  )

  const content = (
    <>
      {collapsed
        ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {iconNode}
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
          </Tooltip>
        )
        : (
          iconNode
        )}
      <span
        className={cn(
          'flex-1 overflow-hidden text-left whitespace-nowrap',
          collapsed ? 'opacity-0' : 'opacity-100',
        )}
      >
        {label}
      </span>
      {shortcut && (
        <span
          className={cn(
            'shrink-0 overflow-hidden font-mono text-[10px] text-muted-foreground/40 whitespace-nowrap',
            collapsed ? 'opacity-0' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {shortcut}
        </span>
      )}
    </>
  )

  if (to) {
    return (
      <Link to={to} params={params} onClick={onClick} className={className} data-testid={dataTestId}>
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
      className={className}
    >
      {content}
    </button>
  )
}

// ── Main sidebar content ──────────────────────────────────────────────────────

export function WorkspaceSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation('workspace')
  const { workspaces } = useWorkspaces()
  const { addFromPicker, adding } = useAddWorkspace()
  const { remove } = useDeleteWorkspace()
  const { togglePin } = useToggleWorkspacePin()
  const sortedWorkspaces = useMemo(() => {
    return workspaces.toSorted((a, b) => {
      const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      if (pinDiff !== 0) {
        return pinDiff
      }
      return a.name.localeCompare(b.name)
    })
  }, [workspaces])
  const openSettings = useSettingsOverlayStore(s => s.openSettings)
  const handleOpenSettings = useCallback(() => {
    const activeTabId = useCradleTabStore.getState().activeTabId
    if (activeTabId) {
      openSettings(activeTabId)
    }
  }, [openSettings])

  const handleDelete = useCallback((id: string) => {
    remove(id)
  }, [remove])

  const handleToggleWorkspacePin = useCallback((id: string, pinned: boolean) => {
    togglePin({ id, pinned })
  }, [togglePin])

  const openSearch = useCallback(() => useGlobalSearchStore.getState().openSearch(), [])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Top navigation ── */}
      <TooltipProvider delayDuration={collapsed ? 0 : 600}>
        <nav className="flex flex-col gap-0.5 px-2 pt-1 pb-2">
          <TopNavItem
            icon={<MessageSquarePlusIcon className="size-3.5" />}
            label={t('nav.newChat')}
            collapsed={collapsed}
            to="new-chat"
            dataTestId="nav-new-chat"
          />
          <TopNavItem
            icon={<SearchIcon className="size-3.5" />}
            label={t('nav.search')}
            shortcut="⌘K"
            collapsed={collapsed}
            onClick={openSearch}
            dataTestId="nav-search"
          />
          <TopNavItem
            icon={<BarChart3Icon className="size-3.5" />}
            label={t('nav.usage')}
            collapsed={collapsed}
            to="usage"
            dataTestId="nav-usage"
          />
          <TopNavItem
            icon={<SettingsIcon className="size-3.5" />}
            label={t('nav.settings')}
            shortcut="⌘,"
            collapsed={collapsed}
            onClick={handleOpenSettings}
            dataTestId="settings-btn"
          />
        </nav>
      </TooltipProvider>

      <ScrollArea
        scrollFade
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden [--scroll-area-fade-background:var(--sidebar)]"
        viewportClassName="min-w-0 max-w-full overflow-x-hidden"
        contentClassName="min-w-0 max-w-full overflow-x-hidden"
      >
        {collapsed
          ? (
            <></>
          )
          : (
            <>
              {/* ── Kanban section ── */}
              <KanbanSidebar collapsed={false} />

              {/* ── Plugins section ── */}
              <PluginsSidebar collapsed={false} />

              {/* ── Projects section ── */}
              <div className="flex min-w-0 flex-col">
                <div className="flex items-center px-2.5 py-1.5">
                  <span className="flex-1 text-[11px] font-medium text-muted-foreground select-none">
                    {t('sidebar.projects.title')}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-6 text-muted-foreground/60 hover:text-foreground hover:bg-fill/70"
                      title={t('sidebar.action.sort')}
                    >
                      <SlidersHorizontalIcon className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-6 text-muted-foreground/60 hover:text-foreground hover:bg-fill/70"
                      title={t('sidebar.action.filter')}
                      onClick={() => {
                        toastManager.add({
                          type: 'error',
                          title: t('sidebar.filterSoon.title'),
                          description: t('sidebar.filterSoon.description'),
                        })
                      }}
                    >
                      <GitBranchIcon className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-6 text-muted-foreground/60 hover:text-foreground hover:bg-fill/70"
                      onClick={addFromPicker}
                      disabled={adding}
                      title={t('sidebar.action.addProject')}
                      data-testid="add-workspace-btn"
                    >
                      <PlusIcon className="size-3" />
                    </Button>
                  </div>
                </div>

                {/* Workspace list */}
                <nav className="flex min-w-0 flex-col gap-0.5 px-2 pb-2" data-testid="workspace-list">
                  {workspaces.length === 0 && (
                    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-muted/60">
                        <FolderOpenIcon className="size-5 text-muted-foreground/50" aria-hidden="true" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <p className="text-xs font-medium text-muted-foreground">{t('sidebar.projects.empty.title')}</p>
                        <p className="text-[11px] text-muted-foreground">{t('sidebar.projects.empty.description')}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={addFromPicker}
                        disabled={adding}
                        className="mt-1 border-dashed"
                        data-testid="add-workspace-empty-btn"
                      >
                        <PlusIcon />
                        {t('sidebar.action.addProject')}
                      </Button>
                    </div>
                  )}
                  {sortedWorkspaces.map(workspace => (
                    <WorkspaceGroup
                      key={workspace.id}
                      workspace={workspace}
                      onDelete={handleDelete}
                      onTogglePin={handleToggleWorkspacePin}
                    />
                  ))}
                </nav>
              </div>
            </>
          )}
      </ScrollArea>
    </div>
  )
}
