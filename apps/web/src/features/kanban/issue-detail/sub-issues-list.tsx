import { PlusIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { cn } from '~/lib/utils'
import type { KanbanStatus } from '~/lib/types'

import { priorityOptions } from '../shared/issue-metadata'
import { PriorityIcon } from '../shared/priority-icon'
import { StatusIcon } from '../shared/status-icon'
import { useCreateIssue, useIssues } from '../use-kanban'
import type { IssuePriority } from '../use-kanban'
import type { StatusCategory } from '../use-view-config'

interface SubIssuesListProps {
  issueId: string
  workspaceId: string
  statuses: KanbanStatus[]
}

export function SubIssuesList({ issueId, workspaceId, statuses }: SubIssuesListProps) {
  const { data: subIssues = [] } = useIssues({ workspaceId, parentIssueId: issueId })
  const createIssue = useCreateIssue()
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [statusId, setStatusId] = useState('')
  const [priority, setPriority] = useState('none')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!creating) return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [creating])

  const handleCreate = useCallback(() => {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    createIssue.mutate({
      workspaceId,
      title: trimmed,
      parentIssueId: issueId,
      statusId: statusId || undefined,
      priority: priority as IssuePriority,
    })
    setNewTitle('')
    setStatusId('')
    setPriority('none')
    setCreating(false)
  }, [newTitle, statusId, priority, workspaceId, issueId, createIssue])

  const handleCancel = useCallback(() => {
    setNewTitle('')
    setStatusId('')
    setPriority('none')
    setCreating(false)
  }, [])

  const currentStatus = statuses.find(s => s.id === statusId)

  return (
    <div className="flex flex-col gap-1">
      {subIssues.map((sub) => {
        const status = statuses.find(s => s.id === sub.statusId)
        return (
          <div key={sub.id} className="flex h-7 items-center gap-2 rounded-md px-1.5 text-[13px] hover:bg-fill transition-colors">
            {status
              ? <StatusIcon category={status.category as StatusCategory} size={14} />
              : <span className="size-3.5" />}
            <span className="flex-1 truncate text-foreground">{sub.title}</span>
          </div>
        )
      })}

      {creating
        ? (
          <div className="mt-1 rounded-lg border border-border bg-card shadow-xs">
            <div className="px-3 pt-3 pb-2">
              <input
                ref={inputRef}
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleCreate() }
                  if (e.key === 'Escape') handleCancel()
                }}
                placeholder="Sub-issue title"
                className="w-full bg-transparent text-[14px] font-medium text-foreground outline-none placeholder:text-muted-foreground/60"
              />
            </div>

            <div className="flex items-center justify-between border-t border-border px-2.5 py-1.5">
              <div className="flex items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {currentStatus
                        ? <>
                            <StatusIcon category={currentStatus.category as StatusCategory} size={11} />
                            <span>{currentStatus.name}</span>
                          </>
                        : <span>Status</span>}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    <DropdownMenuRadioGroup value={statusId} onValueChange={setStatusId}>
                      {statuses.map(s => (
                        <DropdownMenuRadioItem key={s.id} value={s.id}>
                          <StatusIcon category={s.category as StatusCategory} size={13} />
                          {s.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <PriorityIcon priority={priority as IssuePriority} size={11} />
                      <span>{priorityOptions.find(p => p.value === priority)?.label ?? 'Priority'}</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-40">
                    <DropdownMenuRadioGroup value={priority} onValueChange={setPriority}>
                      {priorityOptions.map(p => (
                        <DropdownMenuRadioItem key={p.value} value={p.value}>
                          <PriorityIcon priority={p.value} size={13} />
                          {p.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded px-2 py-0.5 text-[11px] text-text-dim hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!newTitle.trim() || createIssue.isPending}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium',
                    'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                  )}
                >
                  Create
                  <kbd className="ml-0.5 rounded border border-border/30 bg-primary-foreground/10 px-1 text-[9px] leading-4">⌘↵</kbd>
                </button>
              </div>
            </div>
          </div>
        )
        : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-text-dim hover:text-foreground hover:bg-fill transition-colors w-fit"
          >
            <PlusIcon className="size-3.5" />
            Add sub-issue
          </button>
        )}
    </div>
  )
}
