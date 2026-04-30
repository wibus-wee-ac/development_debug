// Input: KanbanBoardView, useBoard, useTabsContext
// Output: KanbanBoardTabContent — wrapper handling board→workspace resolution and issue panel state
// Position: Tab content adapter for kanban board

import { useTabsContext } from '@cradle/tabs'
import { KanbanBoardView } from '@renderer/features/kanban/kanban-board-view'
import { useBoard } from '@renderer/features/kanban/use-kanban'
import { Spinner } from '@renderer/components/ui/spinner'
import { LayoutDashboardIcon } from 'lucide-react'
import { useCallback, useEffect } from 'react'

export function KanbanBoardTabContent({ params }: { params: { boardId?: string, issue?: string } }) {
  const { store } = useTabsContext()
  const { data: board, isLoading } = useBoard(params.boardId ?? '')

  // Update tab label to board name when loaded
  useEffect(() => {
    if (board?.name) {
      const activeTab = store.getState().getActiveTab()
      if (activeTab && activeTab.type === 'kanban-board') {
        store.getState().updateTabLabel(activeTab.id, board.name)
      }
    }
  }, [board?.name, store])

  const handleSelectIssue = useCallback((issueId: string | null) => {
    const activeTab = store.getState().getActiveTab()
    if (activeTab) {
      store.getState().updateTabParams(activeTab.id, { issue: issueId ?? undefined })
    }
  }, [store])

  if (!params.boardId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground/30">
        <LayoutDashboardIcon className="size-8" />
        <p className="text-[12px]">从左侧选择或创建一个看板</p>
      </div>
    )
  }

  if (isLoading || !board) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
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
