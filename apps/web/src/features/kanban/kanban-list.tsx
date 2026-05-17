// Input: Issues, statuses, milestones, view config, event handlers
// Output: Grouped list view with collapsible sections
// Position: List layout component for kanban view

import { AnimatePresence, m } from 'motion/react'
import { useMemo, useState } from 'react'

import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/lib/types'

import type { ViewConfig } from './use-view-config'
import { KanbanGroupHeader } from './kanban-group-header'
import { KanbanListRow } from './kanban-list-row'
import { cn } from '~/lib/cn'

interface ListProps {
  issues: KanbanIssue[]
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  config: ViewConfig
  selectedIssueId?: string | null
  onIssueClick: (id: string) => void
  onIssueHover?: (id: string | null) => void
  onCreateIssue?: (groupId: string) => void
}

interface GroupDef {
  id: string
  name: string
  category?: 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
}

export function KanbanList({
  issues,
  statuses,
  milestones,
  config,
  selectedIssueId,
  onIssueHover,
  onCreateIssue,
  onIssueClick,
}: ListProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

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

  const visibleGroups = config.showEmptyGroups
    ? groups
    : groups.filter(g => (groupedIssues[g.id]?.length ?? 0) > 0)

  const toggleCollapse = (groupId: string) => {
    setCollapsed(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1">
      {visibleGroups.map(group => {
        const groupIssues = groupedIssues[group.id] ?? []
        const isCollapsed = collapsed[group.id] ?? false

        return (
          <div key={group.id} className="flex flex-col">
            <KanbanGroupHeader
              name={group.name}
              count={groupIssues.length}
              category={group.category}
              collapsed={isCollapsed}
              onToggle={() => toggleCollapse(group.id)}
              onCreateIssue={onCreateIssue ? () => onCreateIssue(group.id) : undefined}
            />
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <m.div
                  key={`${group.id}-content`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
                  className={cn(
                    'overflow-hidden flex flex-col gap-0.5',
                  )}
                >
                  {groupIssues.map(issue => (
                    <KanbanListRow
                      key={issue.id}
                      issue={issue}
                      statuses={statuses}
                      displayProperties={config.displayProperties}
                      onClick={() => onIssueClick(issue.id)}
                      onHover={onIssueHover ? (id: string | null) => onIssueHover(id) : undefined}
                      selected={issue.id === selectedIssueId}
                    />
                  ))}
                </m.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}
