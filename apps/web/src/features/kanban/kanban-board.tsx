// Input: Issues, statuses, view config, event handlers
// Output: Horizontal scrollable board with DnD columns
// Position: Board layout component for kanban view

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useMemo, useState } from 'react'

import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/lib/types'

import type { ViewConfig } from './use-view-config'
import { KanbanCard } from './kanban-card'
import { KanbanColumn } from './kanban-column'

interface BoardProps {
  workspaceId: string
  issues: KanbanIssue[]
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  config: ViewConfig
  onIssueClick: (id: string) => void
  onMoveIssue: (issueId: string, targetGroupId: string) => void
  onCreateIssue: (groupId: string) => void
}

interface GroupDef {
  id: string
  name: string
  category?: 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
}

export function KanbanBoard({
  workspaceId,
  issues,
  statuses,
  milestones,
  config,
  onIssueClick,
  onMoveIssue,
  onCreateIssue,
}: BoardProps) {
  const [activeIssue, setActiveIssue] = useState<KanbanIssue | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const groups = useMemo((): GroupDef[] => {
    if (config.groupBy === 'status') {
      return statuses.map(s => ({
        id: s.id,
        name: s.name,
        category: s.category as GroupDef['category'],
      }))
    }
    if (config.groupBy === 'priority') {
      return [
        { id: 'urgent', name: '紧急' },
        { id: 'high', name: '高' },
        { id: 'medium', name: '中' },
        { id: 'low', name: '低' },
        { id: 'none', name: '无' },
      ]
    }
    if (config.groupBy === 'milestone') {
      const ms: GroupDef[] = milestones.map(m => ({ id: m.id, name: m.title }))
      ms.push({ id: '__none__', name: '无里程碑' })
      return ms
    }
    return statuses.map(s => ({
      id: s.id,
      name: s.name,
      category: s.category as GroupDef['category'],
    }))
  }, [config.groupBy, statuses, milestones])

  const groupedIssues = useMemo(() => {
    const map: Record<string, KanbanIssue[]> = {}
    for (const g of groups) map[g.id] = []

    for (const issue of issues) {
      let groupId: string
      if (config.groupBy === 'status') {
        groupId = issue.statusId ?? ''
      } else if (config.groupBy === 'priority') {
        groupId = issue.priority
      } else if (config.groupBy === 'milestone') {
        groupId = issue.milestoneId ?? '__none__'
      } else {
        groupId = issue.statusId ?? ''
      }
      if (!map[groupId]) map[groupId] = []
      map[groupId].push(issue)
    }
    return map
  }, [issues, groups, config.groupBy])

  const handleDragStart = (event: DragStartEvent) => {
    const issue = event.active.data.current?.issue as KanbanIssue | undefined
    if (issue) setActiveIssue(issue)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveIssue(null)
    const { active, over } = event
    if (!over) return
    const issueId = active.id as string
    const targetGroupId = over.id as string
    if (targetGroupId && issueId) {
      onMoveIssue(issueId, targetGroupId)
    }
  }

  const visibleGroups = config.showEmptyGroups
    ? groups
    : groups.filter(g => (groupedIssues[g.id]?.length ?? 0) > 0)

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex-1 flex gap-2 overflow-x-auto px-4 py-2" data-testid="kanban-board">
        {visibleGroups.map(group => (
          <KanbanColumn
            key={group.id}
            workspaceId={workspaceId}
            groupId={group.id}
            groupName={group.name}
            category={group.category}
            issues={groupedIssues[group.id] ?? []}
            displayProperties={config.displayProperties}
            onIssueClick={onIssueClick}
            onCreateIssue={onCreateIssue}
          />
        ))}
      </div>

      <DragOverlay>
        {activeIssue && (
          <div className="w-72 opacity-90">
            <KanbanCard
              issue={activeIssue}
              displayProperties={config.displayProperties}
              onClick={() => {}}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
