// Input: Tab store, board list, collapsed state
// Output: Kanban boards navigation section, embeddable in any sidebar
// Position: Section component used inside WorkspaceSidebar

import { LayoutDashboardIcon, MoreHorizontalIcon, PlusIcon, TrashIcon } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

import { CreateBoardDialog } from './create-board-dialog'
import { useBoards, useDeleteBoard } from './use-kanban'

function WorkspaceBoardSection({ workspaceId, workspaceName }: { workspaceId: string, workspaceName: string }) {
  const boards = useBoards(workspaceId)
  const deleteBoard = useDeleteBoard()
  const { openTab } = useCradleNavigation()
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleDeleteBoard = useCallback((boardId: string) => {
    deleteBoard.mutate(boardId)
  }, [deleteBoard])

  return (
    <div className="flex flex-col">
      <div className="flex items-center px-2.5 py-1">
        <span className="flex-1 text-[11px] font-medium text-muted-foreground/70 select-none truncate">{workspaceName}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5 text-muted-foreground/60 hover:text-foreground"
          onClick={() => setDialogOpen(true)}
          data-testid={`kanban-add-board-btn-${workspaceId}`}
        >
          <PlusIcon className="size-3" />
        </Button>
      </div>

      <CreateBoardDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        defaultWorkspaceId={workspaceId}
        onCreated={(board) => openTab('kanban-board', { boardId: board.id })}
      />

      {boards.data?.map(board => (
        <div
          key={board.id}
          data-testid={`kanban-board-${board.id}`}
          className="group flex items-center rounded-lg hover:bg-accent/50 transition-colors mx-1"
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

      {boards.data?.length === 0 && (
        <p className="px-5 py-1.5 text-[11px] text-muted-foreground/50">暂无看板</p>
      )}
    </div>
  )
}

export function KanbanSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { workspaces } = useWorkspaces()

  return (
    <div
      className="flex flex-col"
      style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 120ms ease', pointerEvents: collapsed ? 'none' : undefined }}
      data-testid="kanban-sidebar"
    >
      <div className="flex items-center px-2.5 py-1.5">
        <span className="flex-1 text-[11px] font-medium text-muted-foreground select-none">看板</span>
      </div>

      <div className="pb-1">
        {(!workspaces || workspaces.length === 0) && (
          <p className="px-4 py-2 text-[11px] text-muted-foreground">请先添加工作区</p>
        )}

        {workspaces?.map(workspace => (
          <WorkspaceBoardSection
            key={workspace.id}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
          />
        ))}
      </div>
    </div>
  )
}
