// Input: KanbanBoardView feature, useBoard hook
// Output: KanbanBoardPage lazy component for /kanban/$boardId
// Position: Lazy-loaded component chunk — contains dnd-kit board view

import { RouteLoadingFallback } from '@renderer/components/ui/route-loading-fallback'
import { KanbanBoardView } from '@renderer/features/kanban/kanban-board-view'
import { useBoard } from '@renderer/features/kanban/use-kanban'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/kanban/$boardId')({
  component: KanbanBoardPage,
  pendingComponent: RouteLoadingFallback,
})

function KanbanBoardPage() {
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

  return <KanbanBoardView boardId={boardId} workspaceId={board.workspaceId} />
}
