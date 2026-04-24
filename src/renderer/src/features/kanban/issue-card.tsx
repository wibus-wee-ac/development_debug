// Input: KanbanIssue type, DnD kit useDraggable, Badge, cn utility
// Output: IssueCard component — draggable card shown in Kanban columns
// Position: Shared card component used in KanbanColumn and IssuePanel sub-issues section

import { useDraggable } from '@dnd-kit/core'
import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '@main/ipc-types'
import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/cn'

interface IssueCardProps {
  issue: KanbanIssue
  status?: KanbanStatus
  milestone?: KanbanMilestone
  onClick?: () => void
  compact?: boolean
}

const PRIORITY_STYLES: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

const PRIORITY_LABELS: Record<string, string> = {
  none: '',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

export function IssueCard({ issue, milestone, onClick, compact = false }: IssueCardProps) {
  const labels: string[] = (() => {
    try {
      return JSON.parse(issue.labels) as string[]
    }
    catch {
      return []
    }
  })()

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.id,
    data: { issueId: issue.id },
  })

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  return (
    <button
      ref={setNodeRef}
      style={style}
      className={cn(
        'w-full text-left rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm',
        'transition-shadow cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isDragging && 'opacity-50 shadow-lg',
        compact && 'py-1.5 text-sm',
      )}
      onClick={onClick}
      {...listeners}
      {...attributes}
    >
      <p className={cn('font-medium leading-snug text-foreground', compact ? 'text-xs' : 'text-sm')}>
        {issue.title}
      </p>

      {!compact && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {issue.priority !== 'none' && (
            <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', PRIORITY_STYLES[issue.priority])}>
              {PRIORITY_LABELS[issue.priority]}
            </span>
          )}
          {labels.slice(0, 2).map(label => (
            <Badge key={label} variant="secondary" size="sm">
              {label}
            </Badge>
          ))}
          {labels.length > 2 && (
            <span className="text-xs text-muted-foreground">
              {`+${labels.length - 2}`}
            </span>
          )}
          {milestone && (
            <span className="text-xs text-muted-foreground truncate max-w-24">
              {'🏁 '}
              {milestone.title}
            </span>
          )}
        </div>
      )}

      {compact && issue.priority !== 'none' && (
        <span className={cn('mt-0.5 inline-block rounded px-1 py-px text-xs font-medium', PRIORITY_STYLES[issue.priority])}>
          {PRIORITY_LABELS[issue.priority]}
        </span>
      )}
    </button>
  )
}
