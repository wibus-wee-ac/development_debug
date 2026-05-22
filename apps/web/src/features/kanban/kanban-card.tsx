import { useDraggable } from '@dnd-kit/core'
import { CheckIcon } from 'lucide-react'
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
import { StatusCategorySchema, StatusIcon } from './shared/status-icon'
import type { ViewConfig } from './use-view-config'

interface CardProps {
  issue: KanbanIssue
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  displayProperties: ViewConfig['displayProperties']
  onOpenIssue: (id: string) => void
  onSelectionGesture?: (id: string, mode: 'toggle' | 'range') => void
  onHover?: (id: string | null) => void
  category?: string
  highlighted?: boolean
  selected?: boolean
}

const priorityLabel: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

function KanbanCardView({
  issue,
  statuses,
  milestones,
  displayProperties,
  onOpenIssue,
  onSelectionGesture,
  onHover,
  category,
  highlighted,
  selected,
}: CardProps) {
  const [pressed, setPressed] = useState(false)
  const openTimerRef = useRef<number | null>(null)
  const { workspaces } = useWorkspaces()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.id,
    data: { issue },
  })
  const { role: _draggableRole, tabIndex: _draggableTabIndex, ...draggableAttributes } = attributes
  const { onPointerDown: onDragPointerDown, ...dragListeners } = listeners ?? {}

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  const labels = issue.labels
  const issueStatus = statuses.find(status => status.id === issue.statusId)
  const statusCategory = StatusCategorySchema.parse(issueStatus?.category ?? category)

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
    event.stopPropagation()
    setPressed(false)

    if (onSelectionGesture && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onSelectionGesture?.(issue.id, event.shiftKey ? 'range' : 'toggle')
      return
    }

    openIssue(event.detail > 0 ? 90 : 0)
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    onDragPointerDown?.(event)
    if (event.button === 0) {
      setPressed(true)
    }
  }

  const releasePress = () => {
    setPressed(false)
  }

  return (
    <div
      data-testid={`issue-sortable-${issue.id}`}
      onMouseEnter={() => onHover?.(issue.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <IssueContextMenu issue={issue} statuses={statuses} milestones={milestones} onOpen={handleOpenIssue}>
        <button
          type="button"
          ref={setNodeRef}
          style={style}
          {...draggableAttributes}
          {...dragListeners}
          aria-label={`${selected ? 'Selected issue' : 'Open issue'} ${issue.title}`}
          aria-pressed={selected ? true : undefined}
          data-pressed={pressed ? 'true' : undefined}
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerUp={releasePress}
          onPointerCancel={releasePress}
          onPointerLeave={releasePress}
          onBlur={releasePress}
          data-testid={`issue-card-${issue.id}`}
          className={cn(
            'w-full bg-card rounded-md px-3.5 py-3 pb-2.5 cursor-pointer border border-border/80 text-left',
            'flex flex-col gap-1',
            'shadow-[var(--shadow-xs)]',
            'transition-[scale,transform,box-shadow,border-color,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
            'hover:shadow-[var(--shadow-sm)] hover:bg-card',
            'active:scale-[0.985] data-[pressed=true]:scale-[0.985] data-[pressed=true]:border-primary/40 data-[pressed=true]:shadow-[var(--shadow-xs)]',
            !highlighted && !selected && !pressed && 'hover:border-border',
            selected && 'border-primary/60 bg-primary/5 shadow-[var(--shadow-sm)]',
            isDragging && 'opacity-50',
          )}
        >

          <span className="flex justify-between">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  'pointer-events-none flex size-4 items-center justify-center rounded border text-primary',
                  'transition-[opacity,background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
                  selected ? 'border-primary bg-primary/10 opacity-100' : 'border-border bg-background opacity-0 group-hover/button:opacity-100',
                )}
                aria-hidden="true"
              >
                <span className="t-icon-swap size-3" data-state={selected ? 'b' : 'a'}>
                  <span className="t-icon size-3" data-icon="a" />
                  <CheckIcon className="t-icon size-3" data-icon="b" />
                </span>
              </span>

              {displayProperties.id && (
                <span className="text-[10.5px] text-muted-foreground tabular-nums">
                  {formatIssueId(issue, workspaces)}
                </span>
              )}
            </span>

            {displayProperties.assignee && (
              issue.assigneeId
                ? <AssigneeAvatar name={issue.assigneeId} size={18} />
                : <span className="size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground" />
            )}
          </span>

          <span className="flex items-start gap-2">
            {displayProperties.status && (
              <span className="mt-1 shrink-0">
                <StatusIcon category={statusCategory} size={16} />
              </span>
            )}
            <span className="text-[13px] font-medium text-foreground leading-snug tracking-tight text-balance">
              {issue.title}
            </span>
          </span>

          <span className="flex items-center gap-2 mt-2.5 text-muted-foreground">
            {displayProperties.priority && issue.priority !== 'none' && (
              <span className="flex items-center gap-1 text-[11px]">
                <PriorityIcon priority={issue.priority as 'none' | 'low' | 'medium' | 'high' | 'urgent'} size={13} />
                <span>{priorityLabel[issue.priority] ?? ''}</span>
              </span>
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
          </span>
        </button>
      </IssueContextMenu>
    </div>
  )
}

export const KanbanCard = memo(KanbanCardView)
