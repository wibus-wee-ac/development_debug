// Input: KanbanIssue data, priorityIcon, click handler, agent session info
// Output: IssueCard — physical-texture card with inset shadows, conditional borders, agent activity strip
// Position: Leaf component rendered inside KanbanColumn

import type { KanbanIssue } from '@main/ipc-types'
import { cn } from '@renderer/lib/cn'
import { BotIcon, CheckIcon, UserIcon } from 'lucide-react'

import { PriorityIcon } from './priority-icon'
import { useAgentSessions } from './use-kanban'

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-500/10 text-red-600 dark:text-red-400',
  high: 'bg-red-500/10 text-red-600 dark:text-red-400',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  low: '',
  none: '',
}

const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: '',
}

export interface IssueCardProps {
  issue: KanbanIssue
  onClick: (issue: KanbanIssue) => void
  isDragging?: boolean
  isSelected?: boolean
  done?: boolean
}

export function IssueCard({ issue, onClick, isDragging, isSelected, done }: IssueCardProps) {
  const labels: string[] = issue.labels ? JSON.parse(issue.labels) : []
  const hasAgent = !!issue.delegateAgentId
  const hasAssignee = issue.assigneeKind === 'user'
  const { data: sessions = [] } = useAgentSessions(issue.id)
  const latestSession = sessions[0]

  const isRunning = latestSession?.status === 'active' || latestSession?.status === 'created'
  const isFailed = latestSession?.status === 'failed'
  const isComplete = latestSession?.status === 'completed'

  return (
    <button
      type="button"
      className={cn(
        'group/card flex w-full cursor-pointer flex-col rounded-lg text-left',
        'border transition-[opacity,box-shadow,border-color] duration-150 select-none overflow-hidden',
        done
          ? 'border-border/20 bg-foreground/1 hover:bg-foreground/2.5'
          : isRunning
            ? 'border-blue-500/25 bg-foreground/2 hover:bg-foreground/4'
            : isFailed
              ? 'border-red-500/20 bg-foreground/2 hover:bg-foreground/4'
              : 'border-border/40 bg-foreground/2 hover:bg-foreground/4',
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),inset_0_-1px_0_0_rgba(0,0,0,0.06)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),inset_0_-1px_0_0_rgba(0,0,0,0.15)]',
        isSelected && 'border-primary/40',
        isDragging && 'opacity-50',
      )}
      onClick={() => onClick(issue)}
      data-testid={`issue-card-${issue.id}`}
    >
      <div className="px-3 py-2.5">
        {/* Title */}
        <p
          className={cn(
            'mb-2 text-[13px] leading-snug',
            done ? 'text-muted-foreground/45' : 'text-foreground',
          )}
        >
          {issue.title}
        </p>

        {/* Labels + Priority badge */}
        {(labels.length > 0 || (priority(issue) !== 'low' && priority(issue) !== 'none' && !done)) && (
          <div className="mb-2.5 flex items-center gap-1.5">
            {labels.slice(0, 2).map(label => (
              <span
                key={label}
                className={cn(
                  'rounded-full px-1.5 py-px text-[10px] font-medium leading-tight',
                  done
                    ? 'bg-muted text-text-dim'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {label}
              </span>
            ))}
            {labels.length > 2 && (
              <span className="text-[10px] text-text-dim">
                +
                {labels.length - 2}
              </span>
            )}
            {!done && priority(issue) !== 'low' && priority(issue) !== 'none' && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[10px] font-medium leading-tight',
                  PRIORITY_BADGE[priority(issue)],
                )}
              >
                {PRIORITY_LABEL[priority(issue)]}
              </span>
            )}
          </div>
        )}

        {/* Bottom row */}
        <div className="flex items-center gap-1.5">
          {done
            ? (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckIcon className="size-3" />
              </span>
            )
            : hasAgent
              ? (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-muted-foreground/60">
                  <BotIcon className="size-2.5" />
                </span>
              )
              : hasAssignee
                ? (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-muted-foreground/60">
                    <UserIcon className="size-2.5" />
                  </span>
                )
                : (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-text-dim select-none">
                    —
                  </span>
                )}
          <div className="ml-auto flex items-center gap-2">
            <PriorityIcon priority={issue.priority} className="size-3 text-text-dim" />
          </div>
        </div>
      </div>

      {/* ── Agent activity strip ──────────────────────────── */}
      {hasAgent && !done && (() => {
        if (isRunning) {
          return (
            <div className="border-t border-blue-500/15 bg-blue-500/4 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="relative flex size-1.5 shrink-0">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-400 opacity-60" />
                  <span className="relative size-1.5 rounded-full bg-blue-500" />
                </span>
                <span className="text-[10.5px] font-medium text-blue-600 dark:text-blue-400">
                  Agent running
                </span>
              </div>
            </div>
          )
        }
        if (isFailed) {
          return (
            <div className="border-t border-red-500/15 bg-red-500/4 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-red-500" />
                <span className="text-[10.5px] font-medium text-red-600 dark:text-red-400">
                  Agent failed
                </span>
              </div>
            </div>
          )
        }
        if (isComplete) {
          return (
            <div className="border-t border-border/30 bg-foreground/1.5 px-3 py-1.5">
              <div className="flex items-center gap-1.5">
                <CheckIcon className="size-3 shrink-0 text-emerald-500" />
                <span className="text-[10.5px] text-muted-foreground/50">
                  Agent complete
                </span>
              </div>
            </div>
          )
        }
        return null
      })()}
    </button>
  )
}

function priority(issue: KanbanIssue): string {
  return (issue.priority as string) ?? 'none'
}
