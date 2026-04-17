// Input: useWorkspaces, useSessions hooks, workspace/session types, coss UI primitives
// Output: WorkspaceSidebar component with workspace groups and session items
// Position: Main sidebar feature component for workspace navigation

import { Button } from '@renderer/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@renderer/components/ui/menu'
import { ipc } from '@renderer/lib/ipc'
import {
  FolderClosedIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useState } from 'react'

import { useSessions } from './use-session'
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

function SessionItem({ session }: { session: Session }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-left text-sm transition-colors hover:bg-accent/60"
      data-testid={`session-item-${session.id}`}
    >
      <span className="flex-1 truncate text-sidebar-foreground/80">{session.title}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground/50">
        {formatRelativeTime(session.updatedAt)}
      </span>
    </button>
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

        <span className="flex-1 truncate text-sm font-medium text-sidebar-foreground/90">
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
                <SessionItem key={session.id} session={session} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main sidebar content ──────────────────────────────────────────────────────

export function WorkspaceSidebar() {
  const { workspaces, refresh } = useWorkspaces()
  const { addFromPicker, adding } = useAddWorkspace(refresh)
  const { remove } = useDeleteWorkspace(refresh)

  const handleDelete = useCallback((id: string) => {
    remove(id)
  }, [remove])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header area */}
      <div className="flex items-center justify-between px-3.5 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 select-none">
          工作区
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={addFromPicker}
          disabled={adding}
          data-testid="add-workspace-btn"
        >
          <PlusIcon />
        </Button>
      </div>

      {/* Workspace list */}
      <nav className="flex-1 flex flex-col gap-0.5 overflow-y-auto px-1.5 pb-2" data-testid="workspace-list">
        {workspaces.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/60">
              <FolderOpenIcon className="size-6 text-muted-foreground/50" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-muted-foreground/70">
                还没有工作区
              </p>
              <p className="text-xs text-muted-foreground/50">
                添加一个本地仓库开始使用
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={addFromPicker}
              disabled={adding}
              className="mt-1 border-dashed"
              data-testid="add-workspace-empty-btn"
            >
              <PlusIcon />
              添加工作区
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
  )
}
