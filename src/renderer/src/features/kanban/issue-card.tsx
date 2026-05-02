// Input: KanbanIssue data, priorityIcon, click handler
// Output: IssueCard — rich issue card with assignee, agent, milestone, labels, timestamp
// Position: Leaf component rendered inside KanbanColumn

import type { KanbanIssue } from '@main/ipc-types'
import { Avatar, AvatarFallback } from '@renderer/components/ui/avatar'
import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/cn'
import { BotIcon, FlagIcon, UserIcon } from 'lucide-react'

import { PriorityIcon } from './priority-icon'
import { useMilestones } from './use-kanban'

function relativeShort(unixTs: number): string {
  const secs = Math.floor(Date.now() / 1000) - unixTs
  if (secs < 60) {
    return 'now'
  }
  if (secs < 3600) {
    return `${Math.floor(secs / 60)}m`
  }
  if (secs < 86400) {
    return `${Math.floor(secs / 3600)}h`
  }
  return `${Math.floor(secs / 86400)}d`
}

export interface IssueCardProps {
  issue: KanbanIssue
  onClick: (issue: KanbanIssue) => void
  isDragging?: boolean
  isSelected?: boolean
}

export function IssueCard({ issue, onClick, isDragging, isSelected }: IssueCardProps) {
  const labels: string[] = issue.labels ? JSON.parse(issue.labels) : []
  const { data: milestones = [] } = useMilestones(issue.workspaceId)
  const milestone = issue.milestoneId ? milestones.find(m => m.id === issue.milestoneId) : null
  const hasAgent = !!issue.delegateAgentId
  const hasAssignee = issue.assigneeKind === 'user'
  const hasDescription = !!issue.description?.trim()

  return (
    <button
      type="button"
      className={cn(
        'group/card flex w-full cursor-pointer flex-col gap-1.5 rounded-lg px-2.5 py-2 text-left',
        'border border-foreground/6 bg-foreground/2',
        'inset-shadow-[0_1px_--theme(--color-white/10%)]',
        'transition-all duration-100',
        'hover:bg-foreground/4 hover:border-foreground/10',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        isSelected && 'bg-foreground/6 border-foreground/12',
        isDragging && 'opacity-60',
      )}
      onClick={() => onClick(issue)}
      data-testid={`issue-card-${issue.id}`}
    >
      {/* Title row with priority */}
      <div className="flex items-start gap-2">
        <PriorityIcon priority={issue.priority} className="mt-0.5 shrink-0" />
        <span className="text-[12px] leading-[1.45] text-foreground text-wrap-pretty line-clamp-2">
          {issue.title}
        </span>
      </div>

      {/* Description preview */}
      {hasDescription && (
        <p className="text-[10px] leading-relaxed text-muted-foreground line-clamp-1 pl-5.5">
          {issue.description!.slice(0, 80)}
        </p>
      )}

      {/* Labels */}
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-5.5">
          {labels.slice(0, 3).map(label => (
            <Badge key={label} variant="secondary" className="h-3.5 px-1 text-[9px] font-normal">
              {label}
            </Badge>
          ))}
          {labels.length > 3 && (
            <span className="text-[9px] text-muted-foreground">
              +
              {labels.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Footer: id, milestone, assignee/agent, timestamp */}
      <div className="flex items-center gap-1.5 pl-5.5">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {issue.id.slice(0, 6).toUpperCase()}
        </span>

        {milestone && (
          <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
            <FlagIcon className="size-2" />
            <span className="truncate max-w-16">{milestone.title}</span>
          </span>
        )}

        <span className="flex-1" />

        <span className="text-[9px] text-muted-foreground tabular-nums">
          {relativeShort(issue.updatedAt)}
        </span>

        {hasAgent && (
          <span className="flex items-center gap-1">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            <BotIcon className="size-2.5 text-muted-foreground/40" />
          </span>
        )}
        {!hasAgent && hasAssignee && (
          <Avatar className="size-4 bg-foreground/4 text-foreground">
            <AvatarFallback className="text-[7px]">
              <UserIcon className="size-2" />
            </AvatarFallback>
          </Avatar>
        )}
      </div>
    </button>
  )
}
