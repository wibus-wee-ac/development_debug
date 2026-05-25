import { useTabsContext } from '@cradle/tabs-next'
import { LayoutDashboardIcon } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Spinner } from '~/components/ui/spinner'
import { KanbanView } from '~/features/kanban/index'
import { useBoard, useIssue } from '~/features/kanban/use-kanban'

export function KanbanBoardTabContent({ params }: { params: { boardId?: string, issue?: string, milestoneId?: string } }) {
  const { t } = useTranslation('kanban')
  const { store } = useTabsContext()
  const { data: board, isLoading } = useBoard(params.boardId ?? '')
  const { data: issue } = useIssue(params.issue ?? '')

  // Update tab label: issue title when viewing issue, board name otherwise
  useEffect(() => {
    const activeTab = store.getState().getActiveTab()
    if (!activeTab || activeTab.type !== 'kanban-board') {
      return
    }
    if (params.issue && issue?.title) {
      store.getState().updateTabLabel(activeTab.id, issue.title)
    }
    else if (board?.name) {
      store.getState().updateTabLabel(activeTab.id, board.name)
    }
  }, [board?.name, issue?.title, params.issue, store])

  const handleSelectIssue = useCallback((issueId: string | null) => {
    const activeTab = store.getState().getActiveTab()
    if (activeTab) {
      store.getState().updateTabParams(activeTab.id, { issue: issueId ?? undefined })
    }
  }, [store])

  const handleOpenMilestone = useCallback((milestoneId: string) => {
    const activeTab = store.getState().getActiveTab()
    if (activeTab) {
      store.getState().updateTabParams(activeTab.id, { issue: undefined, milestoneId })
    }
  }, [store])

  if (!params.boardId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <LayoutDashboardIcon className="size-8" />
        <p className="text-[12px]">{t('board.emptySelection')}</p>
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
    <KanbanView
      boardId={params.boardId}
      workspaceId={board.workspaceId}
      selectedIssueId={params.issue}
      initialMilestoneId={params.milestoneId}
      onSelectIssue={handleSelectIssue}
      onOpenMilestone={handleOpenMilestone}
    />
  )
}
