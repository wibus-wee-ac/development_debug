// Input: KanbanIssue, statuses, display properties
// Output: Ultra-compact list row (32px height)
// Position: List view row component

import { cn } from '~/lib/cn'
import type { KanbanIssue, KanbanStatus } from '~/lib/types'

import type { StatusCategory, ViewConfig } from './use-view-config'
import { AssigneeAvatar } from './shared/assignee-avatar'
import { LabelChip } from './shared/label-chip'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'

interface ListRowProps {
  issue: KanbanIssue
  statuses: KanbanStatus[]
  displayProperties: ViewConfig['displayProperties']
  onClick: () => void
  selected?: boolean
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function KanbanListRow({ issue, statuses, displayProperties, onClick, selected }: ListRowProps) {
  const status = statuses.find(s => s.id === issue.statusId)
  const category = (status?.category ?? 'unstarted') as StatusCategory
  const labels: string[] = (() => {
    try { return JSON.parse(issue.labels || '[]') }
    catch { return [] }
  })()

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
      className={cn(
        'h-8 flex items-center gap-2 px-3 text-[13px] cursor-pointer transition-colors',
        'hover:bg-muted/50',
        selected && 'bg-muted/70',
      )}
    >
      {displayProperties.status && (
        <StatusIcon category={category} size={14} />
      )}

      {displayProperties.priority && (
        <PriorityIcon priority={issue.priority as 'none' | 'low' | 'medium' | 'high' | 'urgent'} size={14} />
      )}

      {displayProperties.id && (
        <span className="text-[11px] font-mono text-muted-foreground/70 w-14 shrink-0">
          {issue.id.slice(0, 6).toUpperCase()}
        </span>
      )}

      <span className="flex-1 truncate text-foreground">
        {issue.title}
      </span>

      {displayProperties.labels && labels.length > 0 && (
        <div className="flex items-center gap-1 shrink-0">
          {labels.slice(0, 2).map(l => <LabelChip key={l} label={l} />)}
        </div>
      )}

      {displayProperties.assignee && issue.assigneeId && (
        <AssigneeAvatar name={issue.assigneeId} size={16} />
      )}

      {displayProperties.createdAt && issue.createdAt && (
        <span className="text-[11px] text-muted-foreground/60 w-8 shrink-0 text-right">
          {formatRelativeTime(issue.createdAt)}
        </span>
      )}
    </div>
  )
}
