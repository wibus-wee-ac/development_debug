import { Link } from '@cradle/tabs-next'
import { ExternalLinkIcon, SquareIcon } from 'lucide-react'
import { memo, useCallback, useMemo } from 'react'

import { cn } from '~/lib/utils'
import type { AgentActivity, AgentSession } from '~/lib/types'

import { useAgentActivities, useAgentSessions, useStartAgentSession, useStopAgentSession } from '../use-kanban'
import { AgentActivityItem } from './agent-activity-item'
import { AgentPromptInput } from './agent-prompt-input'

interface AgentSessionPanelProps {
  issueId: string
  workspaceId: string
}

const statusConfig: Record<string, { label: string, dotClass: string }> = {
  created: { label: 'Pending', dotClass: 'bg-yellow-400' },
  active: { label: 'Active', dotClass: 'bg-green-400 animate-pulse' },
  completed: { label: 'Done', dotClass: 'bg-green-400' },
  stopped: { label: 'Stopped', dotClass: 'bg-muted-foreground/50' },
  failed: { label: 'Failed', dotClass: 'bg-red-400' },
}

export const AgentSessionPanel = memo(function AgentSessionPanel({ issueId, workspaceId }: AgentSessionPanelProps) {
  const { data: sessions = [] } = useAgentSessions(issueId)

  const activeSession = useMemo(() => {
    // Prefer active/created, else take latest
    const running = sessions.find(s => s.status === 'active' || s.status === 'created')
    if (running) {
      return running
    }
    return sessions.length > 0 ? sessions.at(-1) : null
  }, [sessions])

  const isPolling = activeSession?.status === 'active' || activeSession?.status === 'created'
  const { data: activities = [] } = useAgentActivities(
    activeSession?.id ?? null,
    { refetchInterval: isPolling ? 500 : false },
  )

  if (!activeSession) {
    return null
  }

  return (
    <ActiveAgentSessionPanel
      activeSession={activeSession}
      activities={activities}
      issueId={issueId}
      workspaceId={workspaceId}
    />
  )
})

const ActiveAgentSessionPanel = memo(function ActiveAgentSessionPanel({
  activeSession,
  activities,
  issueId,
  workspaceId,
}: {
  activeSession: AgentSession
  activities: AgentActivity[]
  issueId: string
  workspaceId: string
}) {
  const stopSession = useStopAgentSession()
  const startSession = useStartAgentSession()
  const status = activeSession.status ?? 'created'
  const config = statusConfig[status] ?? statusConfig.created

  const canStop = status === 'active' || status === 'created'
  const canRerun = status === 'completed' || status === 'stopped' || status === 'failed'

  const handleStop = useCallback(() => {
    stopSession.mutate({ agentSessionId: activeSession.id, issueId })
  }, [activeSession.id, issueId, stopSession])

  const handleRerun = useCallback(() => {
    startSession.mutate({
      agentSessionId: activeSession.id,
      issueId,
      workspaceId,
    })
  }, [activeSession.id, issueId, startSession, workspaceId])

  return (
    <div className="rounded-lg border border-border bg-card shadow-xs" data-testid="issue-agent-session">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-medium text-muted-foreground">Agent Session</span>
          <span className="flex items-center gap-1.5" data-testid="issue-agent-session-phase">
            <span className={cn('size-1.5 rounded-full', config.dotClass)} />
            <span className="text-text-tertiary">{config.label}</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          {canStop && (
            <button
              type="button"
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[12px] text-text-tertiary transition-colors hover:bg-fill hover:text-foreground"
              onClick={handleStop}
            >
              <SquareIcon className="size-3" aria-hidden="true" />
              Stop
            </button>
          )}
          {canRerun && (
            <button
              type="button"
              className="rounded px-2 py-0.5 text-[12px] text-text-tertiary transition-colors hover:bg-fill hover:text-foreground"
              data-testid="issue-agent-rerun-btn"
              onClick={handleRerun}
            >
              Rerun
            </button>
          )}
          {activeSession.chatSessionId && (
            <Link
              to="chat"
              params={{ sessionId: activeSession.chatSessionId! }}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[12px] text-text-tertiary transition-colors hover:bg-fill hover:text-foreground"
              data-testid="issue-agent-session-open-chat"
            >
              <ExternalLinkIcon className="size-3" aria-hidden="true" />
              Open Chat
            </Link>
          )}
        </div>
      </div>

      {/* Activity feed */}
      {activities.length > 0 && (
        <div className="max-h-80 overflow-y-auto border-t border-border">
          {activities.map(activity => (
            <AgentActivityItem key={activity.id} activity={activity} />
          ))}
        </div>
      )}

      {/* Prompt input */}
      <AgentPromptInput
        agentSessionId={activeSession.id}
        sessionStatus={status}
        issueId={issueId}
      />
    </div>
  )
})
