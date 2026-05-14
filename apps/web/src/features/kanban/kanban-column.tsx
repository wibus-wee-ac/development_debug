// Input: Group metadata, issues array, display properties
// Output: Single droppable column for the board view
// Position: Column component used inside kanban board layout

import { useDroppable } from '@dnd-kit/core'
import { PlusIcon } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { cn } from '~/lib/cn'
import type { KanbanIssue } from '~/lib/types'

import type { StatusCategory, ViewConfig } from './use-view-config'
import { KanbanCard } from './kanban-card'
import { StatusIcon } from './shared/status-icon'
import { useCreateIssue } from './use-kanban'

interface ColumnProps {
  workspaceId: string
  groupId: string
  groupName: string
  category?: StatusCategory
  issues: KanbanIssue[]
  displayProperties: ViewConfig['displayProperties']
  onIssueClick: (id: string) => void
  onCreateIssue: (groupId: string) => void
}

export function KanbanColumn({
  workspaceId,
  groupId,
  groupName,
  category,
  issues,
  displayProperties,
  onIssueClick,
  onCreateIssue,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: groupId })
  const [showInlineInput, setShowInlineInput] = useState(false)
  const [inlineTitle, setInlineTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const createIssue = useCreateIssue()

  const handleStartInlineCreate = useCallback(() => {
    setShowInlineInput(true)
    setInlineTitle('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const handleConfirmInlineCreate = useCallback(() => {
    const title = inlineTitle.trim()
    if (!title) {
      setShowInlineInput(false)
      return
    }
    createIssue.mutate({
      workspaceId,
      title,
      priority: 'none',
      statusId: groupId,
    }, {
      onSuccess: () => {
        setInlineTitle('')
        setShowInlineInput(false)
      },
      onError: () => {
        setShowInlineInput(false)
      },
    })
  }, [inlineTitle, groupId, createIssue, workspaceId])

  return (
    <div className="flex flex-col w-72 shrink-0" data-kanban-column-id={groupId}>
      {/* Column header */}
      <div className="flex items-center gap-2 px-2 py-2 mb-1">
        {category && <StatusIcon category={category} size={14} />}
        <span className="text-[12px] font-medium text-muted-foreground" data-testid={`kanban-column-title-${groupId}`}>{groupName}</span>
        <span className="text-[11px] text-muted-foreground/60">{issues.length}</span>
      </div>

      {/* Droppable zone */}
      <div
        ref={setNodeRef}
        data-testid={`kanban-column-dropzone-${groupId}`}
        className={cn(
          'flex-1 flex flex-col gap-1 px-1 py-1 rounded-lg min-h-25 transition-colors',
          isOver && 'bg-muted/30',
        )}
      >
        {issues.map(issue => (
          <KanbanCard
            key={issue.id}
            issue={issue}
            displayProperties={displayProperties}
            onClick={() => onIssueClick(issue.id)}
          />
        ))}

        {showInlineInput && (
          <div className="px-2 py-1">
            <input
              ref={inputRef}
              value={inlineTitle}
              onChange={e => setInlineTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleConfirmInlineCreate()
                } else if (e.key === 'Escape') {
                  setShowInlineInput(false)
                }
              }}
              onBlur={handleConfirmInlineCreate}
              placeholder="事项标题"
              data-testid="kanban-new-issue-input"
              className="w-full rounded-md border border-border/50 bg-transparent px-2 py-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-border"
            />
          </div>
        )}

        {/* Quick create button */}
        <button
          onClick={handleStartInlineCreate}
          data-testid={`kanban-column-add-${groupId}`}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-muted-foreground/60 hover:text-muted-foreground rounded-md transition-colors"
        >
          <PlusIcon className="size-3" />
          新建
        </button>
      </div>
    </div>
  )
}
