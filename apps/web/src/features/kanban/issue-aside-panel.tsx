// Input: sessionId prop, useLinkedIssue/useLinkIssue/useUnlinkIssue hooks, useBoards/useIssues hooks, PriorityIcon, StatusIcon
// Output: IssueAsidePanel — shows linked issue info or "Link issue" picker in RightAside
// Position: Tab content in the RightAside component of the chat page

import {
  ArrowUpRightIcon,
  CircleDotIcon,
  LinkIcon,
  LoaderCircleIcon,
  SearchIcon,
  UnlinkIcon,
} from 'lucide-react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

import { PriorityIcon } from './priority-icon'
import { StatusIcon } from './status-icon'
import {
  useBoards,
  useIssues,
  useLinkedIssue,
  useLinkIssue,
  useUnlinkIssue,
} from './use-kanban'

interface IssueAsidePanelProps {
  sessionId: string
  workspaceId: string | null
}

export function IssueAsidePanel({ sessionId, workspaceId }: IssueAsidePanelProps) {
  const { data: linked, isLoading } = useLinkedIssue(sessionId)

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground/40" />
      </div>
    )
  }

  if (linked) {
    return <LinkedIssueView sessionId={sessionId} linked={linked} workspaceId={workspaceId} />
  }

  return <EmptyState sessionId={sessionId} workspaceId={workspaceId} />
}

// ── Linked Issue View ─────────────────────────────────────────────────────────

function LinkedIssueView({
  sessionId,
  linked,
  workspaceId,
}: {
  sessionId: string
  linked: NonNullable<ReturnType<typeof useLinkedIssue>['data']>
  workspaceId: string | null
}) {
  const { openTab } = useCradleNavigation()
  const unlinkMutation = useUnlinkIssue()
  const { data: boards = [] } = useBoards(workspaceId ?? undefined)
  const isManualLink = !linked.agentSession

  const handleOpenInKanban = () => {
    const board = boards[0]
    if (!board) {
      return
    }
    openTab('kanban-board', { boardId: board.id })
  }

  const statusLabel = linked.status?.name ?? 'No status'
  const statusColor = linked.status?.color ?? undefined
  const priorityLabel = linked.issue.priority === 'none' ? '' : linked.issue.priority
  const labels: string[] = JSON.parse(linked.issue.labels || '[]')

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* ── Issue header ─── */}
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={handleOpenInKanban}
          disabled={!boards.length}
          className="group flex items-start gap-2 text-left transition-colors hover:text-foreground"
        >
          <CircleDotIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
          <span className="text-[13px] font-medium text-foreground leading-snug text-pretty">
            {linked.issue.title}
          </span>
          <ArrowUpRightIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      </div>

      {/* ── Properties ─── */}
      <div className="flex flex-col gap-2 text-xs">
        <div className="flex items-center gap-2">
          <StatusIcon color={statusColor} />
          <span className="text-muted-foreground">{statusLabel}</span>
        </div>

        {priorityLabel && (
          <div className="flex items-center gap-2">
            <PriorityIcon priority={linked.issue.priority} />
            <span className="text-muted-foreground capitalize">{priorityLabel}</span>
          </div>
        )}

        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {labels.map(label => (
              <span
                key={label}
                className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>
        )}

        {linked.agentSession && (
          <div className="flex items-center gap-2 pt-1">
            <span
              className={cn(
                'size-1.5 rounded-full',
                linked.agentSession.status === 'active' && 'bg-green-500',
                linked.agentSession.status === 'completed' && 'bg-blue-500',
                linked.agentSession.status === 'failed' && 'bg-red-500',
                linked.agentSession.status === 'stopped' && 'bg-muted-foreground/40',
                linked.agentSession.status === 'created' && 'bg-yellow-500',
              )}
            />
            <span className="text-muted-foreground capitalize">{linked.agentSession.status}</span>
          </div>
        )}
      </div>

      {/* ── Actions ─── */}
      <div className="flex items-center gap-1 pt-1">
        <Button
          variant="outline"
          size="xs"
          onClick={handleOpenInKanban}
          disabled={!boards.length}
        >
          <ArrowUpRightIcon data-icon="inline-start" />
          在看板中打开
        </Button>

        {isManualLink && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => unlinkMutation.mutate(sessionId)}
                disabled={unlinkMutation.isPending}
              >
                <UnlinkIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>解除关联</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

// ── Empty State + Link Issue ──────────────────────────────────────────────────

function EmptyState({
  sessionId,
  workspaceId,
}: {
  sessionId: string
  workspaceId: string | null
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
      <CircleDotIcon className="size-5 text-muted-foreground/20" />
      <p className="text-[11px] text-muted-foreground">未关联 Issue</p>
      {workspaceId && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger>
            <Button variant="outline" size="xs">
              <LinkIcon data-icon="inline-start" />
              关联 Issue
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <IssuePicker
              workspaceId={workspaceId}
              sessionId={sessionId}
              onLinked={() => setOpen(false)}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

// ── Issue Picker ──────────────────────────────────────────────────────────────

function IssuePicker({
  workspaceId,
  sessionId,
  onLinked,
}: {
  workspaceId: string
  sessionId: string
  onLinked: () => void
}) {
  const [search, setSearch] = useState('')
  const { data: issues = [] } = useIssues({ workspaceId })
  const linkMutation = useLinkIssue()

  const filtered = search
    ? issues.filter(i => i.title.toLowerCase().includes(search.toLowerCase()))
    : issues

  const handleSelect = (issueId: string) => {
    linkMutation.mutate(
      { chatSessionId: sessionId, issueId },
      { onSuccess: onLinked },
    )
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索 Issue..."
          className="h-auto border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
          autoFocus
        />
      </div>
      <ScrollArea className="max-h-56">
        <div className="flex flex-col py-1">
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
              未找到匹配的 Issue
            </p>
          )}
          {filtered.map(issue => (
            <button
              key={issue.id}
              type="button"
              onClick={() => handleSelect(issue.id)}
              disabled={linkMutation.isPending}
              className="flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted"
            >
              <PriorityIcon priority={issue.priority} className="shrink-0" />
              <span className="truncate text-foreground">{issue.title}</span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
