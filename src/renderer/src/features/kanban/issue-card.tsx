// Input: KanbanIssue data, priorityIcon, click handler
// Output: IssueCard — Linear-style issue card with surface texture
// Position: Leaf component rendered inside KanbanColumn

import type { KanbanIssue } from '@main/ipc-types'
import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/utils'
import { BotIcon, UserIcon } from 'lucide-react'

import { PriorityIcon } from './priority-icon'

interface IssueCardProps {
  issue: KanbanIssue
  onClick: (issue: KanbanIssue) => void
  isDragging?: boolean
}

export function IssueCard({ issue, onClick, isDragging }: IssueCardProps) {
  const labels: string[] = issue.labels ? JSON.parse(issue.labels) : []

  return (
    <button
      type="button"
      className={cn(
        'group/card flex w-full cursor-pointer flex-col gap-1 rounded-md p-2 text-left',
        'bg-card inset-shadow-[0_1px_--theme(--color-white/10%)]',
        'transition-[background-color,box-shadow] duration-75',
        'hover:bg-accent/60',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        isDragging && 'bg-accent ring-1 ring-border/40',
      )}
      onClick={() => onClick(issue)}
    >
      {/* Row 1: priority + title */}
      <div className="flex items-start gap-1.5">
        <PriorityIcon priority={issue.priority} className="mt-0.5 shrink-0" />
        <span className="text-[13px] leading-[1.4] text-foreground text-wrap-pretty line-clamp-2">
          {issue.title}
        </span>
      </div>

      {/* Row 2: identifier + labels + delegate */}
      <div className="flex items-center gap-1.5 pl-5">
        <span className="text-[11px] text-muted-foreground/40 tabular-nums">
          {issue.id.slice(0, 6).toUpperCase()}
        </span>
        {labels.map(label => (
          <Badge key={label} variant="secondary" size="sm" className="font-normal text-[10px] h-4 px-1">
            {label}
          </Badge>
        ))}
        {issue.delegateAgentId && (
          <BotIcon className="ml-auto size-3 text-muted-foreground/40" />
        )}
        {!issue.delegateAgentId && issue.assigneeKind === 'user' && (
          <UserIcon className="ml-auto size-3 text-muted-foreground/40" />
        )}
      </div>
    </button>
  )
}
