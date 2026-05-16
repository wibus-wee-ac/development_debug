// Input: Tab store, board list
// Output: Kanban sidebar with board list and management
// Position: App sidebar drill-in panel when kanban tab is active

import { LayoutDashboardIcon, MoreHorizontalIcon, PlusIcon, TrashIcon } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { useCradleTabStore } from '~/tabs/registry'

import { useBoards, useCreateBoard, useDeleteBoard } from './use-kanban'

export function KanbanSidebar() {
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
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="kanban-sidebar">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[12px] font-medium text-muted-foreground">看板</span>
        <Button
          variant="ghost"
          size="sm"
          className="size-6 p-0"
          onClick={handleStartCreate}
          disabled={creating}
          data-testid="kanban-add-board-btn"
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-1">
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
                } else if (e.key === 'Escape') {
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
            className="group flex items-center gap-1 rounded-md hover:bg-muted/50 transition-colors"
          >
            <button
              onClick={() => openTab('kanban-board', { boardId: board.id })}
              className="flex-1 flex items-center gap-2 px-2 py-1.5 text-[13px] text-foreground"
            >
              <LayoutDashboardIcon className="size-3.5 text-muted-foreground" />
              {board.name}
            </button>

            <Menu>
              <MenuTrigger
                className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-fill hover:text-foreground transition-all"
                data-testid={`kanban-board-menu-trigger-${board.id}`}
              >
                <MoreHorizontalIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup>
                <MenuItem
                  onClick={() => handleDeleteBoard(board.id)}
                  className="text-red-500"
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
          <p className="px-3 py-4 text-[11px] text-muted-foreground text-center">
            暂无看板
          </p>
        )}
      </div>
    </div>
  )
}
