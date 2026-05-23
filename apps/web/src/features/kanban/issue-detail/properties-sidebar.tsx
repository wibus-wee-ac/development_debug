import { BotIcon, PlusIcon, UserRoundXIcon } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { cn } from '~/lib/cn'
import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/lib/types'

import { AssigneeAvatar } from '../shared/assignee-avatar'
import { priorityOptions } from '../shared/issue-metadata'
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

type AssigneeKind = 'user' | 'agent'

interface HumanAssignee {
  id: string
  name: string
}

const CURRENT_USER_ASSIGNEE: HumanAssignee = {
  id: '__self__',
  name: 'Me',
}

interface PropertiesSidebarProps {
  issue: KanbanIssue
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  workspaceId: string
  onUpdate: (patch: IssuePatch) => void
}

export const PropertiesSidebar = memo(({ issue, statuses, milestones, workspaceId: _workspaceId, onUpdate }: PropertiesSidebarProps) => {
  const currentStatus = statuses.find(s => s.id === issue.statusId)
  const currentMilestone = milestones.find(m => m.id === issue.milestoneId)
  const labels = issue.labels

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
              <DropdownMenuRadioGroup value={issue.statusId ?? ''} onValueChange={v => onUpdate({ statusId: v })}>
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
              <DropdownMenuRadioGroup value={issue.priority} onValueChange={v => onUpdate({ priority: v as IssuePriority })}>
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
          <AssigneePicker issue={issue} onUpdate={onUpdate} />
        </PropertyRow>

        {/* Labels */}
        <PropertyRow label="Labels">
          <LabelsEditor labels={labels} onUpdate={newLabels => onUpdate({ labels: newLabels })} />
        </PropertyRow>

        {/* Milestone */}
        <PropertyRow label="Milestone">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] text-foreground hover:bg-fill transition-colors">
              <span>{currentMilestone?.title ?? 'None'}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuRadioGroup value={issue.milestoneId ?? ''} onValueChange={v => onUpdate({ milestoneId: v || null })}>
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
})

PropertiesSidebar.displayName = 'PropertiesSidebar'

function PropertyRow({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  )
}

function AssigneePicker({ issue, onUpdate }: { issue: KanbanIssue, onUpdate: (patch: IssuePatch) => void }) {
  const { agents } = useAgents()
  const delegateIssue = useDelegateIssue()
  const undelegateIssue = useUndelegateIssue()
  const agentCandidates = useMemo(
    () => agents.filter(agent => !!agent.agentProfileId),
    [agents],
  )
  const humanCandidates = useMemo(() => [CURRENT_USER_ASSIGNEE], [])
  const assignedAgent = agentCandidates.find(agent => (
    (issue.assigneeKind === 'agent' && agent.id === issue.assigneeId)
    || agent.id === issue.delegateAgentId
    || agent.agentProfileId === issue.delegateAgentProfileId
  )) ?? null
  const assignedHuman = issue.assigneeKind === 'user'
    ? humanCandidates.find(candidate => candidate.id === issue.assigneeId) ?? {
        id: issue.assigneeId ?? '',
        name: issue.assigneeId ?? 'Unknown user',
      }
    : null
  const selectedValue = assignedAgent
    ? `agent:${assignedAgent.id}`
    : assignedHuman?.id
      ? `user:${assignedHuman.id}`
      : ''
  const isMutating = delegateIssue.isPending || undelegateIssue.isPending

  const handleAssigneeChange = useCallback((value: string) => {
    if (value === '') {
      if (issue.delegateAgentId || issue.delegateAgentProfileId) {
        undelegateIssue.mutate({ issueId: issue.id })
        return
      }
      onUpdate({ assigneeKind: null, assigneeId: null })
      return
    }

    const [kind, id] = value.split(':', 2) as [AssigneeKind, string]
    if (kind === 'agent') {
      const agent = agentCandidates.find(candidate => candidate.id === id)
      if (!agent?.agentProfileId) {
        return
      }
      delegateIssue.mutate({ issueId: issue.id, agentId: agent.id, agentProfileId: agent.agentProfileId })
      return
    }

    if (kind === 'user') {
      if (issue.delegateAgentId || issue.delegateAgentProfileId) {
        undelegateIssue.mutate(
          { issueId: issue.id },
          { onSuccess: () => onUpdate({ assigneeKind: 'user', assigneeId: id }) },
        )
        return
      }
      onUpdate({ assigneeKind: 'user', assigneeId: id })
    }
  }, [agentCandidates, delegateIssue, issue.delegateAgentId, issue.delegateAgentProfileId, issue.id, onUpdate, undelegateIssue])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex max-w-40 items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px]',
          'transition-[background-color,color] hover:bg-fill',
          selectedValue ? 'text-foreground' : 'border border-dashed border-border text-muted-foreground hover:text-foreground',
        )}
        disabled={isMutating}
        data-testid="issue-assignee-trigger"
      >
        {assignedAgent
          ? <BotIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          : assignedHuman
            ? <AssigneeAvatar name={assignedHuman.name} size={16} />
            : <span className="flex size-4 items-center justify-center rounded-full border border-dashed border-muted-foreground/60" aria-hidden="true" />}
        <span className="truncate">
          {assignedAgent?.name ?? assignedHuman?.name ?? 'Unassigned'}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuRadioGroup value={selectedValue} onValueChange={handleAssigneeChange}>
          <DropdownMenuRadioItem value="" data-testid="issue-assignee-option-unassigned">
            <UserRoundXIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <span>Unassigned</span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Team members</DropdownMenuLabel>
          {humanCandidates.map(candidate => (
            <DropdownMenuRadioItem key={candidate.id} value={`user:${candidate.id}`} data-testid={`issue-assignee-option-user-${candidate.id}`}>
              <AssigneeAvatar name={candidate.name} size={18} />
              <span className="truncate">{candidate.name}</span>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>AI Agents</DropdownMenuLabel>
          {agentCandidates.length === 0
            ? (
                <DropdownMenuItem disabled>
                  <BotIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  No agents configured
                </DropdownMenuItem>
              )
            : agentCandidates.map(agent => (
                <DropdownMenuRadioItem key={agent.id} value={`agent:${agent.id}`} data-testid={`issue-assignee-option-agent-${agent.id}`}>
                  <BotIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{agent.name}</span>
                </DropdownMenuRadioItem>
              ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LabelsEditor({ labels, onUpdate }: { labels: string[], onUpdate: (labels: string[]) => void }) {
  const [inputValue, setInputValue] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
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
        <button
          key={l}
          type="button"
          onClick={() => handleRemove(l)}
          data-testid={`issue-label-chip-${l}`}
        >
          <LabelChip label={l} className="cursor-pointer hover:line-through" />
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-fill transition-colors"
          aria-label="Add label"
          data-testid="issue-label-add-trigger"
        >
          <PlusIcon className="size-3" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-2">
          <input
            ref={inputRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder="Add label..."
            data-testid="issue-label-input"
            aria-label="Issue label"
            className="w-full border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
