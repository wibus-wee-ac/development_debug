// Input: workspaceId, defaultStatusId, useStatuses, useMilestones, useCreateIssue, Dialog, Select, Kbd
// Output: CreateIssueDialog — modal for creating a new kanban issue with properties
// Position: Feature dialog opened from KanbanColumn; replaces inline column input

import { Dialog, DialogClose, DialogPopup } from '@renderer/components/ui/dialog'
import { Kbd } from '@renderer/components/ui/kbd'
import { Select, SelectItem, SelectPopup, SelectTrigger } from '@renderer/components/ui/select'
import { Textarea } from '@renderer/components/ui/textarea'
import { useAgentProfiles } from '@renderer/features/agent-runtime/use-agent-profiles'
import { cn } from '@renderer/lib/cn'
import { AlignLeftIcon, BotIcon, UserIcon } from 'lucide-react'
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
  'flex items-center gap-1.5 h-6 px-2 rounded-md text-[12px] font-normal transition-colors',
  'bg-transparent border border-border/30 text-muted-foreground/60',
  'hover:bg-muted/50 hover:text-foreground hover:border-border/60',
  '[&>[data-slot=select-icon]]:hidden',
)

export function CreateIssueDialog({ open, onOpenChange, workspaceId, defaultStatusId }: CreateIssueDialogProps) {
  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const { profiles: agentProfiles = [] } = useAgentProfiles()
  const createIssue = useCreateIssue()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [descOpen, setDescOpen] = useState(false)
  const [statusId, setStatusId] = useState<string | null>(defaultStatusId ?? null)
  const [priority, setPriority] = useState('none')
  const [milestoneId, setMilestoneId] = useState<string | null>(null)
  const [assigneeVal, setAssigneeVal] = useState('')

  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setStatusId(defaultStatusId ?? null)
      setTitle('')
      setDescription('')
      setDescOpen(false)
      setPriority('none')
      setMilestoneId(null)
      setAssigneeVal('')
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
        priority: priority !== 'none' ? (priority as 'low' | 'medium' | 'high' | 'urgent') : undefined,
        milestoneId: milestoneId ?? undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  const currentStatus = statuses.find(s => s.id === statusId)
  const currentPriority = PRIORITY_OPTIONS.find(o => o.value === priority)
  const currentMilestone = milestones.find(m => m.id === milestoneId)
  const enabledProfiles = agentProfiles.filter(p => p.enabled)
  const currentAgent = enabledProfiles.find(p => p.id === assigneeVal.slice(6))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        showCloseButton={false}
        className="max-w-135 overflow-visible p-0"
      >
        <div className="px-5 pt-5 pb-1">
          {/* Title */}
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Issue title…"
            className="w-full bg-transparent text-[15px] font-medium text-foreground placeholder:text-muted-foreground/30 outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleCreate()
              }
            }}
          />

          {/* Description toggle */}
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
                  className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
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
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                    placeholder="Add a description…"
                    rows={4}
                    className="mt-3 resize-none text-[13px] bg-transparent border-none shadow-none px-0 focus-visible:ring-0 placeholder:text-muted-foreground/25"
                  />
                </motion.div>
              )}
          </AnimatePresence>
        </div>

        {/* Property chips */}
        <div className="flex flex-wrap items-center gap-1.5 px-5 py-3 border-t border-border/25 mt-3">

          {/* Status */}
          <Select value={statusId ?? ''} onValueChange={v => setStatusId(v || null)}>
            <SelectTrigger className={chipCls}>
              {currentStatus
                ? (
                  <>
                    <StatusIcon color={currentStatus.color} className="size-2.5" />
                    {currentStatus.name}
                  </>
                )
                : <span className="text-muted-foreground/35">Status</span>}
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value=""><span className="text-muted-foreground/35">No status</span></SelectItem>
              {statuses.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex items-center gap-2">
                    <StatusIcon color={s.color} className="size-2.5" />
                    {s.name}
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>

          {/* Priority */}
          <Select value={priority} onValueChange={v => setPriority(v ?? 'none')}>
            <SelectTrigger className={chipCls}>
              <PriorityIcon priority={priority} className="size-3" />
              {currentPriority?.label ?? 'No priority'}
            </SelectTrigger>
            <SelectPopup>
              {PRIORITY_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  <span className="flex items-center gap-2">
                    <PriorityIcon priority={o.value} className="size-3" />
                    {o.label}
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>

          {/* Milestone */}
          {milestones.length > 0 && (
            <Select value={milestoneId ?? ''} onValueChange={v => setMilestoneId(v || null)}>
              <SelectTrigger className={chipCls}>
                {currentMilestone
                  ? <span className="truncate max-w-28">{currentMilestone.title}</span>
                  : <span className="text-muted-foreground/35">Milestone</span>}
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value=""><span className="text-muted-foreground/35">None</span></SelectItem>
                {milestones.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}

          {/* Assignee */}
          <Select value={assigneeVal} onValueChange={v => setAssigneeVal(v ?? '')}>
            <SelectTrigger className={chipCls}>
              {assigneeVal.startsWith('agent:')
                ? (
                  <>
                    <BotIcon className="size-3" />
                    {currentAgent?.name ?? 'Agent'}
                  </>
                )
                : assigneeVal === 'user:__self__'
                  ? (
                    <>
                      <UserIcon className="size-3" />
                      Me
                    </>
                  )
                  : <span className="text-muted-foreground/35">Assignee</span>}
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value=""><span className="text-muted-foreground/35">Unassigned</span></SelectItem>
              <SelectItem value="user:__self__">
                <span className="flex items-center gap-2">
                  <UserIcon className="size-3" />
                  Me
                </span>
              </SelectItem>
              {enabledProfiles.length > 0 && (
                <div className="px-2 pt-1.5 pb-0.5 text-[11px] text-muted-foreground/30 select-none">Agents</div>
              )}
              {enabledProfiles.map(p => (
                <SelectItem key={p.id} value={`agent:${p.id}`}>
                  <span className="flex items-center gap-2">
                    <BotIcon className="size-3" />
                    {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 pb-4 pt-0">
          <Kbd className="text-[11px]">⌘↵</Kbd>
          <div className="flex items-center gap-2">
            <DialogClose className="h-7 px-3 text-[12px] rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors">
              Cancel
            </DialogClose>
            <button
              className={cn(
                'h-7 px-3.5 text-[12px] font-medium rounded-lg transition-colors',
                'bg-foreground text-background hover:bg-foreground/85',
                'disabled:opacity-30',
              )}
              disabled={!title.trim() || createIssue.isPending}
              onClick={handleCreate}
            >
              Create issue
            </button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  )
}
