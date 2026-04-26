// Input: useBoard hook, TanStack Router Outlet
// Output: /kanban/$boardId layout route — loading/error guard
// Position: Layout route that validates board exists before rendering children

import { useBoard } from '@renderer/features/kanban/use-kanban'
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/kanban/$boardId')({
  component: KanbanBoardLayout,
})

function KanbanBoardLayout() {
  const { boardId } = Route.useParams()
  const { data: board, isLoading } = useBoard(boardId)

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  if (!board) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
        看板未找到
      </div>
    )
  }

  return <Outlet />
}
