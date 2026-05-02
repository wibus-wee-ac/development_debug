// Input: useBoards, useCreateBoard, useDeleteBoard, useMilestones, tab navigation
// Output: KanbanSidebar — left sidebar with board list and milestones
// Position: Sidebar section for kanban navigation (uses tab system)

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@renderer/components/ui/menu'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/cn'
import { useCradleTabStore } from '@renderer/tabs/registry'
import { useCradleNavigation } from '@renderer/tabs/use-cradle-navigation'
import {
  ArrowLeftIcon,
  FlagIcon,
  LayoutDashboardIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { useWorkspaces } from '@renderer/features/workspace/use-workspace'
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
          onSuccess: (board) => {
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
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <button
          className="text-muted-foreground hover:text-foreground transition-colors duration-100"
          onClick={() => openTab('home')}
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="text-[11px] font-medium text-foreground">Boards</span>
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground/30 hover:text-foreground"
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
        <div className="flex flex-col gap-px px-1.5 pb-4">
          {boards.map((board) => {
            const isActive = activeTab?.type === 'kanban-board' && activeTab.params.boardId === board.id
            return (
              <div key={board.id} className="group flex items-center">
                <button
                  type="button"
                  className={cn(
                    'flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-[12px]',
                    'transition-colors duration-100',
                    isActive
                      ? 'bg-foreground/6 text-foreground'
                      : 'text-muted-foreground/50 hover:bg-foreground/4 hover:text-foreground',
                  )}
                  data-testid={`kanban-board-${board.id}`}
                  onClick={() => openTab('kanban-board', { boardId: board.id })}
                >
                  <LayoutDashboardIcon className="size-3.5 shrink-0 opacity-40" />
                  <span className="truncate">{board.name}</span>
                </button>
                <Menu>
                  <MenuTrigger
                    className="opacity-0 group-hover:opacity-100 transition-opacity mr-1"
                  >
                    <Button variant="ghost" size="icon-xs" className="text-muted-foreground/25">
                      <MoreHorizontalIcon />
                    </Button>
                  </MenuTrigger>
                  <MenuPopup side="right" align="start">
                    <MenuItem
                      variant="destructive"
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
            <div className="px-2 py-1">
              <Input
                ref={inputRef}
                data-testid="kanban-new-board-input"
                placeholder="Board name"
                className="h-7 text-[12px]"
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
              <div className="mt-5 px-3 pb-1">
                <span className="text-[10px] text-muted-foreground/30">Milestones</span>
              </div>
              {milestones.map(ms => (
                <div
                  key={ms.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground/50"
                >
                  <FlagIcon className="size-3 shrink-0 opacity-30" />
                  <span className="truncate">{ms.title}</span>
                  {ms.status === 'closed' && (
                    <span className="text-[10px] text-muted-foreground/20 ml-auto">closed</span>
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
