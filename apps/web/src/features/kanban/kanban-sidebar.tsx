// Input: useBoards, useCreateBoard, useDeleteBoard, useMilestones, tab navigation
// Output: KanbanSidebar — left sidebar with board list and milestones
// Position: Sidebar section for kanban navigation (uses tab system)

import {
  ArrowLeftIcon,
  FlagIcon,
  LayoutDashboardIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import { useCradleTabStore } from '~/tabs/registry'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

import {
  useBoards,
  useCreateBoard,
  useDeleteBoard,
  useMilestones,
} from './use-kanban'

function useWorkspaceId() {
  const { workspaces } = useWorkspaces()
  const { data: boards } = useBoards()
  // Prefer workspaceId from existing boards; fall back to the first workspace
  return boards?.[0]?.workspaceId ?? workspaces[0]?.id ?? null
}

export function KanbanSidebar() {
  'use no memo'
  const { data: boards = [] } = useBoards()
  const createBoard = useCreateBoard()
  const deleteBoard = useDeleteBoard()
  const { openTab } = useCradleNavigation()
  const activeTab = useCradleTabStore(s => s.tabs.find(t => t.id === s.activeTabId))
  const workspaceId = useWorkspaceId()
  const { data: milestones = [] } = useMilestones(workspaceId ?? '')

  const [isCreating, setIsCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleCreate = useCallback(() => {
    const name = inputRef.current?.value.trim()
    if (name && workspaceId) {
      createBoard.mutate(
        { workspaceId, name },
        {
          onSuccess: (board: any) => {
            openTab('kanban-board', { boardId: board.id })
          },
        },
      )
      inputRef.current!.value = ''
    }
    setIsCreating(false)
  }, [createBoard, workspaceId, openTab])

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="kanban-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-10 border-b border-border/40">
        <button
          className="text-muted-foreground/50 hover:text-foreground transition-colors duration-100 p-1 rounded-md hover:bg-accent/50"
          onClick={() => openTab('home')}
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="text-[12px] font-medium text-foreground">Boards</span>
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground/40 hover:text-foreground"
              data-testid="kanban-add-board-btn"
              onClick={() => {
                setIsCreating(true)
                requestAnimationFrame(() => inputRef.current?.focus())
              }}
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New board</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-0.5 px-2 py-2.5 pb-4">
          {boards.map((board) => {
            const isActive = activeTab?.type === 'kanban-board' && activeTab.params.boardId === board.id
            return (
              <div key={board.id} className="group flex items-center">
                <button
                  type="button"
                  className={cn(
                    'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-[13px]',
                    'transition-colors duration-100',
                    isActive
                      ? 'bg-accent/80 text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                  data-testid={`kanban-board-${board.id}`}
                  onClick={() => openTab('kanban-board', { boardId: board.id })}
                >
                  <LayoutDashboardIcon className={cn('size-3.5 shrink-0', isActive ? 'opacity-70' : 'opacity-40')} />
                  <span className="truncate">{board.name}</span>
                </button>
                <Menu>
                  <MenuTrigger
                    className="opacity-0 group-hover:opacity-100 transition-opacity mr-1"
                  >
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground/40"
                      data-testid={`kanban-board-menu-trigger-${board.id}`}
                    >
                      <MoreHorizontalIcon />
                    </Button>
                  </MenuTrigger>
                  <MenuPopup side="right" align="start">
                    <MenuItem
                      variant="destructive"
                      data-testid={`kanban-board-delete-${board.id}`}
                      onClick={() => {
                        deleteBoard.mutate(board.id)
                        if (isActive) {
                          openTab('home')
                        }
                      }}
                    >
                      <Trash2Icon />
                      Delete
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </div>
            )
          })}

          {isCreating && (
            <div className="px-1 py-1">
              <Input
                ref={inputRef}
                data-testid="kanban-new-board-input"
                placeholder="Board name"
                className="h-7 text-[13px]"
                onBlur={handleCreate}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleCreate()
                  }
                  if (e.key === 'Escape') {
                    setIsCreating(false)
                  }
                }}
              />
            </div>
          )}

          {milestones.length > 0 && (
            <>
              <div className="mt-4 px-2 pb-1">
                <span className="text-[11px] text-muted-foreground/50">Milestones</span>
              </div>
              {milestones.map(ms => (
                <div
                  key={ms.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground/60"
                >
                  <FlagIcon className="size-3 shrink-0 opacity-40" />
                  <span className="truncate">{ms.title}</span>
                  {ms.status === 'closed' && (
                    <span className="text-[10px] text-muted-foreground/30 ml-auto">closed</span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
