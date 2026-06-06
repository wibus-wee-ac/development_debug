import { BotIcon, CalendarIcon, CheckIcon, PencilIcon, PlusIcon, SearchIcon, TagsIcon, Trash2Icon, UserRoundXIcon, XIcon } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Calendar } from '~/components/ui/calendar'
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
import { AgentAvatar } from '~/features/agent-runtime/agent-avatar'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { cn } from '~/lib/cn'
import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'

import { AssigneeAvatar } from '../shared/assignee-avatar'
import { findDelegatedAgent } from '../shared/issue-delegation'
import { priorityOptions } from '../shared/issue-metadata'
import { LabelChip } from '../shared/label-chip'
import {
  buildDeleteLabelPatches,
  buildRenameLabelPatches,
  collectWorkspaceLabelOptions,
  filterWorkspaceLabelOptions,
  getLabelTone,
} from '../shared/label-metadata'
import { PriorityIcon } from '../shared/priority-icon'
import { StatusIcon } from '../shared/status-icon'
import type { IssuePriority } from '../use-kanban'
import { useDelegateIssue, usePatchIssueLabels, useUndelegateIssue } from '../use-kanban'
import type { StatusCategory } from '../use-view-config'
import { RelationManager } from './relation-manager'

const priorityLabelKeys: Record<IssuePriority, 'priority.none' | 'priority.low' | 'priority.medium' | 'priority.high' | 'priority.urgent'> = {
  none: 'priority.none',
  low: 'priority.low',
  medium: 'priority.medium',
  high: 'priority.high',
  urgent: 'priority.urgent',
}

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
  dueDate: number | null
}>

const CURRENT_USER_ASSIGNEE_ID = '__self__'

interface PropertiesSidebarProps {
  issue: KanbanIssue
  issues: KanbanIssue[]
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  onUpdate: (patch: IssuePatch) => void
}

export const PropertiesSidebar = memo(({ issue, issues, statuses, milestones, onUpdate }: PropertiesSidebarProps) => {
  const { t } = useTranslation('kanban')
  const currentStatus = statuses.find(s => s.id === issue.statusId)
  const currentMilestone = milestones.find(m => m.id === issue.milestoneId)
  const labels = issue.labels
  const labelWorkspaceIssues = useMemo(() => {
    const hasCurrentIssue = issues.some(candidate => candidate.id === issue.id)
    if (!hasCurrentIssue) {
      return [...issues, issue]
    }

    return issues.map(candidate => candidate.id === issue.id ? issue : candidate)
  }, [issue, issues])

  return (
    <div className="flex flex-col gap-1">
      <div className="bg-card rounded-lg px-3 py-2 text-sm shadow-xs font-medium text-muted-foreground border border-border">
        {/* Status */}
        <PropertyRow label={t('property.status')}>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] text-foreground hover:bg-fill transition-colors" data-testid="issue-status-trigger">
              {currentStatus && <StatusIcon category={currentStatus.category as StatusCategory} size={14} />}
              <span>{currentStatus?.name ?? t('priority.none')}</span>
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
        <PropertyRow label={t('property.priority')}>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] text-foreground hover:bg-fill transition-colors"
              data-testid="issue-priority-trigger"
            >
              <PriorityIcon priority={issue.priority as IssuePriority} size={14} />
              <span>{t(priorityLabelKeys[issue.priority as IssuePriority] ?? 'issue.label.noPriority')}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuRadioGroup value={issue.priority} onValueChange={v => onUpdate({ priority: v as IssuePriority })}>
                {priorityOptions.map(p => (
                  <DropdownMenuRadioItem key={p.value} value={p.value} data-testid={`issue-priority-option-${p.value}`}>
                    <PriorityIcon priority={p.value} size={14} />
                    {t(priorityLabelKeys[p.value])}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </PropertyRow>

        {/* Assignee */}
        <PropertyRow label={t('property.assignee')}>
          <AssigneePicker issue={issue} onUpdate={onUpdate} />
        </PropertyRow>

        {/* Agent */}
        <PropertyRow label={t('property.agent')}>
          <AgentDelegatePicker issue={issue} />
        </PropertyRow>

        {/* Labels */}
        <PropertyRow label={t('property.labels')}>
          <LabelsEditor labels={labels} workspaceIssues={labelWorkspaceIssues} onUpdate={newLabels => onUpdate({ labels: newLabels })} />
        </PropertyRow>

        {/* Milestone */}
        <PropertyRow label={t('property.milestone')}>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] text-foreground hover:bg-fill transition-colors">
              <span>{currentMilestone?.title ?? t('priority.none')}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuRadioGroup value={issue.milestoneId ?? ''} onValueChange={v => onUpdate({ milestoneId: v || null })}>
                <DropdownMenuRadioItem value="">
                  {t('issue.label.noMilestone')}
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

        {/* Due date */}
        <PropertyRow label={t('display.dueDate')}>
          <DueDateEditor dueDate={issue.dueDate} onUpdate={dueDate => onUpdate({ dueDate })} />
        </PropertyRow>
      </div>

      <div className="my-3" />

      <div className="bg-card rounded-lg px-3 py-2 shadow-xs text-sm font-medium text-muted-foreground border border-border">
        <RelationManager issueId={issue.id} workspaceId={issue.workspaceId} />
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

function toDateInputValue(ts: number | null | undefined): string {
  return ts ? formatIssueDate(new Date(ts * 1000)) : ''
}

function toCalendarDate(ts: number | null | undefined): Date | undefined {
  return ts ? new Date(ts * 1000) : undefined
}

function fromCalendarDate(value: Date | undefined): number | null {
  return value ? Math.floor(new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime() / 1000) : null
}

function formatIssueDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(value)
}

function DueDateEditor({ dueDate, onUpdate }: { dueDate: number | null, onUpdate: (dueDate: number | null) => void }) {
  const { t } = useTranslation('kanban')
  const selectedDate = toCalendarDate(dueDate)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex max-w-40 items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px]',
            'transition-colors hover:bg-fill',
            selectedDate ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <CalendarIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{selectedDate ? toDateInputValue(dueDate) : t('priority.none')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={date => onUpdate(fromCalendarDate(date))}
        />
        {selectedDate && (
          <div className="border-t border-border p-2">
            <button type="button" onClick={() => onUpdate(null)} className="w-full rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-fill hover:text-foreground">
              {t('filter.clear')}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function AssigneePicker({ issue, onUpdate }: { issue: KanbanIssue, onUpdate: (patch: IssuePatch) => void }) {
  const { t } = useTranslation('kanban')
  const humanCandidates = useMemo(() => [{ id: CURRENT_USER_ASSIGNEE_ID, name: t('assignee.currentUser') }], [t])
  const assignedHuman = issue.assigneeKind === 'user'
    ? humanCandidates.find(candidate => candidate.id === issue.assigneeId) ?? {
        id: issue.assigneeId ?? '',
        name: issue.assigneeId ?? t('assignee.unknownUser'),
      }
    : null
  const selectedValue = assignedHuman?.id ? `user:${assignedHuman.id}` : ''

  const handleAssigneeChange = useCallback((value: string) => {
    if (value === '') {
      onUpdate({ assigneeKind: null, assigneeId: null })
      return
    }

    const [kind, id] = value.split(':', 2) as ['user', string]
    if (kind === 'user') {
      onUpdate({ assigneeKind: 'user', assigneeId: id })
    }
  }, [onUpdate])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex max-w-40 items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px]',
          'transition-[background-color,color] hover:bg-fill',
          selectedValue ? 'text-foreground' : 'border border-dashed border-border text-muted-foreground hover:text-foreground',
        )}
        data-testid="issue-assignee-trigger"
      >
        {assignedHuman
          ? <AssigneeAvatar name={assignedHuman.name} size={16} />
          : <span className="flex size-4 items-center justify-center rounded-full border border-dashed border-muted-foreground/60" aria-hidden="true" />}
        <span className="truncate">
          {assignedHuman?.name ?? t('assignee.unassigned')}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuRadioGroup value={selectedValue} onValueChange={handleAssigneeChange}>
          <DropdownMenuRadioItem value="" data-testid="issue-assignee-option-unassigned">
            <UserRoundXIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <span>{t('assignee.unassigned')}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('assignee.teamMembers')}</DropdownMenuLabel>
          {humanCandidates.map(candidate => (
            <DropdownMenuRadioItem key={candidate.id} value={`user:${candidate.id}`} data-testid={`issue-assignee-option-user-${candidate.id}`}>
              <AssigneeAvatar name={candidate.name} size={18} />
              <span className="truncate">{candidate.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AgentDelegatePicker({ issue }: { issue: KanbanIssue }) {
  const { agents } = useAgents()
  const { t } = useTranslation('kanban')
  const delegateIssue = useDelegateIssue()
  const undelegateIssue = useUndelegateIssue()
  const agentCandidates = useMemo(
    () => agents.filter(agent => !!agent.providerTargetId),
    [agents],
  )
  const delegatedAgent = findDelegatedAgent(issue, agentCandidates)
  const selectedValue = delegatedAgent ? `agent:${delegatedAgent.id}` : ''
  const isMutating = delegateIssue.isPending || undelegateIssue.isPending

  const handleAgentChange = useCallback((value: string) => {
    if (value === '') {
      if (issue.delegateAgentId || issue.delegateAgentProfileId) {
        undelegateIssue.mutate({ issueId: issue.id })
      }
      return
    }

    const [, id] = value.split(':', 2)
    const agent = agentCandidates.find(candidate => candidate.id === id)
    if (typeof agent?.providerTargetId !== 'string' || !agent.providerTargetId) {
      return
    }
    delegateIssue.mutate({ issueId: issue.id, agentId: agent.id, providerTargetId: agent.providerTargetId })
  }, [agentCandidates, delegateIssue, issue.delegateAgentId, issue.delegateAgentProfileId, issue.id, undelegateIssue])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex max-w-40 items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px]',
          'transition-[background-color,color] hover:bg-fill',
          selectedValue ? 'text-foreground' : 'border border-dashed border-border text-muted-foreground hover:text-foreground',
        )}
        disabled={isMutating}
        data-testid="issue-agent-trigger"
      >
        {delegatedAgent
          ? (
              <AgentAvatar
                name={delegatedAgent.name}
                avatarUrl={delegatedAgent.avatarUrl}
                avatarStyle={delegatedAgent.avatarStyle}
                avatarSeed={delegatedAgent.avatarSeed}
                size={16}
              />
            )
          : <span className="flex size-4 items-center justify-center rounded-full border border-dashed border-muted-foreground/60" aria-hidden="true" />}
        <span className="truncate">
          {delegatedAgent?.name ?? t('agent.none')}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuRadioGroup value={selectedValue} onValueChange={handleAgentChange}>
          <DropdownMenuRadioItem value="" data-testid="issue-agent-option-none">
            <UserRoundXIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <span>{t('agent.none')}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('agent.availableAgents')}</DropdownMenuLabel>
          {agentCandidates.length === 0
            ? (
                <DropdownMenuItem disabled>
                  <BotIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  {t('agent.noAgentsConfigured')}
                </DropdownMenuItem>
              )
            : agentCandidates.map(agent => (
                <DropdownMenuRadioItem key={agent.id} value={`agent:${agent.id}`} data-testid={`issue-agent-option-${agent.id}`}>
                  <AgentAvatar
                    name={agent.name}
                    avatarUrl={agent.avatarUrl}
                    avatarStyle={agent.avatarStyle}
                    avatarSeed={agent.avatarSeed}
                    size={18}
                  />
                  <span className="truncate">{agent.name}</span>
                </DropdownMenuRadioItem>
              ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const LABEL_SUGGESTION_LIMIT = 6

function normalizeLabelForCompare(label: string): string {
  return label.trim().toLowerCase()
}

function LabelsEditor({
  labels,
  workspaceIssues,
  onUpdate,
}: {
  labels: string[]
  workspaceIssues: KanbanIssue[]
  onUpdate: (labels: string[]) => void
}) {
  const { t } = useTranslation('kanban')
  const [inputValue, setInputValue] = useState('')
  const [open, setOpen] = useState(false)
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const patchIssueLabels = usePatchIssueLabels()
  const workspaceLabelOptions = useMemo(
    () => collectWorkspaceLabelOptions(workspaceIssues),
    [workspaceIssues],
  )
  const labelSuggestions = useMemo(
    () => filterWorkspaceLabelOptions(workspaceLabelOptions, inputValue, labels).slice(0, LABEL_SUGGESTION_LIMIT),
    [inputValue, labels, workspaceLabelOptions],
  )
  const selectedLabelKeys = useMemo(
    () => new Set(labels.map(normalizeLabelForCompare)),
    [labels],
  )
  const trimmedInput = inputValue.trim()
  const canCreateLabel = trimmedInput.length > 0 && !selectedLabelKeys.has(normalizeLabelForCompare(trimmedInput))
  const isGlobalLabelMutating = patchIssueLabels.isPending

  useEffect(() => {
    if (!open) {
      return
    }
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!editingLabel) {
      return
    }
    requestAnimationFrame(() => renameInputRef.current?.focus())
  }, [editingLabel])

  const handleAddLabel = useCallback((label: string) => {
    const trimmed = label.trim()
    const labelKey = normalizeLabelForCompare(trimmed)

    if (!trimmed || selectedLabelKeys.has(labelKey)) {
      return
    }

    onUpdate([...labels, trimmed])
    setInputValue('')
    setOpen(false)
  }, [labels, onUpdate, selectedLabelKeys])

  const handleSubmitInput = useCallback(() => {
    const exactSuggestion = labelSuggestions.find(option => normalizeLabelForCompare(option.label) === normalizeLabelForCompare(inputValue))
    handleAddLabel(exactSuggestion?.label ?? inputValue)
  }, [handleAddLabel, inputValue, labelSuggestions])

  const handleRemove = useCallback((label: string) => {
    const labelKey = normalizeLabelForCompare(label)
    onUpdate(labels.filter(l => normalizeLabelForCompare(l) !== labelKey))
  }, [labels, onUpdate])

  const startRenamingLabel = useCallback((label: string) => {
    setEditingLabel(label)
    setRenameValue(label)
  }, [])

  const stopRenamingLabel = useCallback(() => {
    setEditingLabel(null)
    setRenameValue('')
  }, [])

  const commitRenameLabel = useCallback(() => {
    if (!editingLabel) {
      return
    }

    const patches = buildRenameLabelPatches(workspaceIssues, editingLabel, renameValue)

    if (patches.length === 0) {
      stopRenamingLabel()
      return
    }

    patchIssueLabels.mutate({ patches }, { onSuccess: stopRenamingLabel })
  }, [editingLabel, patchIssueLabels, renameValue, stopRenamingLabel, workspaceIssues])

  const deleteWorkspaceLabel = useCallback((label: string) => {
    const patches = buildDeleteLabelPatches(workspaceIssues, label)

    if (patches.length === 0) {
      return
    }

    patchIssueLabels.mutate({ patches })
  }, [patchIssueLabels, workspaceIssues])

  return (
    <div className="flex flex-wrap items-center gap-1">
      {labels.map(l => (
        <button
          key={l}
          type="button"
          onClick={() => handleRemove(l)}
          aria-label={`Remove label ${l}`}
          data-testid={`issue-label-chip-${l}`}
        >
          <LabelChip label={l} className="cursor-pointer hover:line-through" />
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-fill transition-colors"
          aria-label={t('issue.label.addAria')}
          data-testid="issue-label-add-trigger"
        >
          <PlusIcon className="size-3" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <div className="border-b border-border p-2">
            <div className="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2">
              <SearchIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <input
                ref={inputRef}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSubmitInput()
                  }
                  if (e.key === 'Escape') {
                    setOpen(false)
                  }
                }}
                placeholder={t('issue.label.inputPlaceholder')}
                data-testid="issue-label-input"
                aria-label={t('issue.label.inputAria')}
                className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="mt-2 flex flex-col gap-0.5">
              {labelSuggestions.map(option => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => handleAddLabel(option.label)}
                  className="flex h-7 items-center gap-2 rounded-md px-1.5 text-left text-[12px] text-foreground hover:bg-fill transition-colors"
                  aria-label={t('issue.label.addSuggestionAria', { label: option.label })}
                  data-testid={`issue-label-suggestion-${option.label}`}
                >
                  <LabelChip label={option.label} tone={option.tone} />
                  <span className="ml-auto tabular-nums text-[11px] text-muted-foreground">{option.count}</span>
                </button>
              ))}

              {canCreateLabel && (
                <button
                  type="button"
                  onClick={() => handleAddLabel(trimmedInput)}
                  className="flex h-7 items-center gap-2 rounded-md px-1.5 text-left text-[12px] text-foreground hover:bg-fill transition-colors"
                  aria-label={t('issue.label.createAria', { label: trimmedInput })}
                  data-testid="issue-label-create-option"
                >
                  <PlusIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{t('issue.label.create', { label: trimmedInput })}</span>
                </button>
              )}

              {!canCreateLabel && labelSuggestions.length === 0 && (
                <div className="px-1.5 py-2 text-[12px] text-muted-foreground">
                  {t('issue.label.noMatches')}
                </div>
              )}
            </div>
          </div>

          <div className="p-2">
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <TagsIcon className="size-3" aria-hidden="true" />
              {t('issue.label.workspaceLabels')}
            </div>

            <div className="max-h-52 overflow-y-auto pr-1">
              {workspaceLabelOptions.length === 0
                ? (
                    <div className="px-1 py-2 text-[12px] text-muted-foreground">
                      {t('issue.label.empty')}
                    </div>
                  )
                : workspaceLabelOptions.map(option => (
                    <div key={option.label} className="flex h-8 items-center gap-1.5 rounded-md px-1 hover:bg-fill">
                      {editingLabel === option.label
                        ? (
                            <>
                              <span className={cn('size-2 shrink-0 rounded-full', {
                                'bg-blue-500': getLabelTone(renameValue) === 'blue',
                                'bg-emerald-500': getLabelTone(renameValue) === 'green',
                                'bg-amber-500': getLabelTone(renameValue) === 'amber',
                                'bg-rose-500': getLabelTone(renameValue) === 'rose',
                                'bg-violet-500': getLabelTone(renameValue) === 'violet',
                                'bg-cyan-500': getLabelTone(renameValue) === 'cyan',
                                'bg-slate-500': getLabelTone(renameValue) === 'slate',
                              })}
                              />
                              <input
                                ref={renameInputRef}
                                value={renameValue}
                                onChange={event => setRenameValue(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    commitRenameLabel()
                                  }
                                  if (event.key === 'Escape') {
                                    stopRenamingLabel()
                                  }
                                }}
                                disabled={isGlobalLabelMutating}
                                aria-label={`Rename label ${option.label}`}
                                className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-[12px] text-foreground outline-none focus-visible:border-ring"
                              />
                              <button
                                type="button"
                                onClick={commitRenameLabel}
                                disabled={isGlobalLabelMutating}
                                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-50 transition-colors"
                                aria-label={`Save label ${option.label}`}
                              >
                                <CheckIcon className="size-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={stopRenamingLabel}
                                disabled={isGlobalLabelMutating}
                                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-50 transition-colors"
                                aria-label={`Cancel label ${option.label}`}
                              >
                                <XIcon className="size-3.5" aria-hidden="true" />
                              </button>
                            </>
                          )
                        : (
                            <>
                              <LabelChip label={option.label} tone={option.tone} className="max-w-32 truncate" />
                              <span className="ml-auto tabular-nums text-[11px] text-muted-foreground">{option.count}</span>
                              <button
                                type="button"
                                onClick={() => startRenamingLabel(option.label)}
                                disabled={isGlobalLabelMutating}
                                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-50 transition-colors"
                                aria-label={`Rename label ${option.label}`}
                              >
                                <PencilIcon className="size-3" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteWorkspaceLabel(option.label)}
                                disabled={isGlobalLabelMutating}
                                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-destructive disabled:pointer-events-none disabled:opacity-50 transition-colors"
                                aria-label={`Delete label ${option.label}`}
                              >
                                <Trash2Icon className="size-3" aria-hidden="true" />
                              </button>
                            </>
                          )}
                    </div>
                  ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
