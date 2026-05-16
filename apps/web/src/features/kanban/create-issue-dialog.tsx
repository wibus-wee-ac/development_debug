// Input: workspaceId, defaultStatusId, open state, onClose callback
// Output: Floating modal-style create issue panel (Linear-inspired)
// Position: Panel for creating new kanban issues

import { ChevronRightIcon, EllipsisIcon, MaximizeIcon, PaperclipIcon, XIcon } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { MarkdownEditor } from '~/components/editor/markdown-editor'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import type { KanbanStatus } from '~/lib/types'

import { priorityOptions } from './shared/issue-metadata'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import { useCreateIssue, useStatuses } from './use-kanban'
import type { IssuePriority } from './use-kanban'

interface CreateIssueDialogProps {
  workspaceId: string
  defaultStatusId?: string
  open: boolean
  onClose: () => void
}

export function CreateIssueDialog({ workspaceId, defaultStatusId, open, onClose }: CreateIssueDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('none')
  const [statusId, setStatusId] = useState(defaultStatusId ?? '')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const { data: statuses = [] } = useStatuses(workspaceId)
  const { workspaces } = useWorkspaces()
  const createIssue = useCreateIssue()

  const workspaceName = workspaces.find(w => w.id === workspaceId)?.name ?? 'Issues'
  const resolvedDefaultStatusId = defaultStatusId ?? statuses[0]?.id
  const currentStatus = statuses.find((s: KanbanStatus) => s.id === statusId)

  useEffect(() => {
    if (!open) return
    setStatusId(resolvedDefaultStatusId ?? '')
    const timer = setTimeout(() => titleInputRef.current?.focus(), 80)
    return () => clearTimeout(timer)
  }, [open, resolvedDefaultStatusId])

  const handleSubmit = () => {
    if (!title.trim()) return
    const selectedStatusId = statusId || resolvedDefaultStatusId
    createIssue.mutate({
      workspaceId,
      title: title.trim(),
      description: description.trim() || null,
      priority: priority as IssuePriority,
      statusId: selectedStatusId,
    }, {
      onSuccess: () => {
        setTitle('')
        setDescription('')
        setPriority('none')
        setStatusId(resolvedDefaultStatusId ?? '')
        onClose()
      },
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
          {/* Scrim — no blur, just a light dark veil */}
          <m.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute inset-0 bg-black/20"
            onClick={onClose}
          />

          {/* Panel */}
          <m.div
            key="panel"
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
            onKeyDown={handleKeyDown}
            className="relative w-full max-w-xl rounded-2xl border border-border bg-card shadow-[0_8px_40px_-8px_rgba(0,0,0,0.15),0_2px_8px_-2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.04)]"
          >
            {/* ── Header ── */}
            <div className="flex items-center gap-1.5 px-4 pt-3 pb-0">
              <span className="text-[12px] text-muted-foreground flex items-center gap-1">
                <span className="font-medium text-muted-foreground">{workspaceName}</span>
                <ChevronRightIcon className="size-3" />
                <span>New issue</span>
              </span>
              <div className="flex-1" />
              <button
                type="button"
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <MaximizeIcon className="size-3" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <XIcon className="size-3" />
              </button>
            </div>

            {/* ── Body ── */}
            <div className="px-4 pt-3 pb-1">
              <input
                ref={titleInputRef}
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Issue title"
                className="w-full bg-transparent text-[15px] font-semibold text-foreground outline-none placeholder:text-muted-foreground leading-snug"
              />
            </div>

            <div className="px-4 pb-2 min-h-[60px]">
              <MarkdownEditor
                content={description}
                onSave={setDescription}
                placeholder="Add description..."
                className="text-[13px] text-muted-foreground"
              />
            </div>

            {/* ── Metadata badges ── */}
            <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
              <StatusPicker
                statuses={statuses}
                value={statusId}
                onChange={setStatusId}
                currentStatus={currentStatus}
              />
              <PriorityPicker value={priority} onChange={setPriority} />
              <MetaBadge label="Assignee" />
              <MetaBadge label="Labels" />
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center gap-2 px-4 pb-3">
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <PaperclipIcon className="size-3.5" />
              </button>

              <div className="flex-1" />

              <button
                onClick={handleSubmit}
                disabled={!title.trim() || createIssue.isPending}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium',
                  'bg-primary text-primary-foreground',
                  'hover:bg-primary/90 transition-colors',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  'shadow-[0_1px_3px_rgba(0,0,0,0.15),0_1px_2px_-1px_rgba(0,0,0,0.1)]',
                )}
              >
                Create issue
                <kbd className="ml-0.5 rounded border border-border bg-muted px-1 text-[10px] text-muted-foreground font-sans leading-4">⌘↵</kbd>
              </button>
            </div>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  )
}

function MetaBadge({ label, icon, className }: { label: string, icon?: React.ReactNode, className?: string }) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground',
        'hover:text-foreground transition-colors',
        className,
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function StatusPicker({ statuses, value, onChange, currentStatus }: {
  statuses: KanbanStatus[]
  value: string
  onChange: (v: string) => void
  currentStatus?: KanbanStatus
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {currentStatus
            ? <>
                <StatusIcon category={currentStatus.category as 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'} size={13} />
                <span>{currentStatus.name}</span>
              </>
            : <span>Status</span>
          }
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {statuses.map((s: KanbanStatus) => (
            <DropdownMenuRadioItem key={s.id} value={s.id}>
              <StatusIcon category={s.category as 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'} size={13} />
              {s.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PriorityPicker({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <PriorityIcon priority={value as IssuePriority} size={13} />
          <span>{priorityOptions.find(p => p.value === value)?.label ?? 'Priority'}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {priorityOptions.map(p => (
            <DropdownMenuRadioItem key={p.value} value={p.value}>
              <PriorityIcon priority={p.value} size={13} />
              {p.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
