// Input: workspaceId, defaultStatusId, open state, onClose callback
// Output: Floating command-bar style create issue panel
// Position: Panel for creating new kanban issues

import { useEffect, useRef, useState } from 'react'
import { CheckIcon } from 'lucide-react'

import { MarkdownEditor } from '~/components/editor/markdown-editor'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import type { KanbanStatus } from '~/lib/types'

import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import { useCreateIssue, useStatuses } from './use-kanban'

interface CreateIssueDialogProps {
  workspaceId: string
  defaultStatusId?: string
  open: boolean
  onClose: () => void
}

const priorityOptions = [
  { value: 'none', label: 'No priority' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const

export function CreateIssueDialog({ workspaceId, defaultStatusId, open, onClose }: CreateIssueDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('none')
  const [statusId, setStatusId] = useState(defaultStatusId ?? '')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const { data: statuses = [] } = useStatuses(workspaceId)
  const createIssue = useCreateIssue()

  useEffect(() => {
    if (!open) return
    if (defaultStatusId) setStatusId(defaultStatusId)
    requestAnimationFrame(() => titleInputRef.current?.focus())
  }, [open, defaultStatusId])

  const handleSubmit = () => {
    if (!title.trim()) return
    createIssue.mutate({
      workspaceId,
      title: title.trim(),
      description: description.trim() || null,
      priority: priority as 'none' | 'low' | 'medium' | 'high' | 'urgent',
      statusId: statusId || undefined,
    }, {
      onSuccess: () => {
        setTitle('')
        setDescription('')
        setPriority('none')
        setStatusId('')
        onClose()
      },
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!open) return null

  const currentStatus = statuses.find((s: KanbanStatus) => s.id === statusId)

  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
        {/* Title */}
        <div className="px-4 pt-4 pb-1">
          <input
            ref={titleInputRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Issue title..."
            className="w-full bg-transparent text-[15px] font-semibold text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Description */}
        <div className="px-4">
          <MarkdownEditor
            content={description}
            onSave={setDescription}
            placeholder="Add description..."
            className="text-[13px]"
          />
        </div>

        {/* Metadata bar */}
        <div className="flex items-center gap-1.5 px-3 py-2.5 border-t border-border">
          <StatusPicker
            statuses={statuses}
            value={statusId}
            onChange={setStatusId}
            currentStatus={currentStatus}
          />

          <PriorityPicker value={priority} onChange={setPriority} />

          <div className="flex-1" />

          <button
            onClick={handleSubmit}
            disabled={!title.trim() || createIssue.isPending}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium text-foreground bg-muted hover:bg-accent transition-colors disabled:opacity-40"
          >
            <CheckIcon className="size-3.5" />
            Create
            <kbd className="ml-1 rounded border border-border px-1 py-0 text-[10px] text-muted-foreground">⌘↵</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusPicker({ statuses, value, onChange, currentStatus }: {
  statuses: KanbanStatus[]
  value: string
  onChange: (v: string) => void
  currentStatus?: KanbanStatus
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted transition-colors">
          {currentStatus
            ? <>
                <StatusIcon category={currentStatus.category as 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'} size={13} />
                <span>{currentStatus.name}</span>
              </>
            : <span>Status</span>
          }
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-0">
        <div className="p-1">
          {statuses.map((s: KanbanStatus) => (
            <button
              key={s.id}
              onClick={() => onChange(s.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-foreground hover:bg-muted transition-colors"
            >
              <StatusIcon category={s.category as 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'} size={13} />
              <span className="flex-1 text-left">{s.name}</span>
              {value === s.id && <CheckIcon className="size-3 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PriorityPicker({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted transition-colors">
          <PriorityIcon priority={value as 'none' | 'low' | 'medium' | 'high' | 'urgent'} size={13} />
          <span>{priorityOptions.find(p => p.value === value)?.label ?? 'Priority'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-0">
        <div className="p-1">
          {priorityOptions.map(p => (
            <button
              key={p.value}
              onClick={() => onChange(p.value)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-foreground hover:bg-muted transition-colors"
            >
              <PriorityIcon priority={p.value} size={13} />
              <span className="flex-1 text-left">{p.label}</span>
              {value === p.value && <CheckIcon className="size-3 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
