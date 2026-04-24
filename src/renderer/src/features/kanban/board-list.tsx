// Input: useBoards, useCreateBoard, useDeleteBoard hooks, useWorkspaces, TanStack Router Link
// Output: BoardList component — workspace-grouped board list with create/delete actions
// Position: Entry component for the /kanban route; lets users navigate to boards

import type { KanbanBoard } from '@main/ipc-types'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { useWorkspaces } from '@renderer/features/workspace'
import { cn } from '@renderer/lib/cn'
import { Link } from '@tanstack/react-router'
import { LayoutDashboardIcon, PlusIcon, TrashIcon } from 'lucide-react'
import type * as React from 'react'
import { useState } from 'react'

import { useBoards, useCreateBoard, useDeleteBoard } from './use-kanban'

// ── Per-workspace board section ───────────────────────────────────────────────

function WorkspaceBoardSection({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string
  workspaceName: string
}) {
  const { data: boards = [] } = useBoards(workspaceId)
  const createBoard = useCreateBoard()
  const deleteBoard = useDeleteBoard()

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  async function handleCreate() {
    const name = newName.trim()
    if (!name) {
      return
    }
    await createBoard.mutateAsync({ workspaceId, name })
    setNewName('')
    setAdding(false)
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
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground truncate">{workspaceName}</h3>
        <button
          className={cn(
            'ml-auto flex items-center gap-1 text-xs text-muted-foreground',
            'hover:text-foreground transition-colors',
          )}
          onClick={() => setAdding(v => !v)}
        >
          <PlusIcon className="size-3.5" />
          New board
        </button>
      </div>

      {adding && (
        <div className="flex gap-2">
          <Input
            autoFocus
            placeholder="Board name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            size="sm"
          />
          <Button
            size="sm"
            disabled={!newName.trim() || createBoard.isPending}
            onClick={() => void handleCreate()}
          >
            Create
          </Button>
        </div>
      )}

      {boards.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground py-1">No boards yet</p>
      )}

      <div className="space-y-1">
        {boards.map(board => (
          <BoardRow
            key={board.id}
            board={board}
            onDelete={() => deleteBoard.mutate(board.id)}
          />
        ))}
      </div>
    </section>
  )
}

function BoardRow({ board, onDelete }: { board: KanbanBoard, onDelete: () => void }) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
      <LayoutDashboardIcon className="size-4 text-muted-foreground shrink-0" />
      <Link
        to="/kanban/$boardId"
        params={{ boardId: board.id }}
        className="flex-1 text-sm truncate"
      >
        {board.name}
      </Link>
      <button
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <TrashIcon className="size-3.5" />
      </button>
    </div>
  )
}

// ── Main BoardList ─────────────────────────────────────────────────────────────

export function BoardList() {
  const { workspaces } = useWorkspaces()

  if (workspaces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <LayoutDashboardIcon className="size-10 opacity-40" />
        <p className="text-sm">No workspaces found. Add a workspace first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6 max-w-xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Boards</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your Kanban boards per workspace
        </p>
      </div>

      {workspaces.map(ws => (
        <WorkspaceBoardSection
          key={ws.id}
          workspaceId={ws.id}
          workspaceName={ws.name}
        />
      ))}
    </div>
  )
}
