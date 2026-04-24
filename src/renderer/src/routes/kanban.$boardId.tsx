import { KanbanBoardView } from '@renderer/features/kanban/kanban-board-view'
import { useBoard } from '@renderer/features/kanban/use-kanban'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/kanban/$boardId')({
  component: RouteComponent,
})

function RouteComponent() {
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
