// Input: useWorkspaces, useSessions hooks, workspace/session types, coss UI primitives, router Link, ThreadSearchDialog
// Output: WorkspaceSidebar component with top nav, workspace groups and session items
// Position: Main sidebar feature component for workspace navigation

import { Button } from '@renderer/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@renderer/components/ui/menu'
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { ThreadSearchDialog } from '@renderer/features/search'
import { useShortcut } from '@renderer/hooks/use-shortcut'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc'
import { useSessionActivityStore } from '@renderer/store/session-activity'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useMatchRoute, useNavigate } from '@tanstack/react-router'
import {
  AlignJustifyIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  GitBranchIcon,
  LayoutDashboardIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  ZapIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'

import { sessionsQueryKey, useSessions } from './use-session'
import { useAddWorkspace, useDeleteWorkspace, useWorkspaces } from './use-workspace'

type Workspace = Awaited<ReturnType<typeof window.ipc.workspace.list>>[number]
type Session = Awaited<ReturnType<typeof window.ipc.session.list>>[number]

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

// ── Session item ──────────────────────────────────────────────────────────────

function SessionItem({ session, workspaceId }: { session: Session, workspaceId: string }) {
  'use no memo'
  const matchRoute = useMatchRoute()
  const isActive = !!matchRoute({ to: '/chat/$sessionId', params: { sessionId: session.id } })
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const isUnread = useSessionActivityStore(s => s.unread.has(session.id))
  const clearUnread = useSessionActivityStore(s => s.clearUnread)

  // Clear unread badge when user navigates to this session
  useEffect(() => {
    if (isActive && isUnread) {
      clearUnread(session.id)
    }
  }, [isActive, isUnread, clearUnread, session.id])

  const handleDelete = useCallback(async () => {
    await ipc?.session.delete(session.id)
    queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) })
    if (isActive) {
      void navigate({ to: '/', search: { workspaceId: undefined } })
    }
  }, [session.id, workspaceId, queryClient, isActive, navigate])

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-cradle-session', session.id)
    e.dataTransfer.effectAllowed = 'move'
  }, [session.id])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    // Detect if cursor dropped outside the current window bounds
    const { screenX, screenY } = e
    const outside = (
      screenX < window.screenX
      || screenX > window.screenX + window.outerWidth
      || screenY < window.screenY
      || screenY > window.screenY + window.outerHeight
    )
    if (outside) {
      ipc?.window.tearOffSession(session.id, screenX, screenY)
    }
  }, [session.id])

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={cn(
        'group flex w-full items-center gap-1.5 rounded-md text-left text-xs transition-colors hover:bg-accent/60 cursor-grab active:cursor-grabbing',
        isActive && 'bg-accent/80 text-sidebar-foreground',
      )}
      data-testid={`session-item-${session.id}`}
    >
      <Link
        to="/chat/$sessionId"
        params={{ sessionId: session.id }}
        search={{ tearoff: false }}
        className="flex flex-1 items-center gap-1.5 px-2.5 py-1.5 truncate text-sidebar-foreground/80"
      >
        <span className="flex-1 truncate">{session.title}</span>
        {isUnread && !isActive && (
          <span className="shrink-0 size-1.5 rounded-full bg-primary" aria-label="新回复" />
        )}
        <span className="shrink-0 text-[11px] text-muted-foreground/50">
          {formatRelativeTime(session.updatedAt)}
        </span>
      </Link>
      <Menu>
        <MenuTrigger
          render={(
            <button
              type="button"
              className="shrink-0 rounded p-0.5 mr-2 text-muted-foreground/50 hover:text-foreground hover:bg-accent/80 transition-all opacity-0 group-hover:opacity-100"
              onClick={e => e.stopPropagation()}
              aria-label="会话菜单"
            />
          )}
        >
          <MoreHorizontalIcon className="size-3" aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="start" side="bottom" sideOffset={4}>
          <MenuItem variant="destructive" onClick={handleDelete}>
            <Trash2Icon />
            删除会话
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
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
  const navigate = useNavigate()
  const { sessions } = useSessions(expanded ? workspace.id : null)
  const toggleExpanded = useCallback(() => {
    setExpanded(prev => !prev)
  }, [])
  const openWorkspaceHome = useCallback(() => {
    void navigate({
      to: '/',
      search: { workspaceId: workspace.id },
    })
  }, [navigate, workspace.id])

  return (
    <div className="flex flex-col" data-testid={`workspace-group-${workspace.id}`}>
      <div className="group flex items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-accent/40 transition-colors">
        <button
          type="button"
          onClick={toggleExpanded}
          aria-label="切换工作区折叠状态"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors"
        >
          {expanded
            ? <FolderOpenIcon className="size-4" aria-hidden="true" />
            : <FolderClosedIcon className="size-4" aria-hidden="true" />}
        </button>

        <button
          type="button"
          onClick={openWorkspaceHome}
          className="flex min-w-0 flex-1 items-center px-1 py-1.5 text-left"
        >
          <span className="truncate text-xs font-medium text-sidebar-foreground/90">
            {workspace.name}
          </span>
        </button>

        <Menu>
          <MenuTrigger
            render={(
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={e => e.stopPropagation()}
              />
            )}
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="start" side="bottom" sideOffset={4}>
            <MenuItem
              onClick={() => ipc?.workspace.openInFinder(workspace.path)}
            >
              <FolderOpenIcon />
              在 Finder 中打开
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

      {/* Session list with expand/collapse animation */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="sessions"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
            className="overflow-hidden"
          >
            <div className="ml-5 flex flex-col gap-0.5 border-l border-sidebar-border/50 pl-2.5 py-0.5">
              {sessions.length === 0 && (
                <p className="px-2.5 py-1.5 text-xs text-muted-foreground/50">暂无会话</p>
              )}
              {sessions.map(session => (
                <SessionItem key={session.id} session={session} workspaceId={workspace.id} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Top nav items ─────────────────────────────────────────────────────────────

interface TopNavItemProps {
  icon: React.ReactNode
  label: string
  shortcut?: string
  collapsed?: boolean
  onClick?: () => void
}

function TopNavItem({ icon, label, shortcut, collapsed, onClick }: TopNavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-sidebar-foreground/80 transition-colors hover:bg-accent/50 hover:text-sidebar-foreground overflow-hidden"
    >
      {collapsed
        ? (
          <Tooltip>
            <TooltipTrigger
              delay={0}
              render={<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/70" />}
            >
              {icon}
            </TooltipTrigger>
            <TooltipPopup side="right" sideOffset={8}>{label}</TooltipPopup>
          </Tooltip>
        )
        : (
          <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/70">
            {icon}
          </span>
        )}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            key="label"
            className="flex-1 text-left whitespace-nowrap"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 40 }}
            style={{ overflow: 'hidden', display: 'block' }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
      {shortcut && (
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              key="shortcut"
              className="shrink-0 font-mono text-[10px] text-muted-foreground/40 opacity-0 group-hover:opacity-100 whitespace-nowrap"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: undefined, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 40 }}
              style={{ overflow: 'hidden', display: 'block' }}
            >
              {shortcut}
            </motion.span>
          )}
        </AnimatePresence>
      )}
    </button>
  )
}

// ── Main sidebar content ──────────────────────────────────────────────────────

export function WorkspaceSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { workspaces } = useWorkspaces()
  const { addFromPicker, adding } = useAddWorkspace()
  const { remove } = useDeleteWorkspace()
  const navigate = useNavigate()
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
      <TooltipProvider delay={collapsed ? 0 : 600}>
        <nav className="flex flex-col gap-0.5 px-2 pt-1 pb-2">
          <TopNavItem
            icon={<MessageSquarePlusIcon className="size-4" />}
            label="新建聊天"
            collapsed={collapsed}
            onClick={() => navigate({ to: '/', search: { workspaceId: undefined } })}
          />
          <TopNavItem
            icon={<SearchIcon className="size-4" />}
            label="搜索"
            shortcut="⌘K"
            collapsed={collapsed}
            onClick={openSearch}
          />
          <TopNavItem
            icon={<AlignJustifyIcon className="size-4" />}
            label="插件"
            collapsed={collapsed}
          />
          <TopNavItem
            icon={<ZapIcon className="size-4" />}
            label="自动化"
            collapsed={collapsed}
          />
          <TopNavItem
            icon={<LayoutDashboardIcon className="size-4" />}
            label="看板"
            collapsed={collapsed}
            onClick={() => navigate({ to: '/kanban' })}
          />
        </nav>
      </TooltipProvider>

      {/* ── Projects section — always rendered, opacity fades on collapse ── */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 120ms ease', pointerEvents: collapsed ? 'none' : undefined }}
      >
        <div className="flex items-center px-3.5 py-1.5">
          <span className="flex-1 text-xs font-semibold tracking-wider text-muted-foreground/60 select-none uppercase">
            项目
          </span>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-5 text-muted-foreground/60 hover:text-foreground"
              title="排列"
            >
              <SlidersHorizontalIcon className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-5 text-muted-foreground/60 hover:text-foreground"
              title="筛选"
            >
              <GitBranchIcon className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-5 text-muted-foreground/60 hover:text-foreground"
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
        <nav className="flex flex-col gap-0.5 overflow-y-auto px-1.5 pb-2" data-testid="workspace-list">
          {workspaces.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
              <div className="flex size-10 items-center justify-center rounded-xl bg-muted/60">
                <FolderOpenIcon className="size-5 text-muted-foreground/50" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground/70">还没有项目</p>
                <p className="text-[11px] text-muted-foreground/50">添加一个本地仓库开始使用</p>
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

      <ThreadSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}
