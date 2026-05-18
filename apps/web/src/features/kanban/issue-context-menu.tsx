// Input: Kanban issue metadata, menu trigger content, and navigation callback
// Output: Shared context menu for issue cards and list rows
// Position: Kanban-owned issue actions surface used by board and list item renderers

import {
  BotIcon,
  CheckIcon,
  CircleDashedIcon,
  ClipboardIcon,
  CopyIcon,
  ExternalLinkIcon,
  FlagIcon,
  MilestoneIcon,
  Trash2Icon,
  UserRoundXIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '~/components/ui/context-menu'
import { toastManager } from '~/components/ui/toast'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/lib/types'

import { formatIssueId } from './shared/format-issue-id'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import type { IssuePriority } from './use-kanban'
import { useDelegateIssue, useDeleteIssue, useUndelegateIssue, useUpdateIssue } from './use-kanban'
import type { StatusCategory } from './use-view-config'

interface IssueContextMenuProps {
  issue: KanbanIssue
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  onOpen: () => void
  children: ReactNode
}

const priorityOptions: Array<{ value: IssuePriority, label: string }> = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' },
]

function statusCategory(status: KanbanStatus): StatusCategory {
  return status.category as StatusCategory
}

function copyText(value: string, successTitle: string) {
  void navigator.clipboard.writeText(value).then(
    () => toastManager.add({ type: 'success', title: successTitle }),
    () => toastManager.add({ type: 'error', title: 'Copy failed' }),
  )
}

export function IssueContextMenu({ issue, statuses, milestones, onOpen, children }: IssueContextMenuProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const { workspaces } = useWorkspaces()
  const { agents } = useAgents()
  const updateIssue = useUpdateIssue()
  const delegateIssue = useDelegateIssue()
  const deleteIssue = useDeleteIssue()
  const undelegateIssue = useUndelegateIssue()
  const issueKey = formatIssueId(issue, workspaces)
  const delegateAgents = agents.filter(agent => !!agent.agentProfileId)
  const delegatedAgent = issue.delegateAgentProfileId
    ? delegateAgents.find(agent => agent.agentProfileId === issue.delegateAgentProfileId) ?? null
    : null

  const isMutating = updateIssue.isPending || delegateIssue.isPending || deleteIssue.isPending || undelegateIssue.isPending
  const currentStatusValue = issue.statusId ?? ''
  const currentMilestoneValue = issue.milestoneId ?? ''

  const handleDelete = () => {
    setDeleteDialogOpen(false)
    deleteIssue.mutate(issue.id)
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          <ContextMenuLabel className="truncate">
            {issueKey}
          </ContextMenuLabel>
          <ContextMenuItem onSelect={onOpen}>
            <ExternalLinkIcon className="size-4" />
            Open issue
          </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={() => copyText(issueKey, 'Issue key copied')}>
          <CopyIcon className="size-4" />
          Copy issue key
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(issue.title, 'Issue title copied')}>
          <ClipboardIcon className="size-4" />
          Copy title
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(issue.id, 'Issue ID copied')}>
          <ClipboardIcon className="size-4" />
          Copy issue ID
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={isMutating || statuses.length === 0}>
            <CircleDashedIcon className="size-4" />
            Status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuRadioGroup
              value={currentStatusValue}
              onValueChange={statusId => updateIssue.mutate({ id: issue.id, patch: { statusId: statusId || null } })}
            >
              {statuses.map(status => (
                <ContextMenuRadioItem key={status.id} value={status.id} disabled={isMutating}>
                  <StatusIcon category={statusCategory(status)} size={14} />
                  <span className="truncate">{status.name}</span>
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={isMutating}>
            <FlagIcon className="size-4" />
            Priority
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            <ContextMenuRadioGroup
              value={issue.priority}
              onValueChange={priority => updateIssue.mutate({ id: issue.id, patch: { priority: priority as IssuePriority } })}
            >
              {priorityOptions.map(priority => (
                <ContextMenuRadioItem key={priority.value} value={priority.value} disabled={isMutating}>
                  <PriorityIcon priority={priority.value} size={14} />
                  {priority.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={isMutating}>
            <MilestoneIcon className="size-4" />
            Milestone
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuRadioGroup
              value={currentMilestoneValue}
              onValueChange={milestoneId => updateIssue.mutate({ id: issue.id, patch: { milestoneId: milestoneId || null } })}
            >
              <ContextMenuRadioItem value="" disabled={isMutating}>
                <CircleDashedIcon className="size-4" />
                No milestone
              </ContextMenuRadioItem>
              {milestones.length > 0 && <ContextMenuSeparator />}
              {milestones.map(milestone => (
                <ContextMenuRadioItem key={milestone.id} value={milestone.id} disabled={isMutating}>
                  <MilestoneIcon className="size-4" />
                  <span className="truncate">{milestone.title}</span>
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={isMutating}>
            <BotIcon className="size-4" />
            Agent
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            {delegatedAgent && (
              <>
                <ContextMenuLabel className="truncate">
                  <span>Assigned to </span>
                  <span>{delegatedAgent.name}</span>
                </ContextMenuLabel>
                <ContextMenuItem disabled={isMutating} onSelect={() => undelegateIssue.mutate({ issueId: issue.id })}>
                  <CircleDashedIcon className="size-4" />
                  Unassigned
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            {delegateAgents.length === 0
              ? (
                  <ContextMenuItem disabled>
                    <BotIcon className="size-4" />
                    No agents configured
                  </ContextMenuItem>
                )
              : delegateAgents.map(agent => (
                  <ContextMenuItem
                    key={agent.id}
                    disabled={isMutating || agent.agentProfileId === issue.delegateAgentProfileId}
                    onSelect={() => delegateIssue.mutate({
                      issueId: issue.id,
                      agentProfileId: agent.agentProfileId!,
                      agentId: agent.id,
                    })}
                  >
                    <BotIcon className="size-4" />
                    <span className="truncate">{agent.name}</span>
                  </ContextMenuItem>
                ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {issue.assigneeId && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={isMutating}
              onSelect={() => updateIssue.mutate({ id: issue.id, patch: { assigneeId: null, assigneeKind: null } })}
            >
              <UserRoundXIcon className="size-4" />
              Clear assignee
            </ContextMenuItem>
          </>
        )}

        <ContextMenuSeparator />

          <ContextMenuItem disabled={isMutating} variant="destructive" onSelect={() => setDeleteDialogOpen(true)}>
            <Trash2Icon className="size-4" />
            Delete issue
          </ContextMenuItem>
          {isMutating && (
            <ContextMenuItem disabled>
              <CheckIcon className="size-4" />
              Applying changes
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2Icon className="size-5 text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>
              Delete issue
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span>Delete </span>
              <span>{issueKey}</span>
              <span>? This cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
