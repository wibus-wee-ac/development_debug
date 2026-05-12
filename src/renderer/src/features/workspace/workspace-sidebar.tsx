// Input: useWorkspaces, useSessions hooks, workspace/session types, UI primitives, tab navigation
// Output: WorkspaceSidebar component with top nav, workspace groups and session items
// Position: Main sidebar feature component for workspace navigation (uses tab system)

import { Button } from '@renderer/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@renderer/components/ui/menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { PackCodebaseDialog } from '@renderer/features/pack-codebase/pack-codebase-dialog'
import { GlobalSearchDialog } from '@renderer/features/search/global-search-dialog'
import { useShortcut } from '@renderer/hooks/use-shortcut'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc'
import { useLayoutStore } from '@renderer/store/layout'
import { useSessionActivityStore } from '@renderer/store/session-activity'
import { useCradleNavigation, useIsActiveTab } from '@renderer/tabs/use-cradle-navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  BarChart3Icon,
  ClipboardCopyIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  GitBranchIcon,
  HomeIcon,
  LayoutDashboardIcon,
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
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  const isActive = useIsActiveTab('chat', { sessionId: session.id })
  const { openTab } = useCradleNavigation()
  const queryClient = useQueryClient()
  const isUnread = useSessionActivityStore(s => s.unread.has(session.id))
  const clearUnread = useSessionActivityStore(s => s.clearUnread)
  const [isRenaming, setIsRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState(session.title)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Clear unread badge when user navigates to this session
  useEffect(() => {
    if (isActive && isUnread) {
      clearUnread(session.id)
    }
  }, [isActive, isUnread, clearUnread, session.id])

  useEffect(() => {
    if (!isRenaming) {
      return
    }

    setDraftTitle(session.title)
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [isRenaming, session.title])

  const invalidateSessionQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: ['chat-session', session.id] }),
    ])
  }, [queryClient, session.id, workspaceId])

  const handleClick = useCallback(() => {
    openTab('chat', { sessionId: session.id })
  }, [openTab, session.id])

  const handleDelete = useCallback(async () => {
    await ipc?.session.delete(session.id)
    queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) })
    if (isActive) {
      openTab('home')
    }
  }, [session.id, workspaceId, queryClient, isActive, openTab])

  const handleTogglePin = useCallback(async () => {
    await ipc?.session.togglePin(session.id)
    queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) })
  }, [session.id, workspaceId, queryClient])

  const handleRename = useCallback(async (nextTitleRaw: string) => {
    const nextTitle = nextTitleRaw.trim()
    setIsRenaming(false)
    setDraftTitle(session.title)

    if (!nextTitle || nextTitle === session.title) {
      return
    }

    await ipc?.session.updateTitle({ id: session.id, title: nextTitle })
    await invalidateSessionQueries()
  }, [invalidateSessionQueries, session.id, session.title])

  const handleRenameCancel = useCallback(() => {
    setDraftTitle(session.title)
    setIsRenaming(false)
  }, [session.title])

  const handleStartRename = useCallback(() => {
    setDraftTitle(session.title)
    setIsRenaming(true)
  }, [session.title])

  const handleExport = useCallback(async () => {
    const md = await ipc?.session.exportAsMarkdown(session.id)
    if (md) {
      await navigator.clipboard.writeText(md)
    }
  }, [session.id])

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
      draggable={!isRenaming}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={cn(
        'group flex w-full items-center gap-1.5 rounded-md text-left text-xs transition-colors hover:bg-accent/60',
        !isRenaming && 'cursor-grab active:cursor-grabbing',
        isActive && 'bg-accent/80 text-sidebar-foreground',
      )}
      data-testid={`session-item-${session.id}`}
      data-session-pinned={session.pinned ? 'true' : 'false'}
    >
      {isRenaming
        ? (
          <div
            className="flex flex-1 items-center gap-1.5 px-2.5 py-1.5 min-w-0 text-sidebar-foreground/80"
            onClick={e => e.stopPropagation()}
          >
            {session.pinned
? (
              <PinIcon className="size-2.5 shrink-0 text-primary/60" aria-label="已置顶" data-testid={`session-pin-indicator-${session.id}`} />
            )
: null}
            <input
              ref={renameInputRef}
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              onBlur={() => { void handleRename(draftTitle) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleRename(draftTitle)
                }
                else if (e.key === 'Escape') {
                  e.preventDefault()
                  handleRenameCancel()
                }
              }}
              data-testid={`session-rename-input-${session.id}`}
              className="min-w-0 flex-1 bg-transparent text-left text-xs text-sidebar-foreground/90 outline-none placeholder:text-muted-foreground/40"
            />
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {formatRelativeTime(session.updatedAt)}
            </span>
          </div>
        )
        : (
          <>
            <button
              type="button"
              onClick={handleClick}
              data-testid={`session-open-${session.id}`}
              className="flex flex-1 items-center gap-1.5 px-2.5 py-1.5 min-w-0 text-sidebar-foreground/80"
            >
              {session.pinned
? (
                <PinIcon className="size-2.5 shrink-0 text-primary/60" aria-label="已置顶" data-testid={`session-pin-indicator-${session.id}`} />
              )
: null}
              <span className="min-w-0 flex-1 truncate text-left" data-testid={`session-title-${session.id}`}>{session.title}</span>
              {isUnread && !isActive && (
                <span className="shrink-0 size-1.5 rounded-full bg-primary" aria-label="新回复" />
              )}
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatRelativeTime(session.updatedAt)}
              </span>
            </button>
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
                data-testid={`session-menu-trigger-${session.id}`}
              >
                <MoreHorizontalIcon className="size-3" aria-hidden="true" />
              </MenuTrigger>
              <MenuPopup align="start" side="bottom" sideOffset={4}>
                <MenuItem onClick={handleStartRename} data-testid={`session-menu-rename-${session.id}`}>
                  <PencilIcon />
                  重命名
                </MenuItem>
                <MenuItem onClick={handleTogglePin} data-testid={`session-menu-toggle-pin-${session.id}`}>
                  {session.pinned ? <PinOffIcon /> : <PinIcon />}
                  {session.pinned ? '取消置顶' : '置顶'}
                </MenuItem>
                <MenuItem onClick={handleExport} data-testid={`session-menu-copy-markdown-${session.id}`}>
                  <ClipboardCopyIcon />
                  复制为 Markdown
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive" onClick={handleDelete} data-testid={`session-menu-delete-${session.id}`}>
                  <Trash2Icon />
                  删除会话
                </MenuItem>
              </MenuPopup>
            </Menu>
          </>
        )}
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
  const [packOpen, setPackOpen] = useState(false)
  const { openTab } = useCradleNavigation()
  const { sessions } = useSessions(expanded ? workspace.id : null)
  const toggleExpanded = useCallback(() => {
    setExpanded(prev => !prev)
  }, [])
  const openWorkspaceHome = useCallback(() => {
    openTab('workspace-detail', { workspaceId: workspace.id })
  }, [openTab, workspace.id])

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
          data-testid={`workspace-open-${workspace.id}`}
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
            <MenuItem onClick={() => setPackOpen(true)}>
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
                <p className="px-2.5 py-1.5 text-xs text-muted-foreground">暂无会话</p>
              )}
              {[...sessions].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).map(session => (
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

interface NavItemProps {
  icon: React.ReactNode
  label: string
  shortcut?: string
  collapsed?: boolean
  onClick?: () => void
  dataTestId?: string
}

function TopNavItem({ icon, label, shortcut, collapsed, onClick, dataTestId }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
      className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-sidebar-foreground/80 transition-colors hover:bg-accent/50 hover:text-sidebar-foreground overflow-hidden"
    >
      {collapsed
        ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/70">
                {icon}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
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
  const { openTab } = useCradleNavigation()
  const openSettings = useLayoutStore(s => s.openSettings)
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
            icon={<HomeIcon className="size-4" />}
            label="首页"
            collapsed={collapsed}
            onClick={() => openTab('home')}
          />
          <TopNavItem
            icon={<MessageSquarePlusIcon className="size-4" />}
            label="新建聊天"
            collapsed={collapsed}
            onClick={() => openTab('new-chat')}
            dataTestId="nav-new-chat"
          />
          <TopNavItem
            icon={<SearchIcon className="size-4" />}
            label="搜索"
            shortcut="⌘K"
            collapsed={collapsed}
            onClick={openSearch}
          />
          <TopNavItem
            icon={<LayoutDashboardIcon className="size-4" />}
            label="看板"
            collapsed={collapsed}
            onClick={() => openTab('kanban-board')}
            dataTestId="nav-kanban"
          />
          <TopNavItem
            icon={<BarChart3Icon className="size-4" />}
            label="用量"
            collapsed={collapsed}
            onClick={() => openTab('usage')}
            dataTestId="nav-usage"
          />
          <TopNavItem
            icon={<SettingsIcon className="size-4" />}
            label="设置"
            shortcut="⌘,"
            collapsed={collapsed}
            onClick={openSettings}
            dataTestId="settings-btn"
          />
        </nav>
      </TooltipProvider>

      {/* ── Projects section — always rendered, opacity fades on collapse ── */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 120ms ease', pointerEvents: collapsed ? 'none' : undefined }}
      >
        <div className="flex items-center px-3.5 py-1.5">
          <span className="flex-1 text-[11px] font-medium text-muted-foreground select-none">
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

      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}
