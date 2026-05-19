// Input: KanbanIssue, statuses, milestones, display properties
// Output: Ultra-compact list row (32px height)
// Position: List view row component

import { BotIcon } from 'lucide-react'

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
import type { StatusCategory, ViewConfig } from './use-view-config'

interface ListRowProps {
  issue: KanbanIssue
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  displayProperties: ViewConfig['displayProperties']
  onClick: () => void
  onHover?: (id: string | null) => void
  selected?: boolean
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function KanbanListRow({ issue, statuses, milestones, displayProperties, onClick, onHover, selected }: ListRowProps) {
  const { workspaces } = useWorkspaces()
  const status = statuses.find(s => s.id === issue.statusId)
  const category = (status?.category ?? 'unstarted') as StatusCategory
  const labels = parseIssueLabels(issue.labels)

  return (
    <IssueContextMenu issue={issue} statuses={statuses} milestones={milestones} onOpen={onClick}>
      <button
        type="button"
        aria-label={`Open issue ${issue.title}`}
        onClick={onClick}
        onMouseEnter={() => onHover?.(issue.id)}
        onMouseLeave={() => onHover?.(null)}
        className={cn(
          'group/row relative flex w-full items-center gap-2 px-3 h-9 text-left text-[13px] cursor-pointer rounded-md',
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
          <span className="text-[11px] font-mono text-muted-foreground shrink-0 tabular-nums">
            {formatIssueId(issue, workspaces)}
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
          selected ? 'opacity-100' : 'opacity-50 group-hover/row:opacity-100',
        )}
        >
          {displayProperties.agentIndicator && issue.delegateAgentProfileId && (
            <BotIcon className="size-3 text-muted-foreground" />
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

          {displayProperties.assignee && issue.assigneeId && (
            <AssigneeAvatar name={issue.assigneeId} size={16} />
          )}

          {displayProperties.createdAt && issue.createdAt && (
            <span className="text-[11px] text-muted-foreground w-8 text-right tabular-nums">
              {formatRelativeTime(issue.createdAt)}
            </span>
          )}
        </span>
      </button>
    </IssueContextMenu>
  )
}
