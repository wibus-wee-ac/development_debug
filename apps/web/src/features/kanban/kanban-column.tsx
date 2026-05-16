// Input: Group metadata, issues array, display properties
// Output: Single droppable column for the board view
// Position: Column component used inside kanban board layout

import { useDroppable } from '@dnd-kit/core'
import { PlusIcon } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
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
    <div className="flex flex-col w-72 shrink-0 bg-muted/80 rounded-xl h-full" data-kanban-column-id={groupId}>
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2">
        {category && <StatusIcon category={category} size={14} />}
        <span className="text-[12px] font-medium text-foreground" data-testid={`kanban-column-title-${groupId}`}>{groupName}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{issues.length}</span>
      </div>

      {/* Droppable zone — stretches to fill remaining height */}
      <div
        ref={setNodeRef}
        data-testid={`kanban-column-dropzone-${groupId}`}
        className={cn(
          'flex-1 flex flex-col gap-1.5 px-1.5 pb-1.5 min-h-0',
          'transition-colors duration-150 ease-out',
          isOver && 'bg-muted/80 rounded-b-xl',
        )}
      >
        {issues.map(issue => (
          <KanbanCard
            key={issue.id}
            issue={issue}
            displayProperties={displayProperties}
            category={category}
            onClick={() => onIssueClick(issue.id)}
          />
        ))}

        <AnimatePresence initial={false}>
          {showInlineInput && (
            <m.div
              key="inline-input"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
              className="overflow-hidden"
            >
              <div className="px-0.5 py-0.5">
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
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
                />
              </div>
            </m.div>
          )}
        </AnimatePresence>

        {/* Quick create button */}
        <button
          onClick={handleStartInlineCreate}
          data-testid={`kanban-column-add-${groupId}`}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 text-[12px]',
            'text-muted-foreground hover:text-foreground',
            'rounded-md transition-[color,transform] duration-150 ease-out',
            'active:scale-[0.96]',
          )}
        >
          <PlusIcon className="size-3" />
          新建
        </button>
      </div>
    </div>
  )
}
