/**
 * Output: TanStack Table issue view with sorting, filtering, column visibility, and external selection state.
 * Input: Kanban issues, workspace statuses/milestones, parent refs, and existing issue open/selection callbacks.
 * Position: Kanban feature presentation layer; it does not own Issue semantics or persistence.
 */
import type { ColumnDef, SortingState, VisibilityState } from '@tanstack/react-table'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, CalendarIcon, CheckIcon, Columns3Icon, SearchIcon, TagsIcon, UserRoundXIcon, XIcon } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Calendar } from '~/components/ui/calendar'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { AgentAvatar } from '~/features/agent-runtime/agent-avatar'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'

import { IssueContextMenu } from './issue-context-menu'
import type { IssueSelectionMode } from './kanban-selection'
import { AssigneeAvatar } from './shared/assignee-avatar'
import { formatIssueId } from './shared/format-issue-id'
import { findDelegatedAgent } from './shared/issue-delegation'
import { LabelChip } from './shared/label-chip'
import { collectWorkspaceLabelOptions, filterWorkspaceLabelOptions } from './shared/label-metadata'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import { useDelegateIssue, useUndelegateIssue, useUpdateIssue } from './use-kanban'
import type { StatusCategory, ViewConfig } from './use-view-config'

interface KanbanTableProps {
  issues: KanbanIssue[]
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  parentIssueRefs: Map<string, ParentIssueRef>
  displayProperties: ViewConfig['displayProperties']
  highlightedIssueId?: string | null
  selectedIssueIds?: Set<string>
  onIssueClick: (id: string) => void
  onIssueSelectionGesture?: (id: string, mode: IssueSelectionMode) => void
}

interface IssueTableRow {
  issue: KanbanIssue
  issueKey: string
  parentKey: string
  statusName: string
  statusCategory: StatusCategory | null
  statusOrder: number
  priority: KanbanIssue['priority']
  priorityOrder: number
  labelsText: string
  labels: string[]
  assigneeName: string
  delegatedAgentName: string
  delegatedAgentAvatarUrl: string | null
  delegatedAgentAvatarStyle: string | null
  delegatedAgentAvatarSeed: string | null
  milestoneTitle: string
  dueDate: number | null
  updatedAt: number
}

const CURRENT_USER_ASSIGNEE_ID = '__self__'
const LABEL_SUGGESTION_LIMIT = 8
const EMPTY_SORT_VALUE = Number.MAX_SAFE_INTEGER
const PRIORITY_SORT_ORDER: Record<KanbanIssue['priority'], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
}

function normalizeLabelForCompare(label: string): string {
  return label.trim().toLowerCase()
}

function formatDate(ts: number | null | undefined): string {
  if (!ts) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(ts * 1000))
}

function toCalendarDate(ts: number | null | undefined): Date | undefined {
  return ts ? new Date(ts * 1000) : undefined
}

function fromCalendarDate(value: Date | undefined): number | null {
  return value ? Math.floor(new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime() / 1000) : null
}

function formatDateTime(ts: number | null | undefined): string {
  if (!ts) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts * 1000))
}

function SortIndicator({ sorted, sortIndex }: { sorted: false | 'asc' | 'desc', sortIndex: number }) {
  if (sorted === 'asc') {
    return (
      <span className="flex items-center gap-1">
        <ArrowUpIcon className="size-3 text-foreground" aria-hidden="true" />
        {sortIndex >= 0 && <span className="text-[9px] text-foreground tabular-nums">{sortIndex + 1}</span>}
      </span>
    )
  }
  if (sorted === 'desc') {
    return (
      <span className="flex items-center gap-1">
        <ArrowDownIcon className="size-3 text-foreground" aria-hidden="true" />
        {sortIndex >= 0 && <span className="text-[9px] text-foreground tabular-nums">{sortIndex + 1}</span>}
      </span>
    )
  }
  return <ArrowUpDownIcon className="size-3 text-muted-foreground" aria-hidden="true" />
}

function AssigneeCell({ issue }: { issue: KanbanIssue }) {
  const { t } = useTranslation('kanban')
  const updateIssue = useUpdateIssue()
  const currentUserName = t('assignee.currentUser')
  const assignedHuman = issue.assigneeKind === 'user'
    ? {
        id: issue.assigneeId ?? '',
        name: issue.assigneeId === CURRENT_USER_ASSIGNEE_ID ? currentUserName : issue.assigneeId ?? t('assignee.unknownUser'),
      }
    : null
  const selectedValue = assignedHuman?.id ? `user:${assignedHuman.id}` : ''

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px]',
            'transition-colors hover:bg-fill',
            assignedHuman ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {assignedHuman
            ? <AssigneeAvatar name={assignedHuman.name} size={16} />
            : <UserRoundXIcon className="size-3.5" aria-hidden="true" />}
          <span className="truncate">{assignedHuman?.name ?? t('assignee.unassigned')}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup
          value={selectedValue}
          onValueChange={(value) => {
            if (!value) {
              updateIssue.mutate({ id: issue.id, patch: { assigneeKind: null, assigneeId: null } })
              return
            }

            const [, assigneeId] = value.split(':', 2)
            updateIssue.mutate({ id: issue.id, patch: { assigneeKind: 'user', assigneeId } })
          }}
        >
          <DropdownMenuRadioItem value="">
            <UserRoundXIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <span>{t('assignee.unassigned')}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('assignee.teamMembers')}</DropdownMenuLabel>
          <DropdownMenuRadioItem value={`user:${CURRENT_USER_ASSIGNEE_ID}`}>
            <AssigneeAvatar name={currentUserName} size={16} />
            <span>{currentUserName}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AgentCell({ issue }: { issue: KanbanIssue }) {
  const { t } = useTranslation('kanban')
  const { agents } = useAgents()
  const delegateIssue = useDelegateIssue()
  const undelegateIssue = useUndelegateIssue()
  const agentCandidates = useMemo(() => agents.filter(agent => !!agent.providerTargetId), [agents])
  const delegatedAgent = findDelegatedAgent(issue, agentCandidates)
  const selectedValue = delegatedAgent ? `agent:${delegatedAgent.id}` : ''

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px]',
            'transition-colors hover:bg-fill',
            delegatedAgent ? 'text-foreground' : 'text-muted-foreground',
          )}
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
          <span className="truncate">{delegatedAgent?.name ?? t('agent.none')}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup
          value={selectedValue}
          onValueChange={(value) => {
            if (!value) {
              if (issue.delegateAgentId || issue.delegateAgentProfileId) {
                undelegateIssue.mutate({ issueId: issue.id })
              }
              return
            }

            const [, agentId] = value.split(':', 2)
            const agent = agentCandidates.find(candidate => candidate.id === agentId)
            if (!agent?.providerTargetId) {
              return
            }
            delegateIssue.mutate({ issueId: issue.id, agentId: agent.id, providerTargetId: agent.providerTargetId })
          }}
        >
          <DropdownMenuRadioItem value="">
            <span className="flex size-4 items-center justify-center rounded-full border border-dashed border-muted-foreground/60" aria-hidden="true" />
            <span>{t('agent.none')}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('agent.availableAgents')}</DropdownMenuLabel>
          {agentCandidates.map(agent => (
            <DropdownMenuRadioItem key={agent.id} value={`agent:${agent.id}`}>
              <AgentAvatar
                name={agent.name}
                avatarUrl={agent.avatarUrl}
                avatarStyle={agent.avatarStyle}
                avatarSeed={agent.avatarSeed}
                size={16}
              />
              <span className="truncate">{agent.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LabelsCell({ issue, workspaceIssues }: { issue: KanbanIssue, workspaceIssues: KanbanIssue[] }) {
  const { t } = useTranslation('kanban')
  const updateIssue = useUpdateIssue()
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedLabelKeys = useMemo(() => new Set(issue.labels.map(normalizeLabelForCompare)), [issue.labels])
  const workspaceLabelOptions = useMemo(() => collectWorkspaceLabelOptions(workspaceIssues), [workspaceIssues])
  const labelSuggestions = useMemo(
    () => filterWorkspaceLabelOptions(workspaceLabelOptions, inputValue, issue.labels).slice(0, LABEL_SUGGESTION_LIMIT),
    [inputValue, issue.labels, workspaceLabelOptions],
  )
  const trimmedInput = inputValue.trim()
  const canCreateLabel = trimmedInput.length > 0 && !selectedLabelKeys.has(normalizeLabelForCompare(trimmedInput))

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const setLabels = (labels: string[]) => {
    updateIssue.mutate({ id: issue.id, patch: { labels } })
  }

  const addLabel = (label: string) => {
    const trimmed = label.trim()
    if (!trimmed || selectedLabelKeys.has(normalizeLabelForCompare(trimmed))) {
      return
    }
    setLabels([...issue.labels, trimmed])
    setInputValue('')
  }

  const removeLabel = (label: string) => {
    const key = normalizeLabelForCompare(label)
    setLabels(issue.labels.filter(candidate => normalizeLabelForCompare(candidate) !== key))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[13px] text-muted-foreground transition-colors hover:bg-fill hover:text-foreground"
        >
          <TagsIcon className="size-3.5 shrink-0" aria-hidden="true" />
          {issue.labels.length > 0
            ? (
                <span className="flex min-w-0 items-center gap-1">
                  {issue.labels.slice(0, 2).map(label => <LabelChip key={label} label={label} className="max-w-20 truncate" />)}
                  {issue.labels.length > 2 && (
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      +
                      {issue.labels.length - 2}
                    </span>
                  )}
                </span>
              )
            : <span className="truncate">{t('issue.label.empty')}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border p-2">
          <div className="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2">
            <SearchIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              value={inputValue}
              onChange={event => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  const exactSuggestion = labelSuggestions.find(option => normalizeLabelForCompare(option.label) === normalizeLabelForCompare(inputValue))
                  addLabel(exactSuggestion?.label ?? inputValue)
                }
              }}
              placeholder={t('issue.label.inputPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
          </div>
          {issue.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {issue.labels.map(label => (
                <button key={label} type="button" onClick={() => removeLabel(label)} aria-label={t('issue.label.addSuggestionAria', { label })}>
                  <LabelChip label={label} className="cursor-pointer hover:line-through" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {canCreateLabel && (
            <button
              type="button"
              onClick={() => addLabel(inputValue)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-fill"
            >
              <span className="truncate">{trimmedInput}</span>
              <span className="text-[11px] text-muted-foreground">{t('issue.label.create', { label: trimmedInput })}</span>
            </button>
          )}
          {labelSuggestions.map(option => (
            <button
              key={option.label}
              type="button"
              onClick={() => addLabel(option.label)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fill"
            >
              <LabelChip label={option.label} tone={option.tone} className="max-w-40 truncate" />
              <span className="text-[11px] text-muted-foreground tabular-nums">{option.count}</span>
            </button>
          ))}
          {!canCreateLabel && labelSuggestions.length === 0 && (
            <div className="px-2 py-4 text-center text-[12px] text-muted-foreground">{t('issue.label.noMatches')}</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function DueDateCell({ issue }: { issue: KanbanIssue }) {
  const { t } = useTranslation('kanban')
  const updateIssue = useUpdateIssue()
  const selectedDate = toCalendarDate(issue.dueDate)
  const dueDateLabel = formatDate(issue.dueDate)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px]',
            'transition-colors hover:bg-fill',
            selectedDate ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <CalendarIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{dueDateLabel || t('priority.none')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={date => updateIssue.mutate({ id: issue.id, patch: { dueDate: fromCalendarDate(date) } })}
        />
        {selectedDate && (
          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={() => updateIssue.mutate({ id: issue.id, patch: { dueDate: null } })}
              className="w-full rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-fill hover:text-foreground"
            >
              {t('filter.clear')}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function KanbanTableView({
  issues,
  statuses,
  milestones,
  parentIssueRefs,
  displayProperties,
  highlightedIssueId,
  selectedIssueIds,
  onIssueClick,
  onIssueSelectionGesture,
}: KanbanTableProps) {
  const { t } = useTranslation('kanban')
  const { workspaces } = useWorkspaces()
  const { agents } = useAgents()
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const selectedIds = useMemo(() => selectedIssueIds ?? new Set<string>(), [selectedIssueIds])

  const defaultColumnVisibility = useMemo<VisibilityState>(() => ({
    issueKey: displayProperties.id,
    priority: displayProperties.priority,
    status: displayProperties.status,
    labels: displayProperties.labels,
    assignee: displayProperties.assignee,
    agent: displayProperties.agentIndicator,
    milestone: displayProperties.milestone,
    dueDate: displayProperties.dueDate,
  }), [displayProperties])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(defaultColumnVisibility)

  useEffect(() => {
    setColumnVisibility(current => ({ ...current, ...defaultColumnVisibility }))
  }, [defaultColumnVisibility])

  const rows = useMemo<IssueTableRow[]>(() => {
    const statusById = new Map(statuses.map(status => [status.id, status]))
    const milestoneById = new Map(milestones.map(milestone => [milestone.id, milestone]))

    return issues.map((issue) => {
      const status = issue.statusId ? statusById.get(issue.statusId) : null
      const milestone = issue.milestoneId ? milestoneById.get(issue.milestoneId) : null
      const delegatedAgent = findDelegatedAgent(issue, agents)
      const assigneeName = issue.assigneeKind === 'user'
        ? issue.assigneeId === CURRENT_USER_ASSIGNEE_ID
          ? t('assignee.currentUser')
          : issue.assigneeId ?? t('assignee.unknownUser')
        : ''

      return {
        issue,
        issueKey: formatIssueId(issue, workspaces),
        parentKey: parentIssueRefs.get(issue.id)?.key ?? '',
        statusName: status?.name ?? '',
        statusCategory: status?.category as StatusCategory | undefined ?? null,
        statusOrder: status?.order ?? EMPTY_SORT_VALUE,
        priority: issue.priority,
        priorityOrder: PRIORITY_SORT_ORDER[issue.priority] ?? EMPTY_SORT_VALUE,
        labelsText: issue.labels.join(' '),
        labels: issue.labels,
        assigneeName,
        delegatedAgentName: delegatedAgent?.name ?? '',
        delegatedAgentAvatarUrl: delegatedAgent?.avatarUrl ?? null,
        delegatedAgentAvatarStyle: delegatedAgent?.avatarStyle ?? null,
        delegatedAgentAvatarSeed: delegatedAgent?.avatarSeed ?? null,
        milestoneTitle: milestone?.title ?? '',
        dueDate: issue.dueDate,
        updatedAt: issue.updatedAt,
      }
    })
  }, [agents, issues, milestones, parentIssueRefs, statuses, t, workspaces])

  const columns = useMemo<ColumnDef<IssueTableRow>[]>(() => [
    {
      id: 'selected',
      header: '',
      size: 36,
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => {
        const selected = selectedIds.has(row.original.issue.id)
        return (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onIssueSelectionGesture?.(row.original.issue.id, 'toggle')
            }}
            className={cn(
              'flex size-4 items-center justify-center rounded border',
              'transition-[opacity,background-color,border-color] duration-150 ease-out',
              selected ? 'border-primary bg-primary/10 opacity-100' : 'border-border bg-background opacity-0 group-hover/table-row:opacity-100',
            )}
            aria-label={selected ? t('selection.clearAria') : t('table.selectIssueAria')}
          >
            {selected && <CheckIcon className="size-3" />}
          </button>
        )
      },
    },
    {
      id: 'issueKey',
      accessorKey: 'issueKey',
      header: t('display.id'),
      size: 118,
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onIssueClick(row.original.issue.id)}
            className="shrink-0 rounded px-1 font-mono text-[11px] text-muted-foreground tabular-nums transition-colors hover:bg-fill hover:text-foreground"
          >
            {row.original.issueKey}
          </button>
          {row.original.parentKey && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{row.original.parentKey}</span>
          )}
        </div>
      ),
    },
    {
      id: 'title',
      accessorFn: row => row.issue.title,
      header: t('table.title'),
      size: 360,
      enableHiding: false,
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => onIssueClick(row.original.issue.id)}
          className="block max-w-[460px] truncate rounded px-1 text-left text-foreground transition-colors hover:bg-fill"
        >
          {row.original.issue.title}
        </button>
      ),
    },
    {
      id: 'priority',
      accessorKey: 'priority',
      header: t('display.priority'),
      size: 82,
      sortingFn: (left, right) => left.original.priorityOrder - right.original.priorityOrder,
      cell: ({ row }) => <PriorityIcon priority={row.original.priority} size={14} />,
    },
    {
      id: 'status',
      accessorKey: 'statusName',
      header: t('display.status'),
      size: 148,
      sortingFn: (left, right) => {
        const order = left.original.statusOrder - right.original.statusOrder
        return order === 0 ? left.original.statusName.localeCompare(right.original.statusName) : order
      },
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          {row.original.statusCategory && <StatusIcon category={row.original.statusCategory} size={14} />}
          <span className="truncate">{row.original.statusName}</span>
        </div>
      ),
    },
    {
      id: 'assignee',
      accessorKey: 'assigneeName',
      header: t('display.assignee'),
      size: 132,
      cell: ({ row }) => <AssigneeCell issue={row.original.issue} />,
    },
    {
      id: 'agent',
      accessorKey: 'delegatedAgentName',
      header: t('property.agent'),
      size: 148,
      cell: ({ row }) => <AgentCell issue={row.original.issue} />,
    },
    {
      id: 'labels',
      accessorKey: 'labelsText',
      header: t('display.labels'),
      size: 190,
      cell: ({ row }) => <LabelsCell issue={row.original.issue} workspaceIssues={issues} />,
    },
    {
      id: 'milestone',
      accessorKey: 'milestoneTitle',
      header: t('display.milestone'),
      size: 154,
      cell: ({ row }) => <span className="block max-w-36 truncate text-muted-foreground">{row.original.milestoneTitle}</span>,
    },
    {
      id: 'dueDate',
      accessorKey: 'dueDate',
      header: t('display.dueDate'),
      size: 118,
      sortingFn: (left, right) => (left.original.dueDate ?? EMPTY_SORT_VALUE) - (right.original.dueDate ?? EMPTY_SORT_VALUE),
      cell: ({ row }) => <DueDateCell issue={row.original.issue} />,
    },
    {
      id: 'updatedAt',
      accessorKey: 'updatedAt',
      header: t('sort.updated'),
      size: 92,
      cell: ({ row }) => (
        <span className="block text-right text-[11px] text-muted-foreground tabular-nums">
          {formatDateTime(row.original.updatedAt)}
        </span>
      ),
    },
  ], [issues, onIssueClick, onIssueSelectionGesture, selectedIds, t])

  const rowSelection = useMemo(() => {
    return Object.fromEntries(Array.from(selectedIds, id => [id, true]))
  }, [selectedIds])

  // TanStack Table exposes imperative helpers; keep the instance local to this view.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting,
      globalFilter,
      columnVisibility,
      rowSelection,
    },
    getRowId: row => row.issue.id,
    enableRowSelection: true,
    enableMultiSort: true,
    maxMultiSortColCount: 5,
    isMultiSortEvent: () => true,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <div className="flex-1 overflow-hidden px-3 py-2">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card/95 px-2.5 py-2">
          <div className="relative w-full max-w-72">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={globalFilter}
              onChange={event => setGlobalFilter(event.target.value)}
              placeholder={t('filter.aria')}
              className="h-7 rounded-md pl-7 text-[13px]"
            />
          </div>
          <div className="hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex">
            <span className="tabular-nums">
              {t('table.issueCount', { count: table.getFilteredRowModel().rows.length })}
            </span>
            {selectedIds.size > 0 && (
              <>
                <span className="text-border">/</span>
                <span className="tabular-nums text-foreground">{selectedIds.size}</span>
                <span>{t('selection.selected')}</span>
              </>
            )}
          </div>
          {sorting.length > 0 && (
            <button
              type="button"
              onClick={() => setSorting([])}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t('sort.aria')}
            >
              <XIcon className="size-3.5" aria-hidden="true" />
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t('display.aria')}
              >
                <Columns3Icon className="size-3.5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{t('display.aria')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table.getAllLeafColumns().filter(column => column.getCanHide()).map(column => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={value => column.toggleVisibility(!!value)}
                >
                  {typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="min-w-[1240px] table-fixed">
            <TableHeader className="sticky top-0 z-10 bg-muted/35 backdrop-blur">
              {table.getHeaderGroups().map(headerGroup => (
                <TableRow key={headerGroup.id} className="border-border/80 hover:bg-transparent">
                  {headerGroup.headers.map(header => (
                    <TableHead
                      key={header.id}
                      style={{ width: header.getSize() }}
                      className="h-8 border-r border-border/50 px-2 text-[10px] uppercase text-muted-foreground last:border-r-0"
                    >
                      {header.isPlaceholder
                        ? null
                        : (
                            <button
                              type="button"
                              onClick={() => header.column.toggleSorting(undefined, true)}
                              disabled={!header.column.getCanSort()}
                              className={cn(
                                'flex min-w-0 items-center gap-1 text-left tracking-normal',
                                header.column.getCanSort() ? 'cursor-pointer hover:text-foreground' : 'cursor-default',
                              )}
                            >
                              <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                              {header.column.getCanSort() && <SortIndicator sorted={header.column.getIsSorted()} sortIndex={header.column.getSortIndex()} />}
                            </button>
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0
                ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center text-[13px] text-muted-foreground">
                        {t('table.empty')}
                      </TableCell>
                    </TableRow>
                  )
                : table.getRowModel().rows.map(row => (
                    <IssueContextMenu
                      key={row.id}
                      issue={row.original.issue}
                      statuses={statuses}
                      milestones={milestones}
                      onOpen={() => onIssueClick(row.original.issue.id)}
                    >
                        <TableRow
                          data-state={selectedIds.has(row.original.issue.id) ? 'selected' : undefined}
                          className={cn(
                          'group/table-row border-border/60 outline-none',
                          'hover:bg-muted/45 data-[state=selected]:bg-primary/10',
                          row.original.issue.id === highlightedIssueId && 'bg-muted',
                        )}
                        >
                        {row.getVisibleCells().map(cell => (
                          <TableCell
                            key={cell.id}
                            style={{ width: cell.column.getSize() }}
                            className="h-10 max-w-64 overflow-hidden border-r border-border/35 px-2 text-[13px] last:border-r-0"
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                        </TableRow>
                    </IssueContextMenu>
                  ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

export const KanbanTable = memo(KanbanTableView)
