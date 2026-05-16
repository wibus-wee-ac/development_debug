// Input: boardId, workspaceId, selectedIssueId, onSelectIssue
// Output: Main kanban view with toolbar + board/list layout
// Position: Entry point for the kanban feature UI

import { useCallback, useMemo, useState } from 'react'

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

export function KanbanView({ boardId: _boardId, workspaceId, selectedIssueId, onSelectIssue }: KanbanViewProps) {
  const { config, setConfig, filter, setFilter, resetFilter } = useViewConfig(workspaceId)
  const [searchQuery, setSearchQuery] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createDefaultStatusId, setCreateDefaultStatusId] = useState<string | undefined>()

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
      result = result.filter(i => !!i.delegateAgentProfileId)
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
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
  }, [allIssues, filter, searchQuery, config.orderBy, config.orderDirection])

  const handleIssueClick = useCallback((id: string) => {
    onSelectIssue?.(id)
  }, [onSelectIssue])

  const handleMoveIssue = useCallback((issueId: string, targetGroupId: string) => {
    if (config.groupBy === 'status') {
      moveIssue.mutate({ id: issueId, statusId: targetGroupId })
    }
  }, [config.groupBy, moveIssue])

  const handleCreateIssue = useCallback((groupId: string) => {
    setCreateDefaultStatusId(config.groupBy === 'status' ? groupId : undefined)
    setCreateDialogOpen(true)
  }, [config.groupBy])

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden h-full">
      {selectedIssueId ? (
        <IssueDetail
          issueId={selectedIssueId}
          workspaceId={workspaceId}
          onBack={() => onSelectIssue?.(null)}
        />
      ) : (
        <>
          <KanbanToolbar
            config={config}
            setConfig={setConfig}
            filter={filter}
            setFilter={setFilter}
            resetFilter={resetFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onCreateIssue={() => setCreateDialogOpen(true)}
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
              onCreateIssue={handleCreateIssue}
            />
          )}

          <CreateIssueDialog
            workspaceId={workspaceId}
            defaultStatusId={createDefaultStatusId}
            open={createDialogOpen}
            onClose={() => setCreateDialogOpen(false)}
          />
        </>
      )}
    </div>
  )
}
