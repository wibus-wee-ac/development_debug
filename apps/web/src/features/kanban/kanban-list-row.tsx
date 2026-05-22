import { BotIcon, CheckIcon } from 'lucide-react'
import type { MouseEvent, PointerEvent } from 'react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/lib/types'

import { IssueContextMenu } from './issue-context-menu'
import { AssigneeAvatar } from './shared/assignee-avatar'
import { formatIssueId } from './shared/format-issue-id'
import { LabelChip } from './shared/label-chip'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import type { StatusCategory, ViewConfig } from './use-view-config'

interface ListRowProps {
  issue: KanbanIssue
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  displayProperties: ViewConfig['displayProperties']
  onOpenIssue: (id: string) => void
  onSelectionGesture?: (id: string, mode: 'toggle' | 'range') => void
  onHover?: (id: string | null) => void
  highlighted?: boolean
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

function KanbanListRowView({
  issue,
  statuses,
  milestones,
  displayProperties,
  onOpenIssue,
  onSelectionGesture,
  onHover,
  highlighted,
  selected,
}: ListRowProps) {
  const [pressed, setPressed] = useState(false)
  const openTimerRef = useRef<number | null>(null)
  const { workspaces } = useWorkspaces()
  const status = statuses.find(s => s.id === issue.statusId)
  const category = (status?.category ?? 'unstarted') as StatusCategory
  const labels = issue.labels

  useEffect(() => {
    return () => {
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current)
      }
    }
  }, [])

  const handleOpenIssue = useCallback(() => {
    onOpenIssue(issue.id)
  }, [issue.id, onOpenIssue])

  const openIssue = (delayMs: number) => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current)
    }
    if (delayMs <= 0) {
      handleOpenIssue()
      return
    }
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null
      handleOpenIssue()
    }, delayMs)
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    setPressed(false)
    if (onSelectionGesture && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onSelectionGesture?.(issue.id, event.shiftKey ? 'range' : 'toggle')
      return
    }

    openIssue(event.detail > 0 ? 70 : 0)
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button === 0) {
      setPressed(true)
    }
  }

  const releasePress = () => {
    setPressed(false)
  }

  return (
    <IssueContextMenu issue={issue} statuses={statuses} milestones={milestones} onOpen={handleOpenIssue}>
      <button
        type="button"
        aria-label={`${selected ? 'Selected issue' : 'Open issue'} ${issue.title}`}
        aria-pressed={selected ? true : undefined}
        data-pressed={pressed ? 'true' : undefined}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerUp={releasePress}
        onPointerCancel={releasePress}
        onPointerLeave={releasePress}
        onBlur={releasePress}
        onMouseEnter={() => onHover?.(issue.id)}
        onMouseLeave={() => onHover?.(null)}
        className={cn(
          'group/row relative flex w-full items-center gap-2 px-3 h-9 text-left text-[13px] cursor-pointer rounded-md',
          'transition-[scale,background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          'first:mt-1',
          'active:scale-[0.995] data-[pressed=true]:scale-[0.995]',
          selected ? 'bg-primary/10 text-primary' : highlighted ? 'bg-muted' : 'hover:bg-muted',
        )}
      >
        {/* Selected indicator */}
        <span className={cn(
          'absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full',
          'origin-center transition-[opacity,background-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          selected ? 'scale-y-100 bg-primary opacity-100' : highlighted ? 'scale-y-100 bg-muted-foreground opacity-100' : 'scale-y-50 bg-muted-foreground opacity-0',
        )}
        />

        <span
          className={cn(
            'pointer-events-none flex size-4 shrink-0 items-center justify-center rounded border text-primary',
            'transition-[opacity,background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
            selected ? 'border-primary bg-primary/10 opacity-100' : 'border-border bg-background opacity-0 group-hover/row:opacity-100',
          )}
          aria-hidden="true"
        >
          <span className="t-icon-swap size-3" data-state={selected ? 'b' : 'a'}>
            <span className="t-icon size-3" data-icon="a" />
            <CheckIcon className="t-icon size-3" data-icon="b" />
          </span>
        </span>

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
          selected || highlighted ? 'opacity-100' : 'opacity-50 group-hover/row:opacity-100',
        )}
        >
          {displayProperties.agentIndicator && (issue.delegateAgentId || issue.delegateAgentProfileId) && (
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

export const KanbanListRow = memo(KanbanListRowView)
