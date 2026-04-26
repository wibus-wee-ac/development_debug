// Input: useBoards, useCreateBoard, useDeleteBoard, useMilestones, TanStack Router navigation
// Output: KanbanSidebar — left sidebar with boards list and milestones (Linear-style)
// Position: Sidebar inside the /kanban layout route

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@renderer/components/ui/menu'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  FlagIcon,
  LayoutDashboardIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import {
  useBoards,
  useCreateBoard,
  useDeleteBoard,
  useMilestones,
} from './use-kanban'

// Pull workspaceId from the first board or fallback
function useWorkspaceId() {
  const { data: boards } = useBoards()
  return boards?.[0]?.workspaceId ?? null
}

export function KanbanSidebar() {
  const { data: boards = [] } = useBoards()
  const createBoard = useCreateBoard()
  const deleteBoard = useDeleteBoard()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })
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
            navigate({ to: '/kanban/$boardId', params: { boardId: board.id } })
          },
        },
      )
      inputRef.current!.value = ''
    }
    setIsCreating(false)
  }, [createBoard, workspaceId, navigate])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <button
          className="text-muted-foreground/50 hover:text-foreground transition-colors"
          onClick={() => navigate({ to: '/', search: { workspaceId: undefined } })}
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="text-xs font-medium text-muted-foreground/60">看板</span>
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger
            render={
              (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground/50 hover:text-foreground"
                  onClick={() => {
                    setIsCreating(true)
                    requestAnimationFrame(() => inputRef.current?.focus())
                  }}
                >
                  <PlusIcon />
                </Button>
              )
            }
          />
          <TooltipPopup>新建看板</TooltipPopup>
        </Tooltip>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-px px-1.5 pb-4">
          {/* Board list */}
          {boards.map((board) => {
            const isActive = pathname === `/kanban/${board.id}`
            return (
              <div key={board.id} className="group flex items-center">
                <button
                  type="button"
                  className={cn(
                    'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                    'transition-colors duration-75',
                    isActive
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                  data-testid={`kanban-board-${board.id}`}
                  onClick={() => navigate({ to: '/kanban/$boardId', params: { boardId: board.id } })}
                >
                  <LayoutDashboardIcon className="size-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{board.name}</span>
                </button>
                <Menu>
                  <MenuTrigger
                    className="opacity-0 group-hover:opacity-100 transition-opacity mr-1"
                  >
                    <Button variant="ghost" size="icon-xs" className="text-muted-foreground/40">
                      <MoreHorizontalIcon />
                    </Button>
                  </MenuTrigger>
                  <MenuPopup side="right" align="start">
                    <MenuItem
                      variant="destructive"
                      onClick={() => {
                        deleteBoard.mutate(board.id)
                        if (isActive) {
                          navigate({ to: '/kanban' })
                        }
                      }}
                    >
                      <Trash2Icon />
                      删除
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </div>
            )
          })}

          {/* Inline create */}
          {isCreating && (
            <div className="px-2 py-1">
              <Input
                ref={inputRef}
                data-testid="kanban-new-board-input"
                placeholder="看板名称"
                className="h-7 text-sm"
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

          {/* Milestones section */}
          {milestones.length > 0 && (
            <>
              <div className="mt-4 px-3 pb-1">
                <span className="text-xs font-medium text-muted-foreground/60">里程碑</span>
              </div>
              {milestones.map(ms => (
                <div
                  key={ms.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground"
                >
                  <FlagIcon className="size-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{ms.title}</span>
                  {ms.status === 'closed' && (
                    <span className="text-xs text-muted-foreground/30 ml-auto">已关闭</span>
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
