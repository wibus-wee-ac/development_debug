// Input: KanbanBoardView, useBoard, AppLayout
// Output: Board index page — shows kanban columns
// Position: Index route for /kanban/$boardId

import { AppLayout } from '@renderer/components/layout/app-layout'
import { KanbanBoardView } from '@renderer/features/kanban/kanban-board-view'
import { useBoard } from '@renderer/features/kanban/use-kanban'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/kanban/$boardId/')({
  component: KanbanBoardPage,
})

function KanbanBoardPage() {
  const { boardId } = Route.useParams()
  const { data: board } = useBoard(boardId)

  if (!board) {
    return null
  }

  return (
    <AppLayout title={board.name} hasAside={false} hasPanel={false}>
      <KanbanBoardView boardId={boardId} workspaceId={board.workspaceId} />
    </AppLayout>
  )
}
