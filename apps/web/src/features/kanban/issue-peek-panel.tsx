// Input: issueId, workspaceId, onClose
// Output: Compact peek preview panel for quick issue viewing
// Position: Peek overlay component triggered by Space key in kanban views

import { XIcon } from 'lucide-react'
import { useCallback } from 'react'

import { useWorkspaces } from '~/features/workspace/use-workspace'

import { useIssue, useMilestones, useStatuses, useUpdateIssue } from './use-kanban'
import { formatIssueId } from './shared/format-issue-id'
import { IssueDescription } from './issue-detail/issue-description'
import { IssueTitle } from './issue-detail/issue-title'
import { PropertiesSidebar } from './issue-detail/properties-sidebar'

interface IssuePeekPanelProps {
  issueId: string
  workspaceId: string
  onClose: () => void
}

export function IssuePeekPanel({ issueId, workspaceId, onClose }: IssuePeekPanelProps) {
  const { workspaces } = useWorkspaces()
  const { data: issue, isLoading, isError } = useIssue(issueId)
  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const updateIssue = useUpdateIssue()

  const handleUpdate = useCallback((patch: Parameters<typeof updateIssue.mutate>[0]['patch']) => {
    updateIssue.mutate({ id: issueId, patch })
  }, [issueId, updateIssue])

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-[13px] text-destructive">
        Failed to load issue
      </div>
    )
  }

  if (isLoading || !issue) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
          {formatIssueId(issue, workspaces)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="size-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close peek"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <IssueTitle issue={issue} onUpdate={handleUpdate} />
          <IssueDescription issue={issue} onUpdate={handleUpdate} />
        </div>

        {/* Sidebar */}
        <div className="w-60 shrink-0 overflow-y-auto px-3 py-4 border-l border-border">
          <PropertiesSidebar
            issue={issue}
            statuses={statuses}
            milestones={milestones}
            workspaceId={workspaceId}
            onUpdate={handleUpdate}
          />
        </div>
      </div>
    </div>
  )
}
