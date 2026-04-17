// Input: useWorkspaces, useSessions hooks, workspace/session types, coss UI primitives
// Output: WorkspaceSidebar component with workspace groups and session items
// Position: Main sidebar feature component for workspace navigation

import { Button } from '@renderer/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@renderer/components/ui/menu'
import { ipc } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import {
  ChevronRightIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
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
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-sidebar-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
      data-testid={`session-item-${session.id}`}
    >
      <span className="flex-1 truncate">{session.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
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
    <div data-testid={`workspace-group-${workspace.id}`}>
      {/* Group header */}
      <div className="group flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRightIcon
            className={cn(
              'size-3.5 transition-transform duration-150',
              expanded && 'rotate-90',
            )}
          />
        </button>

        <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />

        <span className="flex-1 truncate text-xs font-medium text-muted-foreground">
          {workspace.name}
        </span>

        <Menu>
          <MenuTrigger
            render={(
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100"
              />
            )}
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="start" side="bottom" sideOffset={4}>
            <MenuItem
              closeOnClick
              onSelect={() => ipc?.workspace.openInFinder(workspace.path)}
            >
              <FolderOpenIcon />
              在 Finder 中打开
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              closeOnClick
              onSelect={() => onDelete(workspace.id)}
            >
              <Trash2Icon />
              移除工作区
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      {/* Session list */}
      {expanded && (
        <div className="ml-3 space-y-0.5 border-l border-sidebar-border pl-2">
          {sessions.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground/60">暂无会话</p>
          )}
          {sessions.map(session => (
            <SessionItem key={session.id} session={session} />
          ))}
        </div>
      )}
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
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground select-none">工作区</span>
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
      <nav className="flex-1 space-y-1 overflow-y-auto px-1 pb-2" data-testid="workspace-list">
        {workspaces.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <FolderOpenIcon className="size-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground/60">
              还没有工作区
            </p>
            <Button
              variant="outline"
              size="xs"
              onClick={addFromPicker}
              disabled={adding}
              className="border-dashed"
              data-testid="add-workspace-empty-btn"
            >
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
