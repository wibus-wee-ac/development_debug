// Input: KanbanIssue, statuses, display properties
// Output: Ultra-compact list row (32px height)
// Position: List view row component

import { BotIcon } from 'lucide-react'

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
        'group/row relative flex items-center gap-2 px-3 h-9 text-[13px] cursor-pointer rounded-md',
        'transition-colors duration-100 ease-out',
        'first:mt-1',
        selected ? 'bg-muted' : 'hover:bg-muted',
      )}
    >
      {/* Selected indicator */}
      {selected && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
      )}

      {/* Left: status + priority icons — fixed width so titles align */}
      <span className="flex items-center gap-1.5 shrink-0">
        {displayProperties.status && (
          <StatusIcon category={category} size={14} />
        )}
        {displayProperties.priority && (
          <PriorityIcon priority={issue.priority as 'none' | 'low' | 'medium' | 'high' | 'urgent'} size={14} />
        )}
      </span>

      {/* ID — mono, fixed width */}
      {displayProperties.id && (
        <span className="text-[11px] font-mono text-muted-foreground w-12 shrink-0 tabular-nums">
          {issue.id.slice(0, 6).toUpperCase()}
        </span>
      )}

      {/* Title */}
      <span className="flex-1 truncate text-foreground">
        {issue.title}
      </span>

      {/* Right: metadata — only visible on hover or when selected */}
      <span className={cn(
        'flex items-center gap-2 shrink-0',
        'transition-opacity duration-100',
        selected ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
      )}>
        {displayProperties.agentIndicator && issue.delegateAgentProfileId && (
          <BotIcon className="size-3 text-muted-foreground" />
        )}

        {displayProperties.labels && labels.length > 0 && (
          <span className="flex items-center gap-1">
            {labels.slice(0, 2).map(l => <LabelChip key={l} label={l} />)}
            {labels.length > 2 && (
              <span className="text-[11px] text-muted-foreground tabular-nums">+{labels.length - 2}</span>
            )}
          </span>
        )}

        {displayProperties.assignee && issue.assigneeId && (
          <AssigneeAvatar name={issue.assigneeId} size={16} />
        )}

        {displayProperties.createdAt && issue.createdAt && (
          <span className="text-[11px] text-muted-foreground w-8 text-right tabular-nums">
            {formatRelativeTime(issue.createdAt)}
          </span>
        )}
      </span>
    </div>
  )
}
