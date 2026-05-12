// Input: workspaceId, defaultStatusId, useStatuses, useMilestones, useCreateIssue, Dialog, Select, Kbd
// Output: CreateIssueDialog — minimal, focused issue creation dialog
// Position: Feature dialog opened from board column header

import { Dialog, DialogClose, DialogContent } from '@renderer/components/ui/dialog'
import { Kbd } from '@renderer/components/ui/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/components/ui/select'
import { Textarea } from '@renderer/components/ui/textarea'
import { cn } from '@renderer/lib/cn'
import { AlignLeftIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { PriorityIcon } from './priority-icon'
import { StatusIcon } from './status-icon'
import { useCreateIssue, useMilestones, useStatuses } from './use-kanban'

interface CreateIssueDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  defaultStatusId?: string | null
}

const PRIORITY_OPTIONS = [
  { value: 'none', label: 'No priority' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const chipCls = cn(
  'flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-normal transition-colors',
  'border border-border/50 bg-background text-muted-foreground',
  'hover:bg-accent/60 hover:text-foreground hover:border-border',
  '[&>[data-slot=select-icon]]:hidden',
)

export function CreateIssueDialog({
  open,
  onOpenChange,
  workspaceId,
  defaultStatusId,
}: CreateIssueDialogProps) {
  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const createIssue = useCreateIssue()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [descOpen, setDescOpen] = useState(false)
  const [statusId, setStatusId] = useState<string | null>(defaultStatusId ?? null)
  const [priority, setPriority] = useState('none')
  const [milestoneId, setMilestoneId] = useState<string | null>(null)

  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setStatusId(defaultStatusId ?? null)
      setTitle('')
      setDescription('')
      setDescOpen(false)
      setPriority('none')
      setMilestoneId(null)
      requestAnimationFrame(() => titleRef.current?.focus())
    }
  }, [open, defaultStatusId])

  function handleCreate() {
    const t = title.trim()
    if (!t) {
      return
    }
    createIssue.mutate(
      {
        workspaceId,
        title: t,
        description: description.trim() || undefined,
        statusId: statusId ?? undefined,
        priority:
          priority !== 'none' ? (priority as 'low' | 'medium' | 'high' | 'urgent') : undefined,
        milestoneId: milestoneId ?? undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  const currentStatus = statuses.find(s => s.id === statusId)
  const currentPriority = PRIORITY_OPTIONS.find(o => o.value === priority)
  const currentMilestone = milestones.find(m => m.id === milestoneId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-130 overflow-visible p-0">
        <div className="px-5 pt-5 pb-1">
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Issue title…"
            data-testid="kanban-new-issue-input"
            className="w-full bg-transparent text-[15px] font-medium text-foreground placeholder:text-muted-foreground/25 outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleCreate()
              }
            }}
          />

          <AnimatePresence initial={false}>
            {!descOpen
? (
              <motion.button
                key="desc-trigger"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                onClick={() => setDescOpen(true)}
                className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <AlignLeftIcon className="size-3" />
                Add description…
              </motion.button>
            )
: (
              <motion.div
                key="desc-textarea"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <Textarea
                  autoFocus
                  value={description}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setDescription(e.target.value)}
                  placeholder="Add a description…"
                  rows={3}
                  className="mt-3 resize-none text-[12px] bg-transparent border-none shadow-none px-0 focus-visible:ring-0 placeholder:text-muted-foreground/20"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Property chips */}
        <div className="flex flex-wrap items-center gap-1.5 px-5 py-3 border-t border-border/40">
          <Select value={statusId ?? ''} onValueChange={v => setStatusId(v || null)}>
            <SelectTrigger className={chipCls}>
              {currentStatus
? (
                <>
                  <StatusIcon color={currentStatus.color} className="size-2.5" />
                  {currentStatus.name}
                </>
              )
: (
                <span className="text-muted-foreground/25">Status</span>
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">
                <span className="text-muted-foreground/30">No status</span>
              </SelectItem>
              {statuses.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex items-center gap-2">
                    <StatusIcon color={s.color} className="size-2.5" />
                    {s.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priority} onValueChange={v => setPriority(v ?? 'none')}>
            <SelectTrigger className={chipCls}>
              <PriorityIcon priority={priority} className="size-3" />
              {currentPriority?.label ?? 'No priority'}
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  <span className="flex items-center gap-2">
                    <PriorityIcon priority={o.value} className="size-3" />
                    {o.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {milestones.length > 0 && (
            <Select value={milestoneId ?? ''} onValueChange={v => setMilestoneId(v || null)}>
              <SelectTrigger className={chipCls}>
                {currentMilestone
? (
                  <span className="truncate max-w-24">{currentMilestone.title}</span>
                )
: (
                  <span className="text-muted-foreground/25">Milestone</span>
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">
                  <span className="text-muted-foreground/30">None</span>
                </SelectItem>
                {milestones.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 pb-4 pt-1">
          <Kbd className="text-[11px]">⌘↵</Kbd>
          <div className="flex items-center gap-2">
            <DialogClose className="h-7 px-3.5 text-[12px] rounded-md text-muted-foreground/60 hover:text-foreground transition-colors">
              Cancel
            </DialogClose>
            <button
              className={cn(
                'h-7 px-4 text-[12px] font-medium rounded-md transition-colors',
                'bg-foreground text-background hover:bg-foreground/85',
                'disabled:opacity-20',
              )}
              disabled={!title.trim() || createIssue.isPending}
              onClick={handleCreate}
              data-testid="kanban-create-issue-btn"
            >
              Create issue
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
