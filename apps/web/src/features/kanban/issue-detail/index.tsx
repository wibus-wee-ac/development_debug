import { useCallback } from 'react'

import { useDeleteIssue, useIssue, useMilestones, useStatuses, useUpdateIssue } from '../use-kanban'
import { ActivityTimeline } from './activity-timeline'
import { AgentSessionPanel } from './agent-session-panel'
import { IssueDescription } from './issue-description'
import { IssueHeader } from './issue-header'
import { IssueTitle } from './issue-title'
import { PropertiesSidebar } from './properties-sidebar'
import { SubIssuesList } from './sub-issues-list'

interface IssueDetailProps {
  issueId: string
  workspaceId: string
  onBack: () => void
}

export function IssueDetail({ issueId, workspaceId, onBack }: IssueDetailProps) {
  const { data: issue } = useIssue(issueId)
  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const updateIssue = useUpdateIssue()
  const deleteIssue = useDeleteIssue()

  const handleUpdate = useCallback((patch: Parameters<typeof updateIssue.mutate>[0]['patch']) => {
    updateIssue.mutate({ id: issueId, patch })
  }, [issueId, updateIssue])

  const handleDelete = useCallback(() => {
    deleteIssue.mutate(issueId)
    onBack()
  }, [issueId, deleteIssue, onBack])

  if (!issue) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground text-[13px]">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="issue-detail-panel">
      <IssueHeader
        issue={issue}
        status={statuses.find(s => s.id === issue.statusId)}
        onBack={onBack}
        onDelete={handleDelete}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto px-10 py-6">
          <div>
            <IssueTitle issue={issue} onUpdate={handleUpdate} />
            <IssueDescription issue={issue} onUpdate={handleUpdate} />

            <div className="mt-8">
              <SubIssuesList issueId={issueId} workspaceId={workspaceId} statuses={statuses} />
            </div>

            {issue.delegateAgentProfileId && (
              <div className="mt-8">
                <AgentSessionPanel issueId={issueId} workspaceId={workspaceId} />
              </div>
            )}

            <div className="mt-8">
              <ActivityTimeline issueId={issueId} />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-70 shrink-0 overflow-y-auto px-3 py-6">
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
