// Input: useWorkspaces, useSessions hooks, workspace/session types, coss UI primitives, router Link
// Output: WorkspaceSidebar component with top nav, workspace groups and session items
// Position: Main sidebar feature component for workspace navigation

import { Button } from '@renderer/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@renderer/components/ui/menu'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useMatchRoute, useNavigate } from '@tanstack/react-router'
import {
  AlignJustifyIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  GitBranchIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  ZapIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useState } from 'react'

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
  const matchRoute = useMatchRoute()
  const isActive = !!matchRoute({ to: '/chat/$sessionId', params: { sessionId: session.id } })
  const queryClient = useQueryClient()

  const handleDelete = useCallback(async () => {
    await ipc?.session.delete(session.id)
    queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) })
  }, [session.id, workspaceId, queryClient])

  return (
    <div
      className={cn(
        'group flex w-full items-center gap-1.5 rounded-md text-left text-xs transition-colors hover:bg-accent/60',
        isActive && 'bg-accent/80 text-sidebar-foreground',
      )}
      data-testid={`session-item-${session.id}`}
    >
      <Link
        to="/chat/$sessionId"
        params={{ sessionId: session.id }}
        className="flex flex-1 items-center gap-1.5 px-2.5 py-1.5 truncate text-sidebar-foreground/80"
      >
        <span className="flex-1 truncate">{session.title}</span>
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
  const { sessions } = useSessions(expanded ? workspace.id : null)

  return (
    <div className="flex flex-col" data-testid={`workspace-group-${workspace.id}`}>
      {/* Group header — entire row is clickable */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(prev => !prev)}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setExpanded(prev => !prev)}
        className="group flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-accent/40 transition-colors"
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/70">
          {expanded
            ? <FolderOpenIcon className="size-4" aria-hidden="true" />
            : <FolderClosedIcon className="size-4" aria-hidden="true" />}
        </span>

        <span className="flex-1 truncate text-xs font-medium text-sidebar-foreground/90">
          {workspace.name}
        </span>

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
  onClick?: () => void
}

function TopNavItem({ icon, label, onClick }: TopNavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-sidebar-foreground/80 transition-colors hover:bg-accent/50 hover:text-sidebar-foreground"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/70">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  )
}

// ── Main sidebar content ──────────────────────────────────────────────────────

export function WorkspaceSidebar() {
  const { workspaces } = useWorkspaces()
  const { addFromPicker, adding } = useAddWorkspace()
  const { remove } = useDeleteWorkspace()
  const navigate = useNavigate()

  const handleDelete = useCallback((id: string) => {
    remove(id)
  }, [remove])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Top navigation ── */}
      <nav className="flex flex-col gap-0.5 px-2 pt-1 pb-2">
        <TopNavItem
          icon={<MessageSquarePlusIcon className="size-4" />}
          label="新建聊天"
          onClick={() => navigate({ to: '/' })}
        />
        <TopNavItem
          icon={<SearchIcon className="size-4" />}
          label="搜索"
        />
        <TopNavItem
          icon={<AlignJustifyIcon className="size-4" />}
          label="插件"
        />
        <TopNavItem
          icon={<ZapIcon className="size-4" />}
          label="自动化"
        />
      </nav>

      {/* ── Projects section ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
    </div>
  )
}
