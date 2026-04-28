/* eslint-disable react-refresh/only-export-components */
// Input: defineTab from @cradle/tabs, KanbanBoardView, useBoard
// Output: kanban-board tab definition
// Position: Tab type for kanban board view with optional issue panel

import { defineTab } from '@cradle/tabs'
import { lazy } from 'react'

const KanbanBoardContent = lazy(() => import('./kanban-board-tab-content').then(m => ({ default: m.KanbanBoardTabContent })))

export const kanbanBoardTab = defineTab({
  type: 'kanban-board' as const,
  label: (params: { boardId: string, issue?: string }) => `看板: ${params.boardId.slice(0, 8)}`,
  component: KanbanBoardContent,
  serialize: (params) => {
    const base = params.boardId
    return params.issue ? `${base}?issue=${params.issue}` : base
  },
  deserialize: (path) => {
    const [boardId, query] = path.split('?')
    if (!boardId) {
      return null
    }
    const issue = new URLSearchParams(query).get('issue') ?? undefined
    return { boardId, issue }
  },
})
