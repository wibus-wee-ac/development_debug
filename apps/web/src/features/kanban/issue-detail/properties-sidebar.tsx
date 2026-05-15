import { useCallback, useEffect, useRef, useState } from 'react'
import { BotIcon, CheckIcon, PlusIcon } from 'lucide-react'

import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/lib/types'

import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
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
      {/* Status */}
      <PropertyRow label="Status">
        <Popover>
          <PopoverTrigger className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] text-foreground hover:bg-fill transition-colors">
            {currentStatus && <StatusIcon category={currentStatus.category as StatusCategory} size={14} />}
            <span>{currentStatus?.name ?? 'None'}</span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-1">
            {statuses.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => onUpdate({ statusId: s.id })}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] text-foreground hover:bg-fill transition-colors"
              >
                <StatusIcon category={s.category as StatusCategory} size={14} />
                <span className="flex-1 text-left">{s.name}</span>
                {s.id === issue.statusId && <CheckIcon className="size-3 text-muted-foreground" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </PropertyRow>

      {/* Priority */}
      <PropertyRow label="Priority">
        <Popover>
          <PopoverTrigger
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] text-foreground hover:bg-fill transition-colors"
            data-testid="issue-priority-trigger"
          >
            <PriorityIcon priority={issue.priority as IssuePriority} size={14} />
            <span>{priorityOptions.find(p => p.value === issue.priority)?.label ?? 'No priority'}</span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-44 p-1">
            {priorityOptions.map(p => (
              <button
                key={p.value}
                type="button"
                onClick={() => onUpdate({ priority: p.value })}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] text-foreground hover:bg-fill transition-colors"
                data-testid={`issue-priority-option-${p.value}`}
              >
                <PriorityIcon priority={p.value} size={14} />
                <span className="flex-1 text-left">{p.label}</span>
                {issue.priority === p.value && <CheckIcon className="size-3 text-muted-foreground" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </PropertyRow>

      {/* Assignee */}
      <PropertyRow label="Assignee">
        <span className="text-[13px] text-muted-foreground/60 px-1.5 py-0.5">Unassigned</span>
      </PropertyRow>

      {/* Agent Delegate */}
      <AgentDelegateRow issue={issue} />

      {/* Labels */}
      <PropertyRow label="Labels">
        <LabelsEditor labels={labels} onUpdate={(newLabels) => onUpdate({ labels: newLabels })} />
      </PropertyRow>

      {/* Milestone */}
      <PropertyRow label="Milestone">
        <Popover>
          <PopoverTrigger className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] text-foreground hover:bg-fill transition-colors">
            <span>{currentMilestone?.title ?? 'None'}</span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-1">
            <button
              type="button"
              onClick={() => onUpdate({ milestoneId: null })}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-fill transition-colors"
            >
              No milestone
              {!issue.milestoneId && <CheckIcon className="size-3 ml-auto" />}
            </button>
            {milestones.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => onUpdate({ milestoneId: m.id })}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] text-foreground hover:bg-fill transition-colors"
              >
                <span className="flex-1 text-left">{m.title}</span>
                {m.id === issue.milestoneId && <CheckIcon className="size-3 text-muted-foreground" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </PropertyRow>

      <div className="my-3" />

      {/* Relations */}
      <RelationManager issueId={issue.id} />
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
    if (!open) {
      return
    }
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
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
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder="Add label..."
            className="w-full border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

function AgentDelegateRow({ issue }: { issue: KanbanIssue }) {
  const { profiles } = useAgentProfiles()
  const delegateIssue = useDelegateIssue()
  const undelegateIssue = useUndelegateIssue()
  const enabledProfiles = profiles.filter(p => p.enabled)

  const delegatedProfile = issue.delegateAgentId
    ? profiles.find(p => p.id === issue.delegateAgentId)
    : null

  return (
    <PropertyRow label="Agent">
      <Popover>
        <PopoverTrigger
          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] text-text-tertiary hover:text-foreground hover:bg-fill transition-colors"
          data-testid="issue-agent-delegate-trigger"
        >
          <BotIcon className="size-3" />
          <span>{delegatedProfile ? delegatedProfile.name : 'Unassigned'}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-48 p-1">
          {delegatedProfile && (
            <button
              type="button"
              onClick={() => undelegateIssue.mutate({ issueId: issue.id })}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-fill transition-colors"
              data-testid="issue-agent-option-unassigned"
            >
              <span className="flex-1 text-left">Unassigned</span>
            </button>
          )}
          {enabledProfiles.length === 0 ? (
            !delegatedProfile && <p className="px-2 py-1.5 text-[12px] text-muted-foreground">No providers configured</p>
          ) : (
            enabledProfiles.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => delegateIssue.mutate({ issueId: issue.id, agentProfileId: p.id })}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] transition-colors ${
                  delegatedProfile?.id === p.id
                    ? 'text-foreground bg-fill/50'
                    : 'text-foreground hover:bg-fill'
                }`}
                data-testid={`issue-agent-option-${p.id}`}
              >
                <BotIcon className="size-3 text-muted-foreground" />
                <span className="flex-1 text-left">{p.name}</span>
              </button>
            ))
          )}
        </PopoverContent>
      </Popover>
    </PropertyRow>
  )
}
