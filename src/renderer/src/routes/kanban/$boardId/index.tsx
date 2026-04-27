// Input: KanbanBoardView, useBoard, AppLayout, search params
// Output: Board index page — kanban columns with inline issue detail panel
// Position: Index route for /kanban/$boardId

import { AppLayout } from '@renderer/components/layout/app-layout'
import { KanbanBoardView } from '@renderer/features/kanban/kanban-board-view'
import { useBoard } from '@renderer/features/kanban/use-kanban'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

interface BoardSearch {
  issue?: string
}

export const Route = createFileRoute('/kanban/$boardId/')({
  component: KanbanBoardPage,
  validateSearch: (search: Record<string, unknown>): BoardSearch => {
    return {
      issue: typeof search.issue === 'string' ? search.issue : undefined,
    }
  },
})

function KanbanBoardPage() {
  const { boardId } = Route.useParams()
  const { issue: selectedIssueId } = Route.useSearch()
  const { data: board } = useBoard(boardId)
  const navigate = useNavigate()

  const handleSelectIssue = useCallback((issueId: string | null) => {
    navigate({
      to: '/kanban/$boardId',
      params: { boardId },
      search: issueId ? { issue: issueId } : {},
      replace: true,
    })
  }, [navigate, boardId])

  if (!board) return null

  return (
    <AppLayout title={board.name} hasAside={false} hasPanel={false}>
      <KanbanBoardView
        boardId={boardId}
        workspaceId={board.workspaceId}
        selectedIssueId={selectedIssueId}
        onSelectIssue={handleSelectIssue}
      />
    </AppLayout>
  )
}
