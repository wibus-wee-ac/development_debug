// Input: KanbanIssue, display properties, related metadata, click handler
// Output: Draggable card for board view
// Position: Board card component used inside kanban columns

import { useDraggable } from '@dnd-kit/core'

import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/lib/types'

import { IssueContextMenu } from './issue-context-menu'
import { AssigneeAvatar } from './shared/assignee-avatar'
import { formatIssueId } from './shared/format-issue-id'
import { parseIssueLabels } from './shared/issue-metadata'
import { LabelChip } from './shared/label-chip'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import type { ViewConfig } from './use-view-config'

interface CardProps {
  issue: KanbanIssue
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  displayProperties: ViewConfig['displayProperties']
  onClick: () => void
  onHover?: (id: string | null) => void
  category?: string
}

const priorityLabel: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function KanbanCard({ issue, statuses, milestones, displayProperties, onClick, onHover, category }: CardProps) {
  const { workspaces } = useWorkspaces()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.id,
    data: { issue },
  })
  const { role: _draggableRole, tabIndex: _draggableTabIndex, ...draggableAttributes } = attributes

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  const labels = parseIssueLabels(issue.labels)

  return (
    <div
      data-testid={`issue-sortable-${issue.id}`}
      onMouseEnter={() => onHover?.(issue.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <IssueContextMenu issue={issue} statuses={statuses} milestones={milestones} onOpen={onClick}>
        <button
          type="button"
          ref={setNodeRef}
          style={style}
          {...draggableAttributes}
          {...listeners}
          aria-label={`Open issue ${issue.title}`}
          onClick={(e) => {
            e.stopPropagation()
            onClick()
          }}
          data-testid={`issue-card-${issue.id}`}
          className={cn(
            'w-full bg-card rounded-md px-3.5 py-3 pb-2.5 cursor-pointer border border-border/80 text-left',
            'flex flex-col gap-1',
            'shadow-[var(--shadow-xs)]',
            'transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out',
            'hover:shadow-[var(--shadow-sm)] hover:border-border hover:bg-card',
            'active:scale-[0.96]',
            isDragging && 'opacity-50',
          )}
        >

          <span className="flex justify-between">
            {displayProperties.id && (
              <span className="text-[10.5px] text-muted-foreground tabular-nums">
                {formatIssueId(issue, workspaces)}
              </span>
            )}

            {displayProperties.assignee && (
              issue.assigneeId
                ? <AssigneeAvatar name={issue.assigneeId} size={18} />
                : <span className="size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground" />
            )}
          </span>

          <span className="flex items-start gap-2">
            {displayProperties.status && category && (
              <span className="mt-1 shrink-0">
                <StatusIcon category={category as 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'} size={16} />
              </span>
            )}
            <span className="text-[13px] font-medium text-foreground leading-snug tracking-tight text-balance">
              {issue.title}
            </span>
          </span>

          <span className="flex items-center gap-2 mt-2.5 text-muted-foreground">
            {displayProperties.priority && issue.priority !== 'none' && (
              <span className="flex items-center gap-1 text-[11px]">
                <PriorityIcon priority={issue.priority as 'none' | 'low' | 'medium' | 'high' | 'urgent'} size={13} />
                <span>{priorityLabel[issue.priority] ?? ''}</span>
              </span>
            )}

            {displayProperties.labels && labels.length > 0 && (
              <span className="flex items-center gap-1">
                {labels.slice(0, 2).map(l => <LabelChip key={l} label={l} />)}
                {labels.length > 2 && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    +
                    {labels.length - 2}
                  </span>
                )}
              </span>
            )}
          </span>
        </button>
      </IssueContextMenu>
    </div>
  )
}
