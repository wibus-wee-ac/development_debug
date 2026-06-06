import { defineTab } from '@cradle/tabs-next'
import { KanbanSquareIcon } from 'lucide-react'
import { lazy } from 'react'

const KanbanBoardContent = lazy(() => import('./kanban-board-tab-content').then(m => ({ default: m.KanbanBoardTabContent })))

export const kanbanBoardTab = defineTab({
  type: 'kanban-board' as const,
  icon: KanbanSquareIcon,
  label: '看板',
  component: KanbanBoardContent,
  serialize: (params) => {
    if (!params.boardId) {
      return ''
    }
    const searchParams = new URLSearchParams()
    if (params.issue) {
      searchParams.set('issue', params.issue)
    }
    if (params.milestoneId) {
      searchParams.set('milestoneId', params.milestoneId)
    }
    const query = searchParams.toString()
    return query ? `${params.boardId}?${query}` : params.boardId
  },
  deserialize: (path) => {
    if (!path) {
      return null
    }
    const [boardId, query] = path.split('?')
    if (!boardId) {
      return null
    }
    const searchParams = new URLSearchParams(query)
    const issue = searchParams.get('issue') ?? undefined
    const milestoneId = searchParams.get('milestoneId') ?? undefined
    return { boardId, issue, milestoneId }
  },
})
