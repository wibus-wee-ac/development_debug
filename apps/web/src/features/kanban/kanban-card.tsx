// Input: KanbanIssue, display properties, click handler
// Output: Compact draggable card for board view
// Position: Board card component used inside kanban columns

import { useDraggable } from '@dnd-kit/core'

import { cn } from '~/lib/cn'
import type { KanbanIssue } from '~/lib/types'

import type { ViewConfig } from './use-view-config'
import { AssigneeAvatar } from './shared/assignee-avatar'
import { LabelChip } from './shared/label-chip'
import { PriorityIcon } from './shared/priority-icon'

interface CardProps {
  issue: KanbanIssue
  displayProperties: ViewConfig['displayProperties']
  onClick: () => void
}

export function KanbanCard({ issue, displayProperties, onClick }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.id,
    data: { issue },
  })

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  const labels: string[] = (() => {
    try { return JSON.parse(issue.labels || '[]') }
    catch { return [] }
  })()

  return (
    <div data-testid={`issue-sortable-${issue.id}`}>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClick() } }}
        data-testid={`issue-card-${issue.id}`}
        className={cn(
          'bg-card rounded-lg px-3 py-2 cursor-pointer transition-colors',
          'hover:bg-muted/50',
          isDragging && 'opacity-50',
        )}
      >
      <p className="text-[13px] font-medium text-foreground leading-snug mb-1.5">
        {issue.title}
      </p>

      <div className="flex items-center gap-2 text-muted-foreground">
        {displayProperties.priority && issue.priority !== 'none' && (
          <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
            <PriorityIcon priority={issue.priority as 'none' | 'low' | 'medium' | 'high' | 'urgent'} size={12} />
            <span>{issue.priority === 'urgent' ? 'Urgent' : issue.priority === 'high' ? 'High' : issue.priority === 'medium' ? 'Medium' : 'Low'}</span>
          </span>
        )}

        {displayProperties.id && (
          <span className="text-[11px] font-mono text-text-dim">
            {issue.id.slice(0, 6).toUpperCase()}
          </span>
        )}

        {displayProperties.labels && labels.length > 0 && (
          <div className="flex items-center gap-1">
            {labels.slice(0, 2).map(l => <LabelChip key={l} label={l} />)}
            {labels.length > 2 && (
              <span className="text-[11px] text-muted-foreground">+{labels.length - 2}</span>
            )}
          </div>
        )}

        <div className="flex-1" />

        {displayProperties.assignee && issue.assigneeId && (
          <AssigneeAvatar name={issue.assigneeId} size={18} />
        )}
      </div>
      </div>
    </div>
  )
}
