// Input: Tab store, board list, collapsed state
// Output: Kanban boards navigation section, embeddable in any sidebar
// Position: Section component used inside WorkspaceSidebar

import { LayoutDashboardIcon, MoreHorizontalIcon, PlusIcon, TrashIcon } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { useCradleTabStore } from '~/tabs/registry'

import { useBoards, useCreateBoard, useDeleteBoard } from './use-kanban'

export function KanbanSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { workspaces } = useWorkspaces()
  const firstWorkspaceId = workspaces?.[0]?.id ?? ''
  const boards = useBoards(firstWorkspaceId)
  const createBoard = useCreateBoard()
  const deleteBoard = useDeleteBoard()
  const openTab = useCradleTabStore(s => s.openTab)
  const [creating, setCreating] = useState(false)
  const [showNameInput, setShowNameInput] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleStartCreate = useCallback(() => {
    setShowNameInput(true)
    setNewBoardName('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const handleConfirmCreate = useCallback(() => {
    const name = newBoardName.trim()
    if (!name) {
      setShowNameInput(false)
      return
    }
    setCreating(true)
    createBoard.mutate({ workspaceId: firstWorkspaceId, name }, {
      onSuccess: (board) => {
        openTab('kanban-board', { boardId: board.id })
        setCreating(false)
        setShowNameInput(false)
        setNewBoardName('')
      },
      onError: () => {
        setCreating(false)
        setShowNameInput(false)
      },
    })
  }, [newBoardName, createBoard, openTab, firstWorkspaceId])

  const handleDeleteBoard = useCallback((boardId: string) => {
    deleteBoard.mutate(boardId)
  }, [deleteBoard])

  return (
    <div
      className="flex flex-col"
      style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 120ms ease', pointerEvents: collapsed ? 'none' : undefined }}
      data-testid="kanban-sidebar"
    >
      <div className="flex items-center px-2.5 py-1.5">
        <span className="flex-1 text-[11px] font-medium text-muted-foreground select-none">看板</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5 text-muted-foreground/60 hover:text-foreground"
          onClick={handleStartCreate}
          disabled={creating}
          data-testid="kanban-add-board-btn"
        >
          <PlusIcon className="size-3" />
        </Button>
      </div>

      <div className="px-2 pb-1">
        {showNameInput && (
          <div className="px-2 py-1">
            <input
              ref={inputRef}
              value={newBoardName}
              onChange={e => setNewBoardName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleConfirmCreate()
                }
                else if (e.key === 'Escape') {
                  setShowNameInput(false)
                }
              }}
              onBlur={handleConfirmCreate}
              placeholder="看板名称"
              disabled={creating}
              data-testid="kanban-new-board-input"
              className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-border"
            />
          </div>
        )}

        {boards.data?.map(board => (
          <div
            key={board.id}
            data-testid={`kanban-board-${board.id}`}
            className="group flex items-center rounded-lg hover:bg-accent/50 transition-colors"
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
                  onClick={() => handleDeleteBoard(board.id)}
                  variant="destructive"
                  data-testid={`kanban-board-delete-${board.id}`}
                >
                  <TrashIcon className="size-3.5 mr-2" />
                  删除看板
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        ))}

        {boards.data?.length === 0 && !showNameInput && (
          <p className="px-3 py-2 text-[11px] text-muted-foreground">暂无看板</p>
        )}
      </div>
    </div>
  )
}
