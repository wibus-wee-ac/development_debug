// Input: boardId, workspaceId, selectedIssueId, onSelectIssue
// Output: Main kanban view with toolbar + board/list layout
// Position: Entry point for the kanban feature UI

import { useCallback, useMemo, useReducer } from 'react'

import { CreateIssueDialog } from './create-issue-dialog'
import { IssueDetail } from './issue-detail'
import { KanbanBoard } from './kanban-board'
import { KanbanList } from './kanban-list'
import { KanbanToolbar } from './kanban-toolbar'
import { useIssues, useMilestones, useMoveIssue, useStatuses } from './use-kanban'
import { useViewConfig } from './use-view-config'
import type { FilterState } from './use-view-config'

interface KanbanViewProps {
  boardId: string
  workspaceId: string
  selectedIssueId?: string | null
  onSelectIssue?: (id: string | null) => void
}

interface KanbanViewUiState {
  searchQuery: string
  createDialogOpen: boolean
  createDefaultStatusId?: string
  localSelectedIssueId: string | null
}

type KanbanViewUiAction =
  | { type: 'set-search', searchQuery: string }
  | { type: 'open-create', defaultStatusId?: string }
  | { type: 'close-create' }
  | { type: 'select-issue', issueId: string | null }

function kanbanViewUiReducer(state: KanbanViewUiState, action: KanbanViewUiAction): KanbanViewUiState {
  switch (action.type) {
    case 'set-search':
      return { ...state, searchQuery: action.searchQuery }
    case 'open-create':
      return { ...state, createDialogOpen: true, createDefaultStatusId: action.defaultStatusId }
    case 'close-create':
      return { ...state, createDialogOpen: false }
    case 'select-issue':
      return { ...state, localSelectedIssueId: action.issueId }
    default:
      return state
  }
}

export function KanbanView({ boardId: _boardId, workspaceId, selectedIssueId: externalSelectedIssueId, onSelectIssue }: KanbanViewProps) {
  const { config, setConfig, filter, setFilter, resetFilter } = useViewConfig(workspaceId)
  const [uiState, dispatch] = useReducer(kanbanViewUiReducer, {
    searchQuery: '',
    createDialogOpen: false,
    createDefaultStatusId: undefined,
    localSelectedIssueId: externalSelectedIssueId ?? null,
  })
  const selectedIssueId = uiState.localSelectedIssueId || externalSelectedIssueId || null

  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const { data: allIssues = [] } = useIssues({ workspaceId })
  const moveIssue = useMoveIssue()

  // Apply filters
  const filteredIssues = useMemo(() => {
    let result = allIssues

    if (filter.statusIds?.length) {
      result = result.filter(i => i.statusId && filter.statusIds!.includes(i.statusId))
    }
    if (filter.priorities?.length) {
      result = result.filter(i => filter.priorities!.includes(i.priority as FilterState['priorities'] extends (infer T)[] | undefined ? T : never))
    }
    if (filter.labels?.length) {
      result = result.filter(i => {
        const issueLabels: string[] = (() => { try { return JSON.parse(i.labels || '[]') } catch { return [] } })()
        return filter.labels!.some(l => issueLabels.includes(l))
      })
    }
    if (filter.milestoneId) {
      result = result.filter(i => i.milestoneId === filter.milestoneId)
    }
    if (filter.isDelegated === true) {
      result = result.filter(i => !!i.delegateAgentId)
    }

    // Search
    if (uiState.searchQuery.trim()) {
      const q = uiState.searchQuery.toLowerCase()
      result = result.filter(i =>
        i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q),
      )
    }

    // Sort
    result = result.toSorted((a, b) => {
      const dir = config.orderDirection === 'asc' ? 1 : -1
      if (config.orderBy === 'priority') {
        const pOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
        return dir * ((pOrder[a.priority as keyof typeof pOrder] ?? 4) - (pOrder[b.priority as keyof typeof pOrder] ?? 4))
      }
      if (config.orderBy === 'created') {
        return dir * ((a.createdAt ?? 0) - (b.createdAt ?? 0))
      }
      if (config.orderBy === 'updated') {
        return dir * ((a.updatedAt ?? 0) - (b.updatedAt ?? 0))
      }
      return dir * ((a.order ?? 0) - (b.order ?? 0))
    })

    return result
  }, [allIssues, filter, uiState.searchQuery, config.orderBy, config.orderDirection])

  const handleIssueClick = useCallback((id: string) => {
    dispatch({ type: 'select-issue', issueId: id })
    onSelectIssue?.(id)
  }, [onSelectIssue])

  const handleMoveIssue = useCallback((issueId: string, targetGroupId: string) => {
    if (config.groupBy === 'status') {
      moveIssue.mutate({ id: issueId, statusId: targetGroupId })
    }
  }, [config.groupBy, moveIssue])

  const handleCreateIssue = useCallback((groupId: string) => {
    dispatch({
      type: 'open-create',
      defaultStatusId: config.groupBy === 'status' ? groupId : undefined,
    })
  }, [config.groupBy])

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden h-full">
      {selectedIssueId ? (
        <IssueDetail
          issueId={selectedIssueId}
          workspaceId={workspaceId}
          onBack={() => {
            dispatch({ type: 'select-issue', issueId: null })
            onSelectIssue?.(null)
          }}
        />
      ) : (
        <>
          <KanbanToolbar
            config={config}
            setConfig={setConfig}
            filter={filter}
            setFilter={setFilter}
            resetFilter={resetFilter}
            searchQuery={uiState.searchQuery}
            onSearchChange={(value) => dispatch({ type: 'set-search', searchQuery: value })}
            onCreateIssue={() => dispatch({ type: 'open-create' })}
          />

          {config.layout === 'board' ? (
            <KanbanBoard
              workspaceId={workspaceId}
              issues={filteredIssues}
              statuses={statuses}
              milestones={milestones}
              config={config}
              onIssueClick={handleIssueClick}
              onMoveIssue={handleMoveIssue}
              onCreateIssue={handleCreateIssue}
            />
          ) : (
            <KanbanList
              issues={filteredIssues}
              statuses={statuses}
              milestones={milestones}
              config={config}
              selectedIssueId={selectedIssueId}
              onIssueClick={handleIssueClick}
            />
          )}

          <CreateIssueDialog
            workspaceId={workspaceId}
            defaultStatusId={uiState.createDefaultStatusId}
            open={uiState.createDialogOpen}
            onClose={() => dispatch({ type: 'close-create' })}
          />
        </>
      )}
    </div>
  )
}
