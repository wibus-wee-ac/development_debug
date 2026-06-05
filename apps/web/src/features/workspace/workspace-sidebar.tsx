import type { ScreenCoordinates } from '@cradle/tabs-next'
import { getEventScreenCoordinates, isPointerOutsideWindow, Link } from '@cradle/tabs-next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import {
  ArchiveIcon,
  BarChart3Icon,
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  ClipboardCopyIcon,
  CopyIcon,
  ExternalLinkIcon,
  FilePlusIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  MailIcon,
  MailOpenIcon,
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
  UserCircleIcon,
} from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shallow } from 'zustand/shallow'

import {
  getSessionsByIdExportMarkdown,
  patchSessionsById,
  postSessionsByIdArchive,
} from '~/api-gen'
import {
  getSessionsByIdQueryKey,
  patchWorkspacesByIdMutation,
  postWorkspacesByIdFilesFileMutation,
  postWorkspacesByIdFilesFolderMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import { PROVIDER_ICONS, RUNTIME_ICON_KEYS } from '~/components/common/provider-icons'
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
import { ScrollArea } from '~/components/ui/scroll-area'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { prefetchChatSession } from '~/features/chat/chat-session-prefetch'
import { KanbanSidebar } from '~/features/kanban/kanban-sidebar'
import { PackCodebaseDialog } from '~/features/pack-codebase/pack-codebase-dialog'
import { PluginsSidebar } from '~/features/plugins/plugins-sidebar'
import { useGlobalSearchStore } from '~/features/search/global-search-store'
import { cn } from '~/lib/cn'
import { isElectron, isTearoffWindow, nativeIpc } from '~/lib/electron'
import type { Workspace } from '~/lib/types'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useSessionActivityStore } from '~/store/session-activity'
import { useSessionLayoutStore } from '~/store/session-layout'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
import { useCradleTabStore } from '~/tabs/registry'
import { detachTearoffSessionTab, releaseTearoffSession, reserveTearoffSession } from '~/tabs/tearoff-tabs'
import { useCradleNavigation, useIsActiveTab } from '~/tabs/use-cradle-navigation'

import type { WorkspaceSession } from './use-session'
import { sessionsQueryKey, useAllSessions } from './use-session'
import { useAddWorkspace, useDeleteWorkspace, useToggleWorkspacePin, useWorkspaces, WORKSPACES_QUERY_KEY } from './use-workspace'

type WorkspaceTranslation = TFunction<'workspace'>
const SESSION_PREVIEW_LIMIT = 5
const DEFAULT_WORKSPACE_FILE_NAME = 'untitled'
const DEFAULT_WORKSPACE_FOLDER_NAME = 'untitled-folder'

function isSessionRunning(session: WorkspaceSession, locallyStreamingSessionIds: Set<string>): boolean {
  return session.status === 'streaming' || locallyStreamingSessionIds.has(session.id)
}

function SessionRenameInput({
  initialTitle,
  sessionId,
  pinned,
  listActivityAt,
  onCommit,
  onCancel,
}: {
  initialTitle: string
  sessionId: string
  pinned: boolean
  listActivityAt: number
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
        {formatRelativeTime(listActivityAt, t)}
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

const SessionItem = memo(({
  session,
  workspaceId,
  workspacePath,
  onOpenSession,
}: {
  session: WorkspaceSession
  workspaceId: string
  workspacePath: string
  onOpenSession?: (sessionId: string) => void
}) => {
  const { t } = useTranslation('workspace')
  const isActive = useIsActiveTab('chat', { sessionId: session.id })
  const { openNewTab } = useCradleNavigation()
  const queryClient = useQueryClient()
  const isUnread = useSessionActivityStore(s => s.unread.has(session.id))
  const hasLocalStreamingState = useChatStore(chatSelectors.isSessionStreaming(session.id))
  const isStreaming = session.status === 'streaming' || hasLocalStreamingState
  const latestLocalError = useChatStore(chatSelectors.latestError(session.id))
  const hasError = !isStreaming && (session.status === 'error' || Boolean(latestLocalError))
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

  const prefetchSession = useCallback(() => {
    prefetchChatSession(queryClient, session.id)
  }, [queryClient, session.id])

  const prepareSessionOpen = useCallback(() => {
    onOpenSession?.(session.id)
    recordSessionLayout()
    prefetchSession()
  }, [onOpenSession, prefetchSession, recordSessionLayout, session.id])

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
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getSessionsByIdQueryKey({ path: { id: session.id } }) }),
    ])
  }, [queryClient, session.id, workspaceId])

  const handleArchive = useCallback(async () => {
    await postSessionsByIdArchive({ path: { id: session.id }, body: { archived: true } })

    const { tabs, closeTab } = useCradleTabStore.getState()
    for (const tab of tabs) {
      if (tab.type === 'chat' && tab.params.sessionId === session.id) {
        closeTab(tab.id)
      }
    }

    if (isElectron) {
      void nativeIpc?.window.closeSession(session.id).catch(() => {})
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getSessionsByIdQueryKey({ path: { id: session.id } }) }),
    ])
  }, [session.id, workspaceId, queryClient])

  const handleTogglePin = useCallback(async () => {
    await patchSessionsById({ path: { id: session.id }, body: { pinned: !session.pinned } })
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
    ])
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

  function handleToggleReadState() {
    const { markRead, markUnread } = useSessionActivityStore.getState()
    if (isUnread) {
      markRead(session.id)
      return
    }
    markUnread(session.id)
  }

  const handleOpenInNewTab = useCallback(() => {
    recordSessionLayout()
    openNewTab('chat', { sessionId: session.id })
  }, [openNewTab, recordSessionLayout, session.id])

  const handleOpenInNewWindow = useCallback(() => {
    if (!isElectron || !nativeIpc) {
      return
    }

    prepareSessionOpen()
    const screenX = window.screenX + Math.round(window.outerWidth / 2)
    const screenY = window.screenY + Math.round(window.outerHeight / 2)
    if (!reserveTearoffSession(session.id)) {
      return
    }

    void nativeIpc.window.tearOffSession(session.id, screenX, screenY)
      .then(() => {
        if (!isTearoffWindow) {
          detachTearoffSessionTab(useCradleTabStore, session.id)
        }
      })
      .catch(() => {
        releaseTearoffSession(session.id)
      })
  }, [prepareSessionOpen, session.id])

  function handleSessionDoubleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    e.stopPropagation()
    handleOpenInNewWindow()
  }

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
    if (!reserveTearoffSession(session.id)) {
      return true
    }

    void nativeIpc.window.tearOffSession(session.id, pointer.screenX, pointer.screenY)
      .then(() => {
        if (!isTearoffWindow) {
          detachTearoffSessionTab(useCradleTabStore, session.id)
        }
      })
      .catch(() => {
        releaseTearoffSession(session.id)
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
      key: 'toggle-read-state',
      label: isUnread ? t('session.action.markRead') : t('session.action.markUnread'),
      icon: isUnread ? <MailOpenIcon /> : <MailIcon />,
      testId: `session-menu-toggle-read-state-${session.id}`,
      invoke: handleToggleReadState,
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
      key: 'archive',
      label: t('session.action.archive'),
      icon: <ArchiveIcon />,
      testId: `session-menu-archive-${session.id}`,
      invoke: handleArchive,
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
            listActivityAt={session.listActivityAt}
            onCommit={handleRename}
            onCancel={handleRenameCancel}
          />
        )
        : (
          <>
            <Link
              to="chat"
              params={{ sessionId: session.id }}
              onClick={prepareSessionOpen}
              onDoubleClick={isElectron ? handleSessionDoubleClick : undefined}
              onFocus={prefetchSession}
              onPointerDown={prepareSessionOpen}
              onPointerEnter={prefetchSession}
              data-testid={`session-open-${session.id}`}
              className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2.5 py-1.5 text-sidebar-foreground/80"
            >
              {hasError
                ? (
                  <CircleAlertIcon
                    className="size-3.5 shrink-0 text-destructive/80"
                    aria-label={t('session.aria.error')}
                    data-testid={`session-error-indicator-${session.id}`}
                  />
                )
                : (
                  <RuntimeIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                )}
              {session.pinned
                ? (
                  <PinIcon className="size-3 shrink-0 text-primary/60" aria-label={t('session.aria.pinned')} data-testid={`session-pin-indicator-${session.id}`} />
                )
                : null}
              <span className="min-w-0 flex-1 truncate text-left" data-testid={`session-title-${session.id}`}>{sessionTitle}</span>
              {isUnread && !isActive && !isStreaming && (
                <span className="shrink-0 size-1.5 rounded-full bg-primary" aria-label={t('session.aria.newReply')} />
              )}
              {isStreaming
                ? (
                  <LoaderCircleIcon
                    className="size-3.5 shrink-0 animate-spin text-muted-foreground/70"
                    aria-label={t('session.aria.running')}
                    data-testid={`session-running-indicator-${session.id}`}
                  />
                )
                : (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatRelativeTime(session.listActivityAt, t)}
                  </span>
                )}
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
})
SessionItem.displayName = 'SessionItem'

// ── Workspace group ───────────────────────────────────────────────────────────

const WorkspaceGroup = memo(({
  workspace,
  sessions,
  onDelete,
  onTogglePin,
}: {
  workspace: Workspace
  sessions: WorkspaceSession[]
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
}) => {
  const { t } = useTranslation('workspace')
  const queryClient = useQueryClient()
  const { openTab } = useCradleNavigation()
  const [expanded, setExpanded] = useState(true)
  const [sessionListExpanded, setSessionListExpanded] = useState(false)
  const [packOpen, setPackOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [retainedSessionIds, setRetainedSessionIds] = useState<Set<string>>(() => new Set())
  const acknowledgedSessionIdsRef = useRef<Set<string> | null>(null)
  if (acknowledgedSessionIdsRef.current === null) {
    acknowledgedSessionIdsRef.current = new Set()
  }
  const [createRequest, setCreateRequest] = useState<{
    kind: 'file' | 'folder'
  } | null>(null)
  const workspacePinned = Boolean(workspace.pinned)
  const workspaceSessionIds = useMemo(() => sessions.map(session => session.id), [sessions])
  const locallyStreamingSessionIds = useChatStore(
    useCallback(
      state => new Set(workspaceSessionIds.filter(sessionId => chatSelectors.isSessionStreaming(sessionId)(state))),
      [workspaceSessionIds],
    ),
    shallow,
  )
  const { mutateAsync: renameWorkspace } = useMutation({
    ...patchWorkspacesByIdMutation(),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['workspace', workspace.id] }),
      ])
    },
  })
  const { mutateAsync: createWorkspaceFile } = useMutation(postWorkspacesByIdFilesFileMutation())
  const { mutateAsync: createWorkspaceFolder } = useMutation(postWorkspacesByIdFilesFolderMutation())
  const sortedSessions = useMemo(() => {
    return sessions.toSorted((a, b) => {
      const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      if (pinDiff !== 0) {
        return pinDiff
      }
      const runningDiff = (isSessionRunning(b, locallyStreamingSessionIds) ? 1 : 0) - (isSessionRunning(a, locallyStreamingSessionIds) ? 1 : 0)
      if (runningDiff !== 0) {
        return runningDiff
      }
      return 0
    })
  }, [locallyStreamingSessionIds, sessions])
  const requiredPreviewCount = useMemo(() => {
    let highestRequiredIndex = -1
    for (const [index, session] of sortedSessions.entries()) {
      if (session.pinned || isSessionRunning(session, locallyStreamingSessionIds) || retainedSessionIds.has(session.id)) {
        highestRequiredIndex = index
      }
    }
    return highestRequiredIndex + 1
  }, [locallyStreamingSessionIds, retainedSessionIds, sortedSessions])
  const collapsedSessionPreviewLimit = Math.max(SESSION_PREVIEW_LIMIT, requiredPreviewCount)
  const hasHiddenSessions = sortedSessions.length > collapsedSessionPreviewLimit
  const hiddenSessionCount = Math.max(sortedSessions.length - collapsedSessionPreviewLimit, 0)
  const visibleSessions = sessionListExpanded
    ? sortedSessions
    : sortedSessions.slice(0, collapsedSessionPreviewLimit)

  useEffect(() => {
    setRetainedSessionIds((current) => {
      let changed = false
      const next = new Set<string>()
      const knownSessionIds = new Set(workspaceSessionIds)

      for (const sessionId of current) {
        if (knownSessionIds.has(sessionId)) {
          next.add(sessionId)
        }
        else {
          changed = true
        }
      }

      for (const session of sessions) {
        if (
          isSessionRunning(session, locallyStreamingSessionIds)
          && !acknowledgedSessionIdsRef.current!.has(session.id)
          && !next.has(session.id)
        ) {
          next.add(session.id)
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [locallyStreamingSessionIds, sessions, workspaceSessionIds])

  const handleOpenSession = useCallback((sessionId: string) => {
    acknowledgedSessionIdsRef.current!.add(sessionId)
    setRetainedSessionIds((current) => {
      if (!current.has(sessionId)) {
        return current
      }
      const next = new Set(current)
      next.delete(sessionId)
      return next
    })
  }, [])

  useEffect(() => {
    const next = new Set<string>()
    const sessionsById = new Map<string, WorkspaceSession>()
    for (const session of sessions) {
      sessionsById.set(session.id, session)
    }

    for (const sessionId of acknowledgedSessionIdsRef.current!) {
      const session = sessionsById.get(sessionId)
      if (session && isSessionRunning(session, locallyStreamingSessionIds)) {
        next.add(sessionId)
      }
    }

    acknowledgedSessionIdsRef.current! = next
  }, [locallyStreamingSessionIds, sessions])
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
      await renameWorkspace({ path: { id: workspace.id }, body: { name } })
      setRenameOpen(false)
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('workspace.toast.renameFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [renameWorkspace, t, workspace.id, workspace.name])
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
      const data = createRequest.kind === 'file'
        ? await createWorkspaceFile(request)
        : await createWorkspaceFolder(request)

      if (!data.success) {
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
  }, [createRequest, createWorkspaceFile, createWorkspaceFolder, queryClient, t, workspace.id])
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
                <SessionItem
                  key={session.id}
                  session={session}
                  workspaceId={workspace.id}
                  workspacePath={workspace.path}
                  onOpenSession={handleOpenSession}
                />
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
})
WorkspaceGroup.displayName = 'WorkspaceGroup'

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

interface WorkspaceSidebarBodyProps {
  workspaces: Workspace[]
  sessionsByWorkspaceId: Map<string, WorkspaceSession[]>
  adding: boolean
  onAddFromPicker: () => void
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
}

const WorkspaceSidebarBody = memo(({
  workspaces,
  sessionsByWorkspaceId,
  adding,
  onAddFromPicker,
  onDelete,
  onTogglePin,
}: WorkspaceSidebarBodyProps) => {
  const { t } = useTranslation('workspace')

  return (
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
              onClick={onAddFromPicker}
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
                onClick={onAddFromPicker}
                disabled={adding}
                className="mt-1 border-dashed"
                data-testid="add-workspace-empty-btn"
              >
                <PlusIcon />
                {t('sidebar.action.addProject')}
              </Button>
            </div>
          )}
          {workspaces.map(workspace => (
            <WorkspaceGroup
              key={workspace.id}
              workspace={workspace}
              sessions={sessionsByWorkspaceId.get(workspace.id) ?? []}
              onDelete={onDelete}
              onTogglePin={onTogglePin}
            />
          ))}
        </nav>
      </div>
    </>
  )
})
WorkspaceSidebarBody.displayName = 'WorkspaceSidebarBody'

export function WorkspaceSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation('workspace')
  const { workspaces } = useWorkspaces()
  const { sessions } = useAllSessions()
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
  const sessionsByWorkspaceId = useMemo(() => {
    const grouped = new Map<string, WorkspaceSession[]>()
    for (const session of sessions) {
      if (!session.workspaceId) {
        continue
      }

      const workspaceSessions = grouped.get(session.workspaceId)
      if (workspaceSessions) {
        workspaceSessions.push(session)
      }
      else {
        grouped.set(session.workspaceId, [session])
      }
    }
    return grouped
  }, [sessions])
  const openSettings = useSettingsOverlayStore(s => s.openSettings)
  const handleOpenSettings = useCallback(() => {
    const activeTabId = useCradleTabStore.getState().activeTabId
    if (activeTabId) {
      openSettings(activeTabId)
    }
  }, [openSettings])

  const handleDelete = useCallback((id: string) => {
    remove({ path: { id } })
  }, [remove])

  const handleToggleWorkspacePin = useCallback((id: string, pinned: boolean) => {
    togglePin({ path: { id }, body: { pinned } })
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
            icon={<CalendarClockIcon className="size-3.5" />}
            label={t('nav.automation')}
            collapsed={collapsed}
            to="automation"
            dataTestId="nav-automation"
          />
          <TopNavItem
            icon={<UserCircleIcon className="size-3.5" />}
            label={t('nav.profile')}
            collapsed={collapsed}
            to="profile"
            dataTestId="nav-profile"
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
        <div className={cn(collapsed ? 'hidden' : 'contents')}>
          <WorkspaceSidebarBody
            workspaces={sortedWorkspaces}
            sessionsByWorkspaceId={sessionsByWorkspaceId}
            adding={adding}
            onAddFromPicker={addFromPicker}
            onDelete={handleDelete}
            onTogglePin={handleToggleWorkspacePin}
          />
        </div>
      </ScrollArea>
    </div>
  )
}
