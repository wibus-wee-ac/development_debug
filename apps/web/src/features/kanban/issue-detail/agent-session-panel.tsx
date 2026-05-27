import { Link } from '@cradle/tabs-next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLinkIcon, SquareIcon } from 'lucide-react'
import { memo, useCallback, useMemo } from 'react'

import { ChatQueueList } from '~/features/chat/chat-queue-list'
import {
  cancelChatSessionQueueItem,
  listChatSessionQueue,
  reorderChatSessionQueue,
} from '~/features/chat/chat-response-command'
import type { AgentActivity, AgentSession } from '~/lib/types'
import { cn } from '~/lib/utils'

import {
  kanbanKeys,
  useAgentActivities,
  useAgentSessions,
  useStartAgentSession,
  useStopAgentSession,
} from '../use-kanban'
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

function chatQueueQueryKey(chatSessionId: string | null) {
  return ['chat', 'session-queue', chatSessionId ?? 'none'] as const
}

export const AgentSessionPanel = memo(({ issueId, workspaceId }: AgentSessionPanelProps) => {
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

const ActiveAgentSessionPanel = memo(({
  activeSession,
  activities,
  issueId,
  workspaceId,
}: {
  activeSession: AgentSession
  activities: AgentActivity[]
  issueId: string
  workspaceId: string
}) => {
  const queryClient = useQueryClient()
  const stopSession = useStopAgentSession()
  const startSession = useStartAgentSession()
  const status = activeSession.status ?? 'created'
  const config = statusConfig[status] ?? statusConfig.created
  const chatSessionId = activeSession.chatSessionId
  const isExecuting = status === 'active' || status === 'created'

  const queueQueryKey = useMemo(() => chatQueueQueryKey(chatSessionId), [chatSessionId])
  const { data: queueData } = useQuery({
    queryKey: queueQueryKey,
    queryFn: () => listChatSessionQueue(chatSessionId!),
    enabled: !!chatSessionId,
    refetchInterval: isExecuting ? 500 : false,
    refetchIntervalInBackground: false,
  })
  const queueItems = queueData?.items ?? []
  const pendingQueueItems = queueItems.filter(item => item.status === 'pending')
  const hasSteerSignal = queueItems.some(item => (
    item.mode === 'steer'
    && (
      item.status === 'pending'
      || item.status === 'running'
      || (isExecuting && item.status === 'completed' && !!item.startedRunId)
    )
  ))

  const canStop = isExecuting
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

  const invalidateQueue = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queueQueryKey })
  }, [queryClient, queueQueryKey])

  const handleContinuationQueued = useCallback(() => {
    invalidateQueue()
    void queryClient.invalidateQueries({ queryKey: kanbanKeys.agentActivities(activeSession.id) })
  }, [activeSession.id, invalidateQueue, queryClient])

  const handleCancelQueueItem = useCallback(async (queueItemId: string) => {
    if (!chatSessionId) {
      return
    }
    await cancelChatSessionQueueItem({ sessionId: chatSessionId, queueItemId })
    invalidateQueue()
  }, [chatSessionId, invalidateQueue])

  const handleReorderQueueItems = useCallback(async (queueItemIds: string[]) => {
    if (!chatSessionId) {
      return
    }
    await reorderChatSessionQueue({ sessionId: chatSessionId, queueItemIds })
    invalidateQueue()
  }, [chatSessionId, invalidateQueue])

  return (
    <div className="rounded-lg border border-border bg-card shadow-xs" data-testid="issue-agent-session">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-medium text-muted-foreground">Agent Session</span>
          <span className="flex items-center gap-1.5" data-testid="issue-agent-session-phase">
            <span className={cn('size-1.5 rounded-full', config.dotClass)} />
            <span className="text-text-tertiary">{isExecuting ? 'Executing' : config.label}</span>
          </span>
          {hasSteerSignal && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              Steered
            </span>
          )}
          {pendingQueueItems.length > 0 && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
              Queued
              {' '}
              <span className="tabular-nums">{pendingQueueItems.length}</span>
              {' '}
              items
            </span>
          )}
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

      {chatSessionId && pendingQueueItems.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          <ChatQueueList
            items={queueItems}
            onCancel={queueItemId => void handleCancelQueueItem(queueItemId)}
            onReorder={queueItemIds => void handleReorderQueueItems(queueItemIds)}
            title="Continuation queue"
          />
        </div>
      )}

      {/* Prompt input */}
      <AgentPromptInput
        agentSessionId={activeSession.id}
        chatSessionId={chatSessionId}
        sessionStatus={status}
        onQueued={handleContinuationQueued}
      />
    </div>
  )
})
