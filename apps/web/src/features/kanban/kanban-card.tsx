// Input: KanbanIssue, display properties, click handler
// Output: Draggable card for board view
// Position: Board card component used inside kanban columns

import { useDraggable } from '@dnd-kit/core'
import { BotIcon } from 'lucide-react'

import { cn } from '~/lib/cn'
import type { KanbanIssue } from '~/lib/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'

import type { ViewConfig } from './use-view-config'
import { AssigneeAvatar } from './shared/assignee-avatar'
import { formatIssueId } from './shared/format-issue-id'
import { parseIssueLabels } from './shared/issue-metadata'
import { LabelChip } from './shared/label-chip'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'

interface CardProps {
  issue: KanbanIssue
  displayProperties: ViewConfig['displayProperties']
  onClick: () => void
  category?: string
}

const priorityLabel: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function KanbanCard({ issue, displayProperties, onClick, category }: CardProps) {
  const { workspaces } = useWorkspaces()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.id,
    data: { issue },
  })

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  const labels = parseIssueLabels(issue.labels)

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
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onClick() } }}
        data-testid={`issue-card-${issue.id}`}
        className={cn(
          'bg-card rounded-md px-3.5 py-3 pb-2.5 cursor-pointer border border-border shadow-xs dark:border-muted',
          'flex flex-col gap-1',
          // 'shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.05)]',
          'transition-[transform,box-shadow,border] duration-150 ease-out',
          // 'hover:shadow-[0_3px_10px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.07)]',
          'hover:bg-background/50',
          'transition-colors duration-150 ease-out',
          'active:scale-[0.97]',
          isDragging && 'opacity-50',
        )}
      >

        <div className="flex justify-between">
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
        </div>

        {/* Title */}
        <div className="flex items-start gap-2">
          {displayProperties.status && category && (
            <span className="mt-1 shrink-0">
              <StatusIcon category={category as 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'} size={16} />
            </span>
          )}
          <p className="text-[13px] font-medium text-foreground leading-relaxed text-pretty">
            {issue.title}
          </p>
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-2 mt-2.5 text-muted-foreground">
          {displayProperties.priority && issue.priority !== 'none' && (
            <span className="flex items-center gap-1 text-[11px]">
              <PriorityIcon priority={issue.priority as 'none' | 'low' | 'medium' | 'high' | 'urgent'} size={13} />
              <span>{priorityLabel[issue.priority] ?? ''}</span>
            </span>
          )}

          {displayProperties.labels && labels.length > 0 && (
            <div className="flex items-center gap-1">
              {labels.slice(0, 2).map(l => <LabelChip key={l} label={l} />)}
              {labels.length > 2 && (
                <span className="text-[11px] text-muted-foreground tabular-nums">+{labels.length - 2}</span>
              )}
            </div>
          )}

          {/* <div className="flex-1" /> */}
        </div>
      </div>
    </div>
  )
}
