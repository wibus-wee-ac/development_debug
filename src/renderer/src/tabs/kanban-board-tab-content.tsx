// Input: KanbanBoardView, useBoard, useTabsContext
// Output: KanbanBoardTabContent — wrapper handling board→workspace resolution and issue panel state
// Position: Tab content adapter for kanban board

import { useTabsContext } from '@cradle/tabs'
import { KanbanBoardView } from '@renderer/features/kanban/kanban-board-view'
import { useBoard } from '@renderer/features/kanban/use-kanban'
import { useCallback } from 'react'

export function KanbanBoardTabContent({ params }: { params: { boardId: string, issue?: string } }) {
  const { store } = useTabsContext()
  const { data: board } = useBoard(params.boardId)

  const handleSelectIssue = useCallback((issueId: string | null) => {
    const activeTab = store.getState().getActiveTab()
    if (activeTab) {
      store.getState().updateTabParams(activeTab.id, { issue: issueId ?? undefined })
    }
  }, [store])

  if (!board) {
    return null
  }

  return (
    <KanbanBoardView
      boardId={params.boardId}
      workspaceId={board.workspaceId}
      selectedIssueId={params.issue}
      onSelectIssue={handleSelectIssue}
    />
  )
}
