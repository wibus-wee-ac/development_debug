// Input: IssueCard, useDroppable from @dnd-kit/core, kanban query hooks, Button, Input
// Output: KanbanColumn component — a status column in the board view with issue cards
// Position: Board child component; one instance per status/unassigned column

import { useDroppable } from '@dnd-kit/core'
import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '@main/ipc-types'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/cn'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'

import { IssueCard } from './issue-card'
import { useCreateIssue } from './use-kanban'

interface KanbanColumnProps {
  status: KanbanStatus | null // null = unassigned column
  issues: KanbanIssue[]
  milestoneMap: Record<string, KanbanMilestone>
  workspaceId: string
  onIssueClick: (issue: KanbanIssue) => void
}

export function KanbanColumn({ status, issues, milestoneMap, workspaceId, onIssueClick }: KanbanColumnProps) {
  const dropId = status ? status.id : '__unassigned__'
  const { setNodeRef, isOver } = useDroppable({ id: dropId, data: { statusId: status?.id ?? null } })
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const createIssue = useCreateIssue()

  const headerColor = status?.color ?? '#94a3b8'

  async function handleAdd() {
    const title = newTitle.trim()
    if (!title) {
      return
    }
    await createIssue.mutateAsync({
      workspaceId,
      title,
      statusId: status?.id ?? null,
    })
    setNewTitle('')
    setAdding(false)
  }

  return (
    <div className="flex w-72 shrink-0 flex-col gap-0">
      {/* Column header */}
      <div className="flex items-center gap-2 px-1 pb-2">
        <span
          className="size-2.5 rounded-full shrink-0"
          style={{ backgroundColor: headerColor }}
        />
        <span className="text-sm font-semibold text-foreground truncate">
          {status?.name ?? 'Unassigned'}
        </span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {issues.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-col gap-2 rounded-xl p-2 min-h-20 transition-colors',
          isOver ? 'bg-accent/50' : 'bg-muted/30',
        )}
      >
        {issues.map(issue => (
          <IssueCard
            key={issue.id}
            issue={issue}
            milestone={issue.milestoneId ? milestoneMap[issue.milestoneId] : undefined}
            onClick={() => onIssueClick(issue)}
          />
        ))}

        {/* Inline add issue form */}
        {adding
          ? (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2">
              <Input
                autoFocus
                placeholder="Issue title…"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleAdd()
                  }
                  if (e.key === 'Escape') {
                    setAdding(false)
                    setNewTitle('')
                  }
                }}
                className="h-7 text-sm"
              />
              <div className="flex gap-1">
                <Button size="sm" onClick={() => void handleAdd()} disabled={!newTitle.trim() || createIssue.isPending}>
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAdding(false)
                    setNewTitle('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )
          : (
            <button
              className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => setAdding(true)}
            >
              <PlusIcon className="size-3.5" />
              Add issue
            </button>
          )}
      </div>
    </div>
  )
}
