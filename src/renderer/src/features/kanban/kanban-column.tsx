// Input: KanbanStatus, KanbanIssue[], dnd-kit, IssueCard
// Output: KanbanColumn — single status column with droppable zone and sortable cards
// Position: Column component used inside the board view grid

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KanbanIssue, KanbanStatus } from '@main/ipc-types'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { cn } from '@renderer/lib/utils'
import { PlusIcon } from 'lucide-react'

import { IssueCard } from './issue-card'
import { StatusIcon } from './status-icon'

interface KanbanColumnProps {
  status: KanbanStatus
  issues: KanbanIssue[]
  onIssueClick: (issue: KanbanIssue) => void
  onOpenCreate: (statusId: string) => void
}

function SortableIssueCard({
  issue,
  onClick,
}: {
  issue: KanbanIssue
  onClick: (issue: KanbanIssue) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
    data: { type: 'issue', issue },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <IssueCard issue={issue} onClick={onClick} isDragging={isDragging} />
    </div>
  )
}

export function KanbanColumn({ status, issues, onIssueClick, onOpenCreate }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status.id}`,
    data: { type: 'column', statusId: status.id },
  })

  return (
    <div
      className={cn(
        'flex h-full w-72 shrink-0 flex-col rounded-lg',
        isOver && 'bg-accent/15',
      )}
    >
      {/* Column header */}
      <div className="group/header flex items-center gap-2 px-2.5 py-2">
        <StatusIcon color={status.color} />
        <span className="text-[13px] font-medium text-foreground">{status.name}</span>
        <span className="text-[11px] text-muted-foreground/40 tabular-nums">{issues.length}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto text-muted-foreground/40 opacity-0 transition-opacity duration-75 group-hover/header:opacity-100 hover:text-foreground"
          onClick={() => onOpenCreate(status.id)}
        >
          <PlusIcon />
        </Button>
      </div>

      {/* Issue list */}
      <div ref={setNodeRef} className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <SortableContext items={issues.map(i => i.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-1 px-1 pb-2">
              {issues.map(issue => (
                <SortableIssueCard key={issue.id} issue={issue} onClick={onIssueClick} />
              ))}
            </div>
          </SortableContext>

          {/* Empty state */}
          {issues.length === 0 && (
            <div className="px-2 py-8 text-center">
              <span className="text-[11px] text-muted-foreground/25">无 issue</span>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
