import { useCallback, useEffect, useRef, useState } from 'react'
import { BotIcon, PlusIcon } from 'lucide-react'

import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/lib/types'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { LabelChip } from '../shared/label-chip'
import { PriorityIcon } from '../shared/priority-icon'
import { StatusIcon } from '../shared/status-icon'
import type { IssuePriority } from '../use-kanban'
import { useDelegateIssue, useUndelegateIssue } from '../use-kanban'
import type { StatusCategory } from '../use-view-config'
import { RelationManager } from './relation-manager'

type IssuePatch = Partial<{
  title: string
  description: string | null
  priority: IssuePriority
  labels: string[]
  milestoneId: string | null
  parentIssueId: string | null
  statusId: string | null
  assigneeKind: string | null
  assigneeId: string | null
}>

interface PropertiesSidebarProps {
  issue: KanbanIssue
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  workspaceId: string
  onUpdate: (patch: IssuePatch) => void
}

const priorityOptions: { value: IssuePriority, label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'No priority' },
]

export function PropertiesSidebar({ issue, statuses, milestones, workspaceId: _workspaceId, onUpdate }: PropertiesSidebarProps) {
  const currentStatus = statuses.find(s => s.id === issue.statusId)
  const currentMilestone = milestones.find(m => m.id === issue.milestoneId)
  const labels: string[] = (() => { try { return JSON.parse(issue.labels || '[]') } catch { return [] } })()

  return (
    <div className="flex flex-col gap-1">
      <div className="bg-card rounded-lg px-3 py-2 text-sm shadow-xs font-medium text-muted-foreground border border-border">
        {/* Status */}
        <PropertyRow label="Status">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] text-foreground hover:bg-fill transition-colors">
              {currentStatus && <StatusIcon category={currentStatus.category as StatusCategory} size={14} />}
              <span>{currentStatus?.name ?? 'None'}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuRadioGroup value={issue.statusId ?? ''} onValueChange={(v) => onUpdate({ statusId: v })}>
                {statuses.map(s => (
                  <DropdownMenuRadioItem key={s.id} value={s.id}>
                    <StatusIcon category={s.category as StatusCategory} size={14} />
                    {s.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </PropertyRow>

        {/* Priority */}
        <PropertyRow label="Priority">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] text-foreground hover:bg-fill transition-colors"
              data-testid="issue-priority-trigger"
            >
              <PriorityIcon priority={issue.priority as IssuePriority} size={14} />
              <span>{priorityOptions.find(p => p.value === issue.priority)?.label ?? 'No priority'}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuRadioGroup value={issue.priority} onValueChange={(v) => onUpdate({ priority: v as IssuePriority })}>
                {priorityOptions.map(p => (
                  <DropdownMenuRadioItem key={p.value} value={p.value} data-testid={`issue-priority-option-${p.value}`}>
                    <PriorityIcon priority={p.value} size={14} />
                    {p.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </PropertyRow>

        {/* Assignee */}
        <PropertyRow label="Assignee">
          <span className="text-[13px] text-muted-foreground px-1.5 py-0.5">Unassigned</span>
        </PropertyRow>

        {/* Agent Delegate */}
        <AgentDelegateRow issue={issue} />

        {/* Labels */}
        <PropertyRow label="Labels">
          <LabelsEditor labels={labels} onUpdate={(newLabels) => onUpdate({ labels: newLabels })} />
        </PropertyRow>

        {/* Milestone */}
        <PropertyRow label="Milestone">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] text-foreground hover:bg-fill transition-colors">
              <span>{currentMilestone?.title ?? 'None'}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuRadioGroup value={issue.milestoneId ?? ''} onValueChange={(v) => onUpdate({ milestoneId: v || null })}>
                <DropdownMenuRadioItem value="">
                  No milestone
                </DropdownMenuRadioItem>
                {milestones.length > 0 && <DropdownMenuSeparator />}
                {milestones.map(m => (
                  <DropdownMenuRadioItem key={m.id} value={m.id}>
                    {m.title}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </PropertyRow>
      </div>

      <div className="my-3" />

      <div className="bg-card rounded-lg px-3 py-2 shadow-xs text-sm font-medium text-muted-foreground border border-border">
        <RelationManager issueId={issue.id} />
      </div>
    </div>
  )
}

function PropertyRow({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="flex items-center">{children}</div>
    </div>
  )
}

function LabelsEditor({ labels, onUpdate }: { labels: string[], onUpdate: (labels: string[]) => void }) {
  const [inputValue, setInputValue] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const handleAdd = useCallback(() => {
    const trimmed = inputValue.trim()
    if (trimmed && !labels.includes(trimmed)) {
      onUpdate([...labels, trimmed])
      setInputValue('')
    }
  }, [inputValue, labels, onUpdate])

  const handleRemove = useCallback((label: string) => {
    onUpdate(labels.filter(l => l !== label))
  }, [labels, onUpdate])

  return (
    <div className="flex flex-wrap items-center gap-1">
      {labels.map(l => (
        <button key={l} type="button" onClick={() => handleRemove(l)}>
          <LabelChip label={l} className="cursor-pointer hover:line-through" />
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-fill transition-colors">
          <PlusIcon className="size-3" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-2">
          <input
            ref={inputRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
            }}
            placeholder="Add label..."
            className="w-full border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

function AgentDelegateRow({ issue }: { issue: KanbanIssue }) {
  const { agents } = useAgents()
  const delegateIssue = useDelegateIssue()
  const undelegateIssue = useUndelegateIssue()

  const delegatedAgent = issue.delegateAgentProfileId
    ? agents.find(a => a.agentProfileId === issue.delegateAgentProfileId) ?? null
    : null

  return (
    <PropertyRow label="Agent">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-fill transition-colors"
          data-testid="issue-agent-delegate-trigger"
        >
          <BotIcon className="size-3" />
          <span>{delegatedAgent ? delegatedAgent.name : 'Unassigned'}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          {delegatedAgent && (
            <>
              <DropdownMenuItem
                onClick={() => undelegateIssue.mutate({ issueId: issue.id })}
                data-testid="issue-agent-option-unassigned"
              >
                Unassigned
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {agents.length === 0 && !delegatedAgent
            ? <p className="px-2 py-1.5 text-[12px] text-muted-foreground">No agents configured</p>
            : agents.map(a => (
              <DropdownMenuItem
                key={a.id}
                onClick={() => delegateIssue.mutate({ issueId: issue.id, agentProfileId: a.agentProfileId, agentId: a.id })}
                data-testid={`issue-agent-option-${a.id}`}
              >
                <BotIcon className="size-3 text-muted-foreground" />
                {a.name}
              </DropdownMenuItem>
            ))
          }
        </DropdownMenuContent>
      </DropdownMenu>
    </PropertyRow>
  )
}
