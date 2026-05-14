// Input: workspaceId, defaultStatusId, open state, onClose callback
// Output: Quick create issue dialog
// Position: Modal dialog for creating new kanban issues

import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import type { KanbanStatus } from '~/lib/types'

import { useCreateIssue, useStatuses } from './use-kanban'

interface CreateIssueDialogProps {
  workspaceId: string
  defaultStatusId?: string
  open: boolean
  onClose: () => void
}

export function CreateIssueDialog({ workspaceId, defaultStatusId, open, onClose }: CreateIssueDialogProps) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<'none' | 'low' | 'medium' | 'high' | 'urgent'>('none')
  const [statusId, setStatusId] = useState(defaultStatusId ?? '')
  const { data: statuses = [] } = useStatuses(workspaceId)
  const createIssue = useCreateIssue()

  const handleSubmit = () => {
    if (!title.trim()) return
    createIssue.mutate({
      workspaceId,
      title: title.trim(),
      priority,
      statusId: statusId || undefined,
    }, {
      onSuccess: () => {
        setTitle('')
        setPriority('none')
        onClose()
      },
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[14px]">新建事项</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="事项标题"
            className="text-[13px]"
            autoFocus
          />

          <div className="flex items-center gap-2">
            <select
              value={statusId}
              onChange={e => setStatusId(e.target.value)}
              className="h-7 rounded-md bg-muted px-2 text-[12px] text-foreground border-none outline-none"
            >
              <option value="">选择状态</option>
              {statuses.map((s: KanbanStatus) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <select
              value={priority}
              onChange={e => setPriority(e.target.value as typeof priority)}
              className="h-7 rounded-md bg-muted px-2 text-[12px] text-foreground border-none outline-none"
            >
              <option value="none">无优先级</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="urgent">紧急</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 text-[12px]">
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!title.trim() || createIssue.isPending}
              className="h-7 text-[12px]"
            >
              创建
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
