// Input: Board list, workspace list, tab navigation
// Output: Flat kanban boards section with Linear-style popover creation
// Position: Section component used inside WorkspaceSidebar

import {
  LayoutDashboardIcon,
  MoreHorizontalIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import { useCradleNavigation, useIsActiveTab } from '~/tabs/use-cradle-navigation'

import { useAllBoards, useCreateBoard, useDeleteBoard } from './use-kanban'

// ── Create Board Popover ──────────────────────────────────────────────────────

function CreateBoardPopover({ onCreated }: { onCreated: (board: { id: string }) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { workspaces } = useWorkspaces()
  const createBoard = useCreateBoard()

  const selectedWorkspace = workspaces.find(w => w.id === workspaceId)

  // Auto-select first workspace & focus input when popover opens
  useEffect(() => {
    if (!open) return
    setName('')
    if (workspaces.length === 1) {
      setWorkspaceId(workspaces[0].id)
    } else if (!workspaceId && workspaces.length > 0) {
      setWorkspaceId(workspaces[0].id)
    }
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const handleSubmit = useCallback(() => {
    if (!name.trim() || !workspaceId) return
    createBoard.mutate(
      { workspaceId, name: name.trim() },
      {
        onSuccess: (board) => {
          setOpen(false)
          onCreated(board)
        },
      },
    )
  }, [name, workspaceId, createBoard, onCreated])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    },
    [handleSubmit],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5 text-muted-foreground/60 hover:text-foreground"
            data-testid="kanban-add-board-btn"
          >
            <PlusIcon className="size-3" />
          </Button>
        }
      />
      <PopoverContent align="end" side="bottom" sideOffset={6} className="w-64 p-1.5">
        <div className="flex flex-col gap-1" onKeyDown={handleKeyDown}>
          <div className="flex flex-col gap-1 px-2 pt-1 pb-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">New Board</span>
          </div>

          {workspaces.length > 1 && (
            <div className="flex flex-col gap-1 px-2 pb-1">
              <Menu>
                <MenuTrigger
                  className={cn(
                    'flex items-center justify-between rounded-md border border-border px-2.5 py-1',
                    'text-xs text-foreground bg-transparent',
                    'hover:bg-muted/50 transition-colors w-full',
                  )}
                >
                  <span className={cn(!selectedWorkspace && 'text-muted-foreground/50')}>
                    {selectedWorkspace?.name ?? 'Select workspace'}
                  </span>
                </MenuTrigger>
                <MenuPopup>
                  {workspaces.map(ws => (
                    <MenuItem key={ws.id} onClick={() => setWorkspaceId(ws.id)}>
                      {ws.name}
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            </div>
          )}

          <div className="px-2 pb-1">
            <input
              ref={inputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Board name"
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-primary/40 transition-colors"
            />
          </div>

          <div className="flex items-center justify-end gap-1.5 px-2 pb-1">
            <button
              onClick={handleSubmit}
              disabled={!name.trim() || !workspaceId || createBoard.isPending}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-medium',
                'bg-primary text-primary-foreground',
                'hover:bg-primary/90 transition-colors',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              Create
              <kbd className="ml-1.5 rounded border border-primary-foreground/20 bg-primary-foreground/10 px-1 text-[9px] font-sans leading-4">↵</kbd>
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── Board Item ────────────────────────────────────────────────────────────────

function BoardItem({ board }: { board: { id: string; name: string } }) {
  const { openTab } = useCradleNavigation()
  const isActive = useIsActiveTab('kanban-board', { boardId: board.id })
  const deleteBoard = useDeleteBoard()

  const handleDelete = useCallback(() => {
    deleteBoard.mutate(board.id)
  }, [deleteBoard, board.id])

  return (
    <div
      className={cn(
        'group flex items-center rounded-lg transition-colors mx-1',
        isActive ? 'bg-accent/80' : 'hover:bg-accent/50',
      )}
      data-testid={`kanban-board-${board.id}`}
    >
      <button
        onClick={() => openTab('kanban-board', { boardId: board.id })}
        className="flex-1 flex items-center gap-2 px-2.5 py-1.5 text-xs text-sidebar-foreground/80"
      >
        <LayoutDashboardIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        <span className="truncate">{board.name}</span>
      </button>

      <Menu>
        <MenuTrigger
          className="shrink-0 flex size-6 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:bg-accent/80 hover:text-foreground transition-all mr-1"
          data-testid={`kanban-board-menu-trigger-${board.id}`}
        >
          <MoreHorizontalIcon className="size-3" />
        </MenuTrigger>
        <MenuPopup>
          <MenuItem
            onClick={handleDelete}
            variant="destructive"
            data-testid={`kanban-board-delete-${board.id}`}
          >
            <TrashIcon className="size-3.5 mr-2" />
            Delete Board
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  )
}

// ── Main Section ──────────────────────────────────────────────────────────────

export function KanbanSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const boards = useAllBoards()
  const { openTab } = useCradleNavigation()

  return (
    <div
      className="flex flex-col"
      style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 120ms ease', pointerEvents: collapsed ? 'none' : undefined }}
      data-testid="kanban-sidebar"
    >
      <div className="flex items-center px-2.5 py-1.5">
        <span className="flex-1 text-[11px] font-medium text-muted-foreground select-none">看板</span>
        <CreateBoardPopover onCreated={(board) => openTab('kanban-board', { boardId: board.id })} />
      </div>

      <div className="pb-1">
        {boards.data?.length === 0 && (
          <p className="px-5 py-1.5 text-[11px] text-muted-foreground/50">暂无看板</p>
        )}
        {boards.data?.map(board => (
          <BoardItem key={board.id} board={board} />
        ))}
      </div>
    </div>
  )
}
