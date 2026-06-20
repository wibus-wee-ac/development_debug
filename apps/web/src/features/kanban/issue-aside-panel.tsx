import {
  AlertLine as AlertCircleIcon,
  ArrowRightUpLine as ArrowUpRightIcon,
  DotCircleLine as CircleDotIcon,
  LinkLine as LinkIcon,
  Message3Line as MessageSquareTextIcon,
  SearchLine as SearchIcon,
  UnlinkLine as UnlinkIcon
} from '~/components/ui/mingcute-icons'
import { AnimatePresence, m } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from '~/components/ui/combobox'
import { Skeleton } from '~/components/ui/skeleton'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import type { KanbanIssue, KanbanStatus } from '~/features/kanban/types'
import { openKanbanBoard } from '~/navigation/navigation-commands'

import { formatIssueId } from './shared/format-issue-id'
import { LabelChip } from './shared/label-chip'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import { useBoards, useComments, useIssue, useIssues, useLinkedIssue, useLinkIssue, useStatuses, useUnlinkIssue } from './use-kanban'
import type { IssuePriority } from './use-kanban'
import type { StatusCategory } from './use-view-config'

interface IssueAsidePanelProps {
  sessionId: string
  workspaceId: string | null
}

const priorityLabelKeys: Record<IssuePriority, 'priority.none' | 'priority.low' | 'priority.medium' | 'priority.high' | 'priority.urgent'> = {
  none: 'priority.none',
  low: 'priority.low',
  medium: 'priority.medium',
  high: 'priority.high',
  urgent: 'priority.urgent',
}

const issueUpdatedAtFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const ENTER_SPRING = {
  type: 'spring',
  stiffness: 560,
  damping: 38,
  mass: 0.8,
} as const

const PICKER_SPRING = {
  type: 'spring',
  stiffness: 600,
  damping: 40,
  mass: 0.7,
} as const

function formatTime(value: number | null | undefined, unknownLabel: string): string {
  if (!value) {
    return unknownLabel
  }
  return issueUpdatedAtFormatter.format(new Date(value * 1000))
}

function statusForIssue(statuses: KanbanStatus[], issue: KanbanIssue): KanbanStatus | null {
  return issue.statusId
    ? statuses.find(status => status.id === issue.statusId) ?? null
    : null
}

function findStatus(statuses: KanbanStatus[], issue: KanbanIssue | undefined): KanbanStatus | null {
  if (!issue?.statusId) {
    return null
  }
  return statuses.find(status => status.id === issue.statusId) ?? null
}

export function IssueAsidePanel({ sessionId, workspaceId }: IssueAsidePanelProps) {
  const { t } = useTranslation('kanban')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { workspaces, ready: workspacesReady } = useWorkspaces()

  const linkedIssue = useLinkedIssue(sessionId)
  const linkedIssueId = linkedIssue.data?.issueId ?? null
  const issue = useIssue(linkedIssueId ?? '')
  const statuses = useStatuses(workspaceId ?? '')
  const comments = useComments(linkedIssueId ?? '')
  const boards = useBoards(workspaceId ?? undefined)
  const issues = useIssues({ workspaceId: workspaceId ?? '' })
  const linkIssue = useLinkIssue()
  const unlinkIssue = useUnlinkIssue()

  const selectedIssue = issue.data
  const statusRows = statuses.data ?? []
  const status = findStatus(statusRows, selectedIssue)
  const boardId = boards.data?.[0]?.id
  const linkedIssueReady = linkedIssue.isSuccess
  const linkedIssueDataReady = !linkedIssueId || (issue.isSuccess && comments.isSuccess)
  const pickerDataReady = issues.isSuccess && statuses.isSuccess && boards.isSuccess
  const ready = !!workspaceId && workspacesReady && linkedIssueReady && linkedIssueDataReady && pickerDataReady
  const candidateIssues = (() => {
    const needle = query.trim().toLowerCase()
    const rows = issues.data ?? []
    if (!needle) {
      return rows.slice(0, 6)
    }
    return rows
      .filter((row) => {
        const readableId = formatIssueId(row, workspaces).toLowerCase()
        return row.title.toLowerCase().includes(needle) || readableId.includes(needle)
      })
      .slice(0, 6)
  })()

  const isInitialLoading = linkedIssue.isLoading || (linkedIssueId && issue.isLoading)
  const isPickerLoading = issues.isLoading || boards.isLoading

  const openIssue = () => {
    if (!selectedIssue || !boardId) {
      return
    }
    openKanbanBoard({ boardId, issueId: selectedIssue.id })
  }

  const linkCandidate = (issueId: string) => {
    linkIssue.mutate(
      { chatSessionId: sessionId, issueId },
      {
        onSuccess: () => {
          setPickerOpen(false)
          setQuery('')
        },
      },
    )
  }

  if (!workspaceId) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
        data-testid="right-aside-issue-panel"
        data-right-aside-issue-ready="false"
      >
        <CircleDotIcon className="size-7 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{t('aside.empty.title')}</p>
          <p className="text-xs leading-5 text-muted-foreground">{t('aside.empty.description')}</p>
        </div>
      </div>
    )
  }

  if (isInitialLoading) {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-issue-panel"
        data-right-aside-issue-ready="false"
      >
        <IssueAsideSkeleton />
      </div>
    )
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="right-aside-issue-panel"
      data-right-aside-issue-ready={ready ? 'true' : 'false'}
    >
      <AnimatePresence mode="wait" initial={false}>
        {selectedIssue
          ? (
              <m.div
                key="linked"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={ENTER_SPRING}
                className="flex flex-1 flex-col overflow-hidden"
              >
                <LinkedIssueHeader
                  issue={selectedIssue}
                  status={status}
                  workspaces={workspaces}
                  unlinkPending={unlinkIssue.isPending}
                  onUnlink={() => unlinkIssue.mutate(sessionId)}
                  onOpenIssue={openIssue}
                  canOpen={!!boardId}
                />
                <LinkedIssueBody
                  issue={selectedIssue}
                  status={status}
                  commentCount={comments.data?.length ?? 0}
                  linkError={linkIssue.isError || unlinkIssue.isError}
                />
              </m.div>
            )
          : (
              <m.div
                key="empty"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={ENTER_SPRING}
                className="flex flex-1 flex-col overflow-hidden"
              >
                <EmptyIssueState
                  pickerOpen={pickerOpen}
                  setPickerOpen={setPickerOpen}
                  query={query}
                  setQuery={setQuery}
                  issues={candidateIssues}
                  workspaces={workspaces}
                  statuses={statusRows}
                  isLoading={isPickerLoading}
                  isLinking={linkIssue.isPending}
                  onLink={linkCandidate}
                />
              </m.div>
            )}
      </AnimatePresence>
    </div>
  )
}

// Header: ID + status pill on the left, actions on the right. The persistent
// context strip — always answers "which issue, what state" at a glance.
function LinkedIssueHeader({
  issue,
  status,
  workspaces,
  unlinkPending,
  onUnlink,
  onOpenIssue,
  canOpen,
}: {
  issue: KanbanIssue
  status: KanbanStatus | null
  workspaces: ReturnType<typeof useWorkspaces>['workspaces']
  unlinkPending: boolean
  onUnlink: () => void
  onOpenIssue: () => void
  canOpen: boolean
}) {
  const { t } = useTranslation('kanban')
  const category = (status?.category ?? 'unstarted') as StatusCategory
  const readableId = formatIssueId(issue, workspaces)

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
        <StatusIcon category={category} size={13} aria-hidden="true" />
        <span className="shrink-0 font-mono tabular-nums text-foreground/80">{readableId}</span>
        <span className="truncate">{status?.name ?? t('aside.noStatus')}</span>
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('aside.openInBoardAria')}
          disabled={!canOpen}
          onClick={onOpenIssue}
        >
          <ArrowUpRightIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('aside.unlinkAria')}
          disabled={unlinkPending}
          onClick={onUnlink}
        >
          <UnlinkIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

// Body: title + description lead, then a list of label/value property rows
// that fill the aside width. No box-wrap — rows carry the structure, matching
// the issue-detail properties sidebar.
function LinkedIssueBody({
  issue,
  status,
  commentCount,
  linkError,
}: {
  issue: KanbanIssue
  status: KanbanStatus | null
  commentCount: number
  linkError: boolean
}) {
  const { t } = useTranslation('kanban')
  const labels = issue.labels
  const category = (status?.category ?? 'unstarted') as StatusCategory
  const priorityKey = priorityLabelKeys[issue.priority] ?? 'priority.none'
  const hasPriority = issue.priority !== 'none'

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="space-y-2">
        <h2 className="text-pretty text-[13px] font-semibold leading-5 text-foreground">{issue.title}</h2>
        {issue.description && (
          <p className="line-clamp-4 whitespace-pre-wrap text-pretty text-[12px] leading-5 text-muted-foreground">
            {issue.description}
          </p>
        )}
      </div>

      <dl className="divide-y divide-border/60">
        <PropertyRow label={t('property.status')}>
          <span className="inline-flex items-center gap-1.5">
            <StatusIcon category={category} size={13} aria-hidden="true" />
            <span>{status?.name ?? t('aside.noStatus')}</span>
          </span>
        </PropertyRow>
        <PropertyRow label={t('property.priority')}>
          {hasPriority
            ? (
                <span className="inline-flex items-center gap-1.5">
                  <PriorityIcon priority={issue.priority} size={13} aria-hidden="true" />
                  <span>{t(priorityKey)}</span>
                </span>
              )
            : <span className="text-muted-foreground/70">{t('priority.none')}</span>}
        </PropertyRow>
        <PropertyRow label={t('aside.metric.comments')}>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <MessageSquareTextIcon className="size-3 text-muted-foreground/70" aria-hidden="true" />
            {commentCount}
          </span>
        </PropertyRow>
        <PropertyRow label={t('aside.metric.updated')}>
          <time className="tabular-nums text-muted-foreground">
            {formatTime(issue.updatedAt, t('aside.metric.unknown'))}
          </time>
        </PropertyRow>
      </dl>

      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {labels.map(label => <LabelChip key={label} label={label} />)}
        </div>
      )}

      {linkError && <IssuePanelError message={t('aside.error.linkFailed')} />}
    </div>
  )
}

function PropertyRow({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <dt className="shrink-0 text-[11px] text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end text-[12px] text-foreground">{children}</dd>
    </div>
  )
}

function EmptyIssueState({
  pickerOpen,
  setPickerOpen,
  query,
  setQuery,
  issues,
  workspaces,
  statuses,
  isLoading,
  isLinking,
  onLink,
}: {
  pickerOpen: boolean
  setPickerOpen: (open: boolean) => void
  query: string
  setQuery: (value: string) => void
  issues: KanbanIssue[]
  workspaces: ReturnType<typeof useWorkspaces>['workspaces']
  statuses: KanbanStatus[]
  isLoading: boolean
  isLinking: boolean
  onLink: (issueId: string) => void
}) {
  const { t } = useTranslation('kanban')
  const selectIssue = (issueId: string | null) => {
    if (!issueId) {
      return
    }
    onLink(issueId)
  }

  return (
    <div className="flex flex-1 flex-col">
      <AnimatePresence mode="wait" initial={false}>
        {!pickerOpen
          ? (
              <m.div
                key="empty"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={ENTER_SPRING}
                className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center"
              >
                <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
                  <LinkIcon className="size-4" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{t('aside.empty.title')}</p>
                  <p className="max-w-56 text-pretty text-xs leading-5 text-muted-foreground">{t('aside.empty.description')}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                  <LinkIcon aria-hidden="true" />
                  {t('aside.empty.linkAction')}
                </Button>
              </m.div>
            )
          : (
              <m.div
                key="picker"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={PICKER_SPRING}
                className="flex flex-1 flex-col p-3"
              >
                <IssuePicker
                  query={query}
                  setQuery={setQuery}
                  setPickerOpen={setPickerOpen}
                  issues={issues}
                  workspaces={workspaces}
                  statuses={statuses}
                  isLoading={isLoading}
                  isLinking={isLinking}
                  onLink={selectIssue}
                />
              </m.div>
            )}
      </AnimatePresence>
    </div>
  )
}

function IssuePicker({
  query,
  setQuery,
  setPickerOpen,
  issues,
  workspaces,
  statuses,
  isLoading,
  isLinking,
  onLink,
}: {
  query: string
  setQuery: (value: string) => void
  setPickerOpen: (open: boolean) => void
  issues: KanbanIssue[]
  workspaces: ReturnType<typeof useWorkspaces>['workspaces']
  statuses: KanbanStatus[]
  isLoading: boolean
  isLinking: boolean
  onLink: (issueId: string | null) => void
}) {
  const { t } = useTranslation('kanban')

  return (
    <Combobox
      open
      value={null}
      inputValue={query}
      onOpenChange={setPickerOpen}
      onInputValueChange={setQuery}
      onValueChange={onLink}
      modal={false}
      autoHighlight
    >
      <ComboboxInput
        autoFocus
        aria-label={t('aside.picker.searchPlaceholder')}
        placeholder={t('aside.picker.searchPlaceholder')}
        showClear
        showTrigger
        startAddon={<SearchIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />}
        className="w-full"
      />
      <ComboboxContent align="start" sideOffset={6} className="w-88 min-w-72 p-1.5">
        <ComboboxList className="max-h-72 p-0.5">
          {isLoading && <Skeleton className="h-11 w-full" />}
          {!isLoading && issues.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">{t('aside.picker.noResults')}</div>
          )}
          {!isLoading && issues.map(issue => (
            <IssueComboboxItem
              key={issue.id}
              issue={issue}
              status={statusForIssue(statuses, issue)}
              workspaces={workspaces}
              disabled={isLinking}
            />
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function IssueComboboxItem({
  issue,
  status,
  workspaces,
  disabled,
}: {
  issue: KanbanIssue
  status: KanbanStatus | null
  workspaces: ReturnType<typeof useWorkspaces>['workspaces']
  disabled: boolean
}) {
  const { t } = useTranslation('kanban')
  const labels = issue.labels
  const category = (status?.category ?? 'unstarted') as StatusCategory
  const readableId = formatIssueId(issue, workspaces)
  const priorityKey = priorityLabelKeys[issue.priority] ?? 'priority.none'

  return (
    <ComboboxItem
      value={issue.id}
      disabled={disabled}
      className={cn(
        'min-h-14 cursor-default items-start gap-2 rounded-lg px-2 py-2 pr-7',
        'transition-[background-color,color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]',
      )}
    >
      <span
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background"
        title={status?.name ?? t('aside.noStatus')}
        aria-label={status?.name ?? t('aside.noStatus')}
      >
        <StatusIcon category={category} size={14} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{readableId}</span>
          <span className="min-w-0 truncate text-xs font-medium text-foreground">{issue.title}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {issue.priority !== 'none' && (
            <span className="inline-flex h-5 items-center gap-1 rounded-md border border-border bg-background px-1.5 text-[10.5px] text-muted-foreground">
              <PriorityIcon priority={issue.priority} size={12} />
              {t(priorityKey)}
            </span>
          )}
          {labels.slice(0, 2).map(label => <LabelChip key={label} label={label} />)}
          {labels.length > 2 && (
            <span className="text-[10.5px] tabular-nums text-muted-foreground">
              +
              {labels.length - 2}
            </span>
          )}
        </span>
      </span>
    </ComboboxItem>
  )
}

function IssuePanelError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <AlertCircleIcon className="size-4 shrink-0" aria-hidden="true" />
      {message}
    </div>
  )
}

function IssueAsideSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-3">
      <Skeleton className="h-8 w-2/3 rounded-md" />
      <Skeleton className="h-16 w-full rounded-md" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-3/4" />
    </div>
  )
}
