// Input: KanbanStatus, KanbanIssue[], dnd-kit, IssueCard
// Output: KanbanColumn — single status column with droppable zone and sortable cards (BoxCrew style)
// Position: Column component used inside the board view grid

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KanbanIssue, KanbanStatus } from '@main/ipc-types'
import { cn } from '@renderer/lib/cn'
import { LoaderCircleIcon, PlusIcon } from 'lucide-react'

import { IssueCard } from './issue-card'
import { useAgentSessions } from './use-kanban'

// Column accent color based on status color or fallback
const STATUS_ACCENT_MAP: Record<string, string> = {
  '#6b7280': 'bg-foreground/15', // gray
  '#3b82f6': 'bg-blue-500', // blue
  '#8b5cf6': 'bg-violet-500', // violet
  '#10b981': 'bg-emerald-500', // green
  '#f59e0b': 'bg-amber-500', // amber
  '#ef4444': 'bg-red-500', // red
}

function getAccentClass(color: string | null): string {
  if (!color) return 'bg-foreground/15'
  return STATUS_ACCENT_MAP[color] ?? 'bg-foreground/25'
}

export interface KanbanColumnProps {
  status: KanbanStatus
  issues: KanbanIssue[]
  onIssueClick: (issue: KanbanIssue) => void
  onOpenCreate: (statusId: string) => void
  selectedIssueId?: string | null
  isLoading?: boolean
}

function SortableIssueCard({
  issue,
  onClick,
  isSelected,
  done,
}: {
  issue: KanbanIssue
  onClick: (issue: KanbanIssue) => void
  isSelected?: boolean
  done?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
    data: { type: 'issue', issue },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <IssueCard issue={issue} onClick={onClick} isDragging={isDragging} isSelected={isSelected} done={done} />
    </div>
  )
}

function ColumnActiveCount({ issues }: { issues: KanbanIssue[] }) {
  // Count issues with actively running agent sessions
  const agentIssues = issues.filter(i => !!i.delegateAgentId)
  if (agentIssues.length === 0) return null

  return <ActiveCountInner issueIds={agentIssues.map(i => i.id)} />
}

function ActiveCountInner({ issueIds }: { issueIds: string[] }) {
  // We check sessions for each issue — but only render if any are active
  let activeCount = 0
  for (const id of issueIds) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { data: sessions = [] } = useAgentSessions(id)
    if (sessions[0]?.status === 'active' || sessions[0]?.status === 'created') {
      activeCount++
    }
  }

  if (activeCount === 0) return null

  return (
    <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-px text-[10px] font-medium text-blue-600 dark:text-blue-400">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-400 opacity-60" />
        <span className="relative size-1.5 rounded-full bg-blue-500" />
      </span>
      {activeCount}
      {' '}
      active
    </span>
  )
}

export function KanbanColumn({ status, issues, onIssueClick, onOpenCreate, selectedIssueId, isLoading }: KanbanColumnProps) {
  const isDone = status.name.toLowerCase() === 'done'
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status.id}`,
    data: { type: 'column', statusId: status.id },
  })

  return (
    <div
      className="flex w-68 shrink-0 flex-col gap-2"
      data-testid={`kanban-column-${status.id}`}
      data-kanban-column-id={status.id}
    >
      {/* Column header */}
      <div className="flex items-center gap-1.5 px-0.5 pb-1">
        <span className={cn('size-1.5 shrink-0 rounded-full', getAccentClass(status.color))} />
        <span className="text-[13px] font-medium text-foreground">{status.name}</span>
        <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-text-tertiary">
          {issues.length}
        </span>
        {isLoading && <LoaderCircleIcon className="size-3 animate-spin text-muted-foreground/30" />}
        <ColumnActiveCount issues={issues} />
        <button
          type="button"
          className="ml-auto flex size-5 items-center justify-center rounded text-text-dim opacity-0 transition-opacity duration-75 hover:text-foreground group-hover/col:opacity-100"
          onClick={() => onOpenCreate(status.id)}
          data-testid={`kanban-column-add-${status.id}`}
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>

      {/* Issue list */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-col gap-1.5 min-h-10 rounded-lg transition-colors',
          isOver && 'bg-foreground/3',
        )}
      >
        <SortableContext items={issues.map(i => i.id)} strategy={verticalListSortingStrategy}>
          {issues.map(issue => (
            <SortableIssueCard
              key={issue.id}
              issue={issue}
              onClick={onIssueClick}
              isSelected={issue.id === selectedIssueId}
              done={isDone}
            />
          ))}
        </SortableContext>

        {!isLoading && issues.length === 0 && (
          <button
            type="button"
            className="rounded-lg border border-dashed border-border py-8 text-center text-[11px] text-text-dim transition-colors hover:border-border hover:text-muted-foreground"
            onClick={() => onOpenCreate(status.id)}
          >
            No issues
          </button>
        )}
      </div>
    </div>
  )
}
