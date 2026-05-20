// Input: sessionId, workspaceId, kanban hooks, and tab navigation
// Output: IssueAsidePanel showing the issue linked to the active chat session
// Position: Right aside tab content for chat-to-issue context

import { AlertCircleIcon, ArrowUpRightIcon, CheckCircle2Icon, CircleDotIcon, LinkIcon, MessageSquareTextIcon, SearchIcon, UnlinkIcon } from 'lucide-react'
import { m } from 'motion/react'
import { useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from '~/components/ui/combobox'
import { Skeleton } from '~/components/ui/skeleton'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import type { KanbanIssue, KanbanStatus } from '~/lib/types'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

import { formatIssueId } from './shared/format-issue-id'
import { parseIssueLabels, priorityOptions } from './shared/issue-metadata'
import { LabelChip } from './shared/label-chip'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import { useBoards, useComments, useIssue, useIssues, useLinkIssue, useLinkedIssue, useStatuses, useUnlinkIssue } from './use-kanban'
import type { StatusCategory } from './use-view-config'

interface IssueAsidePanelProps {
  sessionId: string
  workspaceId: string | null
}

const priorityLabels = Object.fromEntries(priorityOptions.map(option => [option.value, option.label]))

function formatTime(value: number | null | undefined): string {
  if (!value) {
    return 'Unknown'
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value * 1000))
}

function findStatus(statuses: KanbanStatus[], issue: KanbanIssue | undefined): KanbanStatus | null {
  if (!issue?.statusId) {
    return null
  }
  return statuses.find(status => status.id === issue.statusId) ?? null
}

function statusForIssue(statuses: KanbanStatus[], issue: KanbanIssue): KanbanStatus | null {
  return issue.statusId
    ? statuses.find(status => status.id === issue.statusId) ?? null
    : null
}

export function IssueAsidePanel({ sessionId, workspaceId }: IssueAsidePanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { openTab } = useCradleNavigation()
  const { workspaces } = useWorkspaces()

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
  const labels = parseIssueLabels(selectedIssue?.labels)
  const boardId = boards.data?.[0]?.id

  const candidateIssues = useMemo(() => {
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
  }, [issues.data, query, workspaces])

  const isInitialLoading = linkedIssue.isLoading || (linkedIssueId && issue.isLoading)
  const isPickerLoading = issues.isLoading || boards.isLoading

  const openIssue = () => {
    if (!selectedIssue || !boardId) {
      return
    }
    openTab('kanban-board', { boardId, issue: selectedIssue.id })
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
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <CircleDotIcon className="size-7 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">No workspace context</p>
          <p className="text-xs leading-5 text-muted-foreground">Issue linking needs a workspace-backed chat session.</p>
        </div>
      </div>
    )
  }

  if (isInitialLoading) {
    return <IssueAsideSkeleton />
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Linked issue</p>
          <p className="truncate text-sm font-medium text-foreground">
            {selectedIssue ? formatIssueId(selectedIssue, workspaces) : 'No issue linked'}
          </p>
        </div>
        {selectedIssue && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Unlink issue"
            disabled={unlinkIssue.isPending}
            onClick={() => unlinkIssue.mutate(sessionId)}
          >
            <UnlinkIcon aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {selectedIssue
          ? (
              <>
                <m.section
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-xs)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <h2 className="text-sm font-semibold leading-5 text-foreground text-pretty">{selectedIssue.title}</h2>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <IssueStatusBadge status={status} />
                        <span className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground">
                          <PriorityIcon priority={selectedIssue.priority} size={13} />
                          {priorityLabels[selectedIssue.priority] ?? selectedIssue.priority}
                        </span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Open issue in Kanban"
                      disabled={!boardId}
                      onClick={openIssue}
                    >
                      <ArrowUpRightIcon aria-hidden="true" />
                    </Button>
                  </div>

                  {selectedIssue.description && (
                    <p className="mt-3 line-clamp-5 whitespace-pre-wrap text-xs leading-5 text-muted-foreground text-pretty">
                      {selectedIssue.description}
                    </p>
                  )}
                </m.section>

                <section className="grid grid-cols-2 gap-2">
                  <IssueMetric icon={MessageSquareTextIcon} label="Comments" value={String(comments.data?.length ?? 0)} />
                  <IssueMetric icon={CheckCircle2Icon} label="Updated" value={formatTime(selectedIssue.updatedAt)} />
                </section>

                {labels.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-xs font-medium text-foreground">Labels</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {labels.map(label => <LabelChip key={label} label={label} />)}
                    </div>
                  </section>
                )}

                {linkIssue.isError || unlinkIssue.isError
                  ? <IssuePanelError message="Issue link update failed." />
                  : null}
              </>
            )
          : (
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
            )}
      </div>
    </div>
  )
}

function IssueStatusBadge({ status }: { status: KanbanStatus | null }) {
  const category = (status?.category ?? 'unstarted') as StatusCategory

  return (
    <span
      className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-background"
      title={status?.name ?? 'No status'}
      aria-label={status?.name ?? 'No status'}
    >
      <StatusIcon category={category} size={14} aria-hidden="true" />
    </span>
  )
}

function IssueMetric({ icon: Icon, label, value }: {
  icon: typeof MessageSquareTextIcon
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-1 truncate text-xs font-medium text-foreground tabular-nums">{value}</p>
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
  const selectIssue = (issueId: string | null) => {
    if (!issueId) {
      return
    }
    onLink(issueId)
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-background">
          <LinkIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">No linked issue</p>
          <p className="max-w-56 text-xs leading-5 text-muted-foreground">Connect this chat to a Kanban issue for fast context switching.</p>
        </div>
        {!pickerOpen && (
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <LinkIcon aria-hidden="true" />
            Link issue
          </Button>
        )}
      </div>

      {pickerOpen && (
        <m.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-lg border border-border bg-card p-2.5 shadow-[var(--shadow-xs)]"
        >
          <Combobox
            open={pickerOpen}
            value={null}
            inputValue={query}
            onOpenChange={setPickerOpen}
            onInputValueChange={setQuery}
            onValueChange={selectIssue}
            modal={false}
            autoHighlight
          >
            <ComboboxInput
              autoFocus
              aria-label="Search issues"
              placeholder="Search issues"
              showClear
              showTrigger
              startAddon={<SearchIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />}
              className="w-full"
            />
            <ComboboxContent align="start" sideOffset={6} className="w-88 min-w-80 p-1.5">
              <ComboboxList className="max-h-72 p-0.5">
                {isLoading && <Skeleton className="h-11 w-full" />}
                {!isLoading && issues.length === 0 && (
                  <div className="px-2 py-6 text-center text-xs text-muted-foreground">No issues found</div>
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
        </m.section>
      )}
    </div>
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
  const labels = parseIssueLabels(issue.labels)
  const category = (status?.category ?? 'unstarted') as StatusCategory
  const readableId = formatIssueId(issue, workspaces)

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
        title={status?.name ?? 'No status'}
        aria-label={status?.name ?? 'No status'}
      >
        <StatusIcon category={category} size={14} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{readableId}</span>
          <span className="min-w-0 truncate text-xs font-medium text-foreground">{issue.title}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {issue.priority !== 'none' && (
            <span className="inline-flex h-5 items-center gap-1 rounded-md border border-border bg-background px-1.5 text-[10.5px] text-muted-foreground">
              <PriorityIcon priority={issue.priority} size={12} />
              {priorityLabels[issue.priority] ?? issue.priority}
            </span>
          )}
          {labels.slice(0, 2).map(label => <LabelChip key={label} label={label} />)}
          {labels.length > 2 && (
            <span className="text-[10.5px] text-muted-foreground tabular-nums">
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
    <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <AlertCircleIcon className="size-4 shrink-0" aria-hidden="true" />
      {message}
    </div>
  )
}

function IssueAsideSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3 px-3 py-3">
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
      <Skeleton className="h-24 w-full" />
    </div>
  )
}
