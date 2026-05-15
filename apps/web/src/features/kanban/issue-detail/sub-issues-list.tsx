import { useCallback, useEffect, useRef, useState } from 'react'
import { PlusIcon } from 'lucide-react'

import type { KanbanStatus } from '~/lib/types'

import { StatusIcon } from '../shared/status-icon'
import { useCreateIssue, useIssues } from '../use-kanban'
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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!creating) {
      return
    }
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [creating])

  const handleCreate = useCallback(() => {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    createIssue.mutate({
      workspaceId,
      title: trimmed,
      parentIssueId: issueId,
    })
    setNewTitle('')
    setCreating(false)
  }, [newTitle, workspaceId, issueId, createIssue])

  if (subIssues.length === 0 && !creating) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-muted-foreground">Sub-issues</span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-fill hover:text-foreground transition-colors"
          >
            <PlusIcon className="size-3" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-medium text-muted-foreground">Sub-issues</span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-fill hover:text-foreground transition-colors"
        >
          <PlusIcon className="size-3" />
        </button>
      </div>

      <div className="flex flex-col">
        {subIssues.map((sub) => {
          const status = statuses.find(s => s.id === sub.statusId)
          return (
            <div key={sub.id} className="flex h-8 items-center gap-2 text-[13px]">
              {status && <StatusIcon category={status.category as StatusCategory} size={14} />}
              <span className="flex-1 truncate text-foreground">{sub.title}</span>
            </div>
          )
        })}

        {creating && (
          <div className="flex h-8 items-center gap-2">
            <input
              ref={inputRef}
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') { setCreating(false); setNewTitle('') }
              }}
              onBlur={() => { if (!newTitle.trim()) setCreating(false) }}
              placeholder="Sub-issue title..."
              className="flex-1 border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>
        )}
      </div>
    </div>
  )
}
