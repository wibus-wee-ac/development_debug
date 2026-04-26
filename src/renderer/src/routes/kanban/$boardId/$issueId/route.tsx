// Input: IssuePanel, IssueProperties, useBoard, useIssue, AppLayout
// Output: Issue detail page with properties in aside
// Position: Route for /kanban/$boardId/$issueId

import { AppLayout } from '@renderer/components/layout/app-layout'
import { IssuePanel, IssueProperties } from '@renderer/features/kanban/issue-panel'
import { useBoard, useIssue } from '@renderer/features/kanban/use-kanban'
import { useLayoutStore } from '@renderer/store/layout'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/kanban/$boardId/$issueId')({
  component: IssueDetailPage,
})

function IssueDetailPage() {
  const { boardId, issueId } = Route.useParams()
  const { data: board, isLoading: boardLoading } = useBoard(boardId)
  const { data: issue } = useIssue(issueId)
  const navigate = useNavigate()

  // Auto-open aside when entering issue detail
  const asideOpen = useLayoutStore(s => s.asideOpen)
  const toggleAside = useLayoutStore(s => s.toggleAside)
  useEffect(() => {
    if (!asideOpen) {
      toggleAside()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (boardLoading || !board) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
        {boardLoading ? 'Loading…' : 'Board not found'}
      </div>
    )
  }

  const goBack = () => navigate({ to: '/kanban/$boardId', params: { boardId } })

  return (
    <AppLayout
      workspace={
        <button
          onClick={goBack}
          className="hover:text-foreground/70 transition-colors"
        >
          {board.name}
        </button>
      }
      title={issue?.title ?? '…'}
      hasAside
      hasPanel={false}
      aside={<IssueProperties issueId={issueId} workspaceId={board.workspaceId} />}
    >
      <IssuePanel
        issueId={issueId}
        workspaceId={board.workspaceId}
      />
    </AppLayout>
  )
}
