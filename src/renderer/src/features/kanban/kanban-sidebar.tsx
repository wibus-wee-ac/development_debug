// Input: useBoards, useCreateBoard, useDeleteBoard, useWorkspaces, TanStack Router Link/useNavigate
// Output: KanbanSidebar component — left navigation panel listing boards grouped by workspace
// Position: Sidebar companion for all /kanban/* routes; rendered inside AppLayout children

import type { KanbanBoard } from '@main/ipc-types'
import { useWorkspaces } from '@renderer/features/workspace'
import { cn } from '@renderer/lib/cn'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { LayoutDashboardIcon, PlusIcon, TrashIcon } from 'lucide-react'
import type * as React from 'react'
import { useState } from 'react'

import { useBoards, useCreateBoard, useDeleteBoard } from './use-kanban'

// ── Per-workspace section ─────────────────────────────────────────────────────

function WorkspaceSection({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string
  workspaceName: string
}) {
  const { data: boards = [] } = useBoards(workspaceId)
  const createBoard = useCreateBoard()
  const deleteBoard = useDeleteBoard()
  const navigate = useNavigate()

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  async function handleCreate() {
    const name = newName.trim()
    if (!name) {
      return
    }
    const board = await createBoard.mutateAsync({ workspaceId, name })
    setNewName('')
    setAdding(false)
    void navigate({ to: '/kanban/$boardId', params: { boardId: board.id } })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      void handleCreate()
    }
    if (e.key === 'Escape') {
      setNewName('')
      setAdding(false)
    }
  }

  return (
    <div className="space-y-0.5">
      {/* Workspace header */}
      <div className="flex items-center gap-1.5 px-2 py-1 group/ws">
        <span className="flex-1 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider truncate">
          {workspaceName}
        </span>
        <button
          className="opacity-0 group-hover/ws:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          onClick={() => setAdding(v => !v)}
          title="新建看板"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>

      {/* Inline create input */}
      {adding && (
        <div className="px-2 pb-1">
          <input
            autoFocus
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-2 ring-ring/24 placeholder:text-muted-foreground"
            placeholder="看板名称…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (!newName.trim()) {
                setAdding(false)
              }
            }}
          />
        </div>
      )}

      {/* Board links */}
      {boards.map(board => (
        <BoardItem
          key={board.id}
          board={board}
          onDelete={() => deleteBoard.mutate(board.id)}
        />
      ))}

      {boards.length === 0 && !adding && (
        <p className="px-2 text-xs text-muted-foreground/50 py-0.5">暂无看板</p>
      )}
    </div>
  )
}

function BoardItem({ board, onDelete }: { board: KanbanBoard, onDelete: () => void }) {
  const params = useParams({ strict: false })
  const activeBoardId = (params as Record<string, string>).boardId
  const isActive = activeBoardId === board.id

  return (
    <div
      className={cn(
        'group/board flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors',
        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50 text-foreground/80 hover:text-foreground',
      )}
    >
      <LayoutDashboardIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <Link
        to="/kanban/$boardId"
        params={{ boardId: board.id }}
        className="flex-1 text-xs truncate"
      >
        {board.name}
      </Link>
      <button
        className="opacity-0 group-hover/board:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        title="删除看板"
      >
        <TrashIcon className="size-3" />
      </button>
    </div>
  )
}

// ── Main KanbanSidebar ────────────────────────────────────────────────────────

export function KanbanSidebar() {
  const { workspaces } = useWorkspaces()

  return (
    <div className="flex h-full w-52 shrink-0 flex-col border-r overflow-hidden bg-sidebar">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b shrink-0">
        <LayoutDashboardIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">看板</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-1 space-y-3">
        {workspaces.map(ws => (
          <WorkspaceSection
            key={ws.id}
            workspaceId={ws.id}
            workspaceName={ws.name}
          />
        ))}

        {workspaces.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">请先添加工作区</p>
        )}
      </div>
    </div>
  )
}
