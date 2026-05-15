// Input: workspaceId, defaultStatusId, open state, onClose callback
// Output: Inline create issue panel
// Position: Panel for creating new kanban issues

import { useEffect, useRef, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import type { KanbanStatus } from '~/lib/types'

import { useCreateIssue, useStatuses } from './use-kanban'

interface CreateIssueDialogProps {
  workspaceId: string
  defaultStatusId?: string
  open: boolean
  onClose: () => void
}

const priorityOptions = [
  { value: 'none', label: '无优先级' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
] as const

export function CreateIssueDialog({ workspaceId, defaultStatusId, open, onClose }: CreateIssueDialogProps) {
  const [title, setTitle] = useState('')
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
      priority: priority as 'none' | 'low' | 'medium' | 'high' | 'urgent',
      statusId: statusId || undefined,
    }, {
      onSuccess: () => {
        setTitle('')
        setPriority('none')
        setStatusId('')
        onClose()
      },
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!open) return null

  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card shadow-lg p-4">
        <input
          ref={titleInputRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="事项标题..."
          className="w-full bg-transparent text-[14px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
        />

        <div className="flex items-center gap-2 mt-3">
          <Select value={statusId} onValueChange={setStatusId}>
            <SelectTrigger size="sm" className="w-auto text-[12px]">
              <SelectValue placeholder="选择状态" />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((s: KanbanStatus) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger size="sm" className="w-auto text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorityOptions.map(p => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          <button
            onClick={handleSubmit}
            disabled={!title.trim() || createIssue.isPending}
            className="rounded-full bg-foreground px-3 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  )
}
