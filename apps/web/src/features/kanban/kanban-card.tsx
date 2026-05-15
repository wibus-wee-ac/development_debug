// Input: KanbanIssue, display properties, click handler
// Output: Compact draggable card for board view
// Position: Board card component used inside kanban columns

import { useDraggable } from '@dnd-kit/core'
import { BotIcon } from 'lucide-react'

import { cn } from '~/lib/cn'
import type { KanbanIssue } from '~/lib/types'

import type { ViewConfig } from './use-view-config'
import { AssigneeAvatar } from './shared/assignee-avatar'
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
          'bg-card rounded-lg px-3 py-2 cursor-pointer',
          'transition-[background-color,transform] duration-150 ease-out',
          'hover:bg-accent',
          'active:scale-[0.97]',
          isDragging && 'opacity-50',
        )}
      >
        {/* Title row with status icon */}
        <div className="flex items-start gap-2">
          {displayProperties.status && category && (
            <span className="mt-0.5 shrink-0">
              <StatusIcon category={category as 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'} size={14} />
            </span>
          )}
          <p className="text-[13px] font-medium text-foreground leading-snug text-pretty">
            {issue.title}
          </p>
        </div>

        {/* Metadata row — always show when there's any data to display */}
        <div className="flex items-center gap-2 mt-2 text-muted-foreground flex-wrap">
            {displayProperties.priority && issue.priority !== 'none' && (
              <span className="flex items-center gap-0.5 text-[11px]">
                <PriorityIcon priority={issue.priority as 'none' | 'low' | 'medium' | 'high' | 'urgent'} size={12} />
                <span>{priorityLabel[issue.priority] ?? ''}</span>
              </span>
            )}

            {displayProperties.id && (
              <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                {issue.id.slice(0, 6).toUpperCase()}
              </span>
            )}

            {displayProperties.labels && labels.length > 0 && (
              <div className="flex items-center gap-0.5">
                {labels.slice(0, 2).map(l => <LabelChip key={l} label={l} />)}
                {labels.length > 2 && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">+{labels.length - 2}</span>
                )}
              </div>
            )}

            {displayProperties.agentIndicator && issue.delegateAgentId && (
              <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <BotIcon className="size-3" />
              </span>
            )}

            <div className="flex-1" />

            {displayProperties.assignee && (
              issue.assigneeId
                ? <AssigneeAvatar name={issue.assigneeId} size={16} />
                : (
                    <span className="size-4 shrink-0 rounded-full border border-dashed border-muted-foreground" />
                  )
            )}
          </div>
      </div>
    </div>
  )
}
