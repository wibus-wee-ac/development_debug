import { Link } from '@cradle/tabs-next'
import { useQueryClient } from '@tanstack/react-query'
import {
  BarChart3Icon,
  ClipboardCopyIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  GitBranchIcon,
  HomeIcon,
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
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

import { deleteSessionsById, getSessionsByIdExportMarkdown, patchSessionsById } from '~/api-gen'
import { getSessionsByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '~/components/ui/context-menu'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '~/components/ui/menu'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { KanbanSidebar } from '~/features/kanban/kanban-sidebar'
import { PackCodebaseDialog } from '~/features/pack-codebase/pack-codebase-dialog'
import { PluginsSidebar } from '~/features/plugins/plugins-sidebar'
import { GlobalSearchDialog } from '~/features/search/global-search-dialog'
import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import { useShortcut } from '~/hooks/use-shortcut'
import { cn } from '~/lib/cn'
import type { Workspace } from '~/lib/types'
import { useSessionActivityStore } from '~/store/session-activity'
import { useCradleTabStore } from '~/tabs/registry'
import { useCradleNavigation, useIsActiveTab } from '~/tabs/use-cradle-navigation'

import type { WorkspaceSession } from './use-session'
import { sessionsQueryKey, useSessions } from './use-session'
import { useAddWorkspace, useDeleteWorkspace, useWorkspaces } from './use-workspace'

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
        ? <PinIcon className="size-3 shrink-0 text-primary/60" aria-label="已置顶" data-testid={`session-pin-indicator-${sessionId}`} />
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
        {formatRelativeTime(updatedAt)}
      </span>
    </div>
  )
}

function formatRelativeTime(unixTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - unixTimestamp
  if (diff < 60) {
    return '刚刚'
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)} 分钟`
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)} 小时`
  }
  if (diff < 2592000) {
    return `${Math.floor(diff / 86400)} 天`
  }
  return `${Math.floor(diff / 2592000)} 月`
}

type SessionMenuAction = {
  key: string
  label: string
  icon: React.ReactNode
  testId: string
  invoke: () => void | Promise<void>
  variant?: 'default' | 'destructive'
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

// ── Session item ──────────────────────────────────────────────────────────────

function SessionItem({ session, workspaceId }: { session: WorkspaceSession, workspaceId: string }) {
  'use no memo'
  const isActive = useIsActiveTab('chat', { sessionId: session.id })
  const { openTab } = useCradleNavigation()
  const queryClient = useQueryClient()
  const isUnread = useSessionActivityStore(s => s.unread.has(session.id))
  const [isRenaming, setIsRenaming] = useState(false)
  const sessionTitle = session.title ?? 'Untitled'

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

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-cradle-session', session.id)
    e.dataTransfer.effectAllowed = 'move'
  }, [session.id])

  const handleDragEnd = useCallback((_e: React.DragEvent) => {
    // Detect if cursor dropped outside the current window bounds (Electron only)
    // const { screenX, screenY } = e
    // const outside = (
    //   screenX < window.screenX
    //   || screenX > window.screenX + window.outerWidth
    //   || screenY < window.screenY
    //   || screenY > window.screenY + window.outerHeight
    // )
    // if (outside) {
    //   ipc?.window.tearOffSession(session.id, screenX, screenY)
    // }
  }, [])

  const sessionActions: SessionMenuAction[] = [
    {
      key: 'rename',
      label: '重命名',
      icon: <PencilIcon />,
      testId: `session-menu-rename-${session.id}`,
      invoke: handleStartRename,
    },
    {
      key: 'toggle-pin',
      label: session.pinned ? '取消置顶' : '置顶',
      icon: session.pinned ? <PinOffIcon /> : <PinIcon />,
      testId: `session-menu-toggle-pin-${session.id}`,
      invoke: handleTogglePin,
    },
    {
      key: 'copy-markdown',
      label: '复制为 Markdown',
      icon: <ClipboardCopyIcon />,
      testId: `session-menu-copy-markdown-${session.id}`,
      invoke: handleExport,
    },
    {
      key: 'delete',
      label: '删除会话',
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
              data-testid={`session-open-${session.id}`}
              className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2.5 py-1.5 text-sidebar-foreground/80"
            >
              {session.pinned
? (
                <PinIcon className="size-3 shrink-0 text-primary/60" aria-label="已置顶" data-testid={`session-pin-indicator-${session.id}`} />
              )
: null}
              <span className="min-w-0 flex-1 truncate text-left" data-testid={`session-title-${session.id}`}>{sessionTitle}</span>
              {isUnread && !isActive && (
                <span className="shrink-0 size-1.5 rounded-full bg-primary" aria-label="新回复" />
              )}
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatRelativeTime(session.updatedAt)}
              </span>
            </Link>
            <Menu>
              <MenuTrigger
                render={(
                  <button
                    type="button"
                    className="mr-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 hover:bg-accent/80 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
                    onClick={e => e.stopPropagation()}
                    aria-label="会话菜单"
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
}: {
  workspace: Workspace
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [packOpen, setPackOpen] = useState(false)
  const { sessions } = useSessions(expanded ? workspace.id : null)
  const toggleExpanded = useCallback(() => {
    setExpanded(prev => !prev)
  }, [])

  return (
    <div className="flex min-w-0 flex-col" data-testid={`workspace-group-${workspace.id}`}>
      <div className="group flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-accent/50">
        <button
          type="button"
          onClick={toggleExpanded}
          aria-label="切换工作区折叠状态"
          className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70"
        >
          {expanded
            ? <FolderOpenIcon className="size-3.5" aria-hidden="true" />
            : <FolderClosedIcon className="size-3.5" aria-hidden="true" />}
        </button>

        <Link
          to="workspace-detail"
          params={{ workspaceId: workspace.id }}
          data-testid={`workspace-open-${workspace.id}`}
          className="flex min-w-0 flex-1 items-center text-left"
        >
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
            <MenuItem
              onClick={() => window.open(`file://${workspace.path}`, '_blank')}
            >
              <FolderOpenIcon />
              在 Finder 中打开
            </MenuItem>
            <MenuItem
              data-testid={`workspace-pack-codebase-${workspace.id}`}
              onClick={() => setPackOpen(true)}
            >
              <PackageIcon />
              复制代码库
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              onClick={() => onDelete(workspace.id)}
            >
              <Trash2Icon />
              移除工作区
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      <PackCodebaseDialog
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        open={packOpen}
        onOpenChange={setPackOpen}
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
                <p className="px-2.5 py-1.5 text-xs text-muted-foreground">暂无会话</p>
              )}
              {sessions.toSorted((a, b) => {
                const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
                if (pinDiff !== 0) {
                  return pinDiff
                }
                return b.createdAt - a.createdAt
              }).map(session => (
                <SessionItem key={session.id} session={session} workspaceId={workspace.id} />
              ))}
            </div>
          </m.div>
        )}
      </AnimatePresence>
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
  const { workspaces } = useWorkspaces()
  const { addFromPicker, adding } = useAddWorkspace()
  const { remove } = useDeleteWorkspace()
  const openSettings = useSettingsOverlayStore(s => s.openSettings)
  const handleOpenSettings = useCallback(() => {
    const activeTabId = useCradleTabStore.getState().activeTabId
    if (activeTabId) {
      openSettings(activeTabId)
    }
  }, [openSettings])
  const [searchOpen, setSearchOpen] = useState(false)

  const handleDelete = useCallback((id: string) => {
    remove(id)
  }, [remove])

  const openSearch = useCallback(() => setSearchOpen(true), [])

  useShortcut('open-thread-search', { meta: true, key: 'k' }, openSearch)
  useShortcut('open-thread-search-ctrl', { ctrl: true, key: 'k' }, openSearch)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Top navigation ── */}
      <TooltipProvider delayDuration={collapsed ? 0 : 600}>
        <nav className="flex flex-col gap-0.5 px-2 pt-1 pb-2">
          <TopNavItem
            icon={<HomeIcon className="size-3.5" />}
            label="首页"
            collapsed={collapsed}
            to="home"
            dataTestId="nav-home"
          />
          <TopNavItem
            icon={<MessageSquarePlusIcon className="size-3.5" />}
            label="新建聊天"
            collapsed={collapsed}
            to="new-chat"
            dataTestId="nav-new-chat"
          />
          <TopNavItem
            icon={<SearchIcon className="size-3.5" />}
            label="搜索"
            shortcut="⌘K"
            collapsed={collapsed}
            onClick={openSearch}
          />
          <TopNavItem
            icon={<BarChart3Icon className="size-3.5" />}
            label="用量"
            collapsed={collapsed}
            to="usage"
            dataTestId="nav-usage"
          />
          <TopNavItem
            icon={<SettingsIcon className="size-3.5" />}
            label="设置"
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
        {/* ── Kanban section ── */}
        <KanbanSidebar collapsed={collapsed} />

        {/* ── Plugins section ── */}
        <PluginsSidebar collapsed={collapsed} />

        {/* ── Projects section — always rendered, opacity fades on collapse ── */}
        <div
          className="flex min-w-0 flex-col"
          style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 120ms ease', pointerEvents: collapsed ? 'none' : undefined }}
        >
          <div className="flex items-center px-2.5 py-1.5">
            <span className="flex-1 text-[11px] font-medium text-muted-foreground select-none">
              项目
            </span>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-6 text-muted-foreground/60 hover:text-foreground hover:bg-fill/70"
                title="排列"
              >
                <SlidersHorizontalIcon className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-6 text-muted-foreground/60 hover:text-foreground hover:bg-fill/70"
                title="筛选"
              >
                <GitBranchIcon className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-6 text-muted-foreground/60 hover:text-foreground hover:bg-fill/70"
                onClick={addFromPicker}
                disabled={adding}
                title="添加项目"
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
                  <p className="text-xs font-medium text-muted-foreground">还没有项目</p>
                  <p className="text-[11px] text-muted-foreground">添加一个本地仓库开始使用</p>
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
                  添加项目
                </Button>
              </div>
            )}
            {workspaces.map(workspace => (
              <WorkspaceGroup
                key={workspace.id}
                workspace={workspace}
                onDelete={handleDelete}
              />
            ))}
          </nav>
        </div>
      </ScrollArea>

      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}
