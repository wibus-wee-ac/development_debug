import { useQuery } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import { BotIcon, CheckCircle2Icon, LoaderCircleIcon, XCircleIcon } from 'lucide-react'
import { useMemo } from 'react'

import { cn } from '~/lib/cn'
import { chatSelectors, useChatStore } from '~/store/chat'

import type { ChatRuntimeCrewAgentItem, ChatRuntimeCrewUiSlotState } from '../chat/chat-capabilities'
import { getChatRuntimeUiSlotStates, runtimeUiSlotStatesQueryKey } from '../chat/chat-capabilities'
import { readSubagentOutputMessage } from '../chat/chat-tool-entities'
import type { RuntimeSessionStatusKind } from '../chat/runtime-session-status-command'

interface SubagentOutputPanelProps {
  sessionId: string
  threadId: string
  agentName: string
  agentRole: string | null
}

export function SubagentOutputPanel({
  sessionId,
  threadId,
  agentName,
  agentRole,
}: SubagentOutputPanelProps) {
  const { data: runtimeUiSlotStates } = useQuery({
    queryKey: runtimeUiSlotStatesQueryKey(sessionId, null),
    queryFn: ({ signal }) => getChatRuntimeUiSlotStates(sessionId, signal),
    enabled: !!sessionId,
    staleTime: 2_000,
    refetchInterval: 2_000,
    retry: false,
  })

  const crewState = runtimeUiSlotStates?.states.find(
    (s): s is ChatRuntimeCrewUiSlotState => s.kind === 'crew',
  ) ?? null

  const agent = crewState
    ? findAgentByThreadId(crewState, threadId)
    : null

  const messages = useChatStore(
    sessionId ? chatSelectors.messages(sessionId) : () => [] as UIMessage[],
  )

  const subagentOutput = useMemo(() => {
    return findSubagentOutputFromMessages(messages, threadId)
  }, [messages, threadId])

  const status = agent?.status ?? 'pendingInit'
  const statusLabel = formatAgentStatus(status)

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="subagent-output-panel">
      {/* Agent header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-card px-3 py-2">
        <div className="flex size-6 shrink-0 items-center rounded-md bg-primary/10">
          <BotIcon className="size-3.5 mx-auto text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{agentName}</p>
          {agentRole && (
            <p className="truncate text-[10px] text-muted-foreground">{agentRole}</p>
          )}
        </div>
        <AgentStatusBadge status={status} label={statusLabel} />
      </div>

      {/* Agent output */}
      <div className="flex-1 overflow-y-auto p-3">
        {subagentOutput ? (
          <SubagentMessageParts message={subagentOutput} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground/60">
            <BotIcon className="size-8 opacity-40" />
            <p className="text-[11px]">
              {status === 'running' ? 'Waiting for output...' : 'No output yet'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function AgentStatusBadge({
  status,
  label,
}: {
  status: string
  label: string
}) {
  const tone = getAgentStatusTone(status)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        tone === 'active' && 'bg-primary/10 text-primary',
        tone === 'success' && 'bg-green-500/10 text-green-600 dark:text-green-400',
        tone === 'error' && 'bg-destructive/10 text-destructive',
        tone === 'idle' && 'bg-muted text-muted-foreground',
      )}
    >
      {tone === 'active' && <LoaderCircleIcon className="size-2.5 animate-spin" />}
      {tone === 'success' && <CheckCircle2Icon className="size-2.5" />}
      {tone === 'error' && <XCircleIcon className="size-2.5" />}
      {label}
    </span>
  )
}

function SubagentMessageParts({ message }: { message: UIMessage }) {
  const parts = message.parts ?? []
  if (parts.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground/60">No content</p>
    )
  }

  return (
    <div className="space-y-2">
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return (
            <div
              key={index}
              className="whitespace-pre-wrap break-words text-xs text-foreground"
            >
              {(part as { text: string }).text}
            </div>
          )
        }

        if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
          const toolPart = part as {
            type: string
            toolCallId: string
            toolName?: string
            state?: string
            input?: unknown
            output?: unknown
          }
          return (
            <div
              key={index}
              className="rounded-md border border-border/50 bg-muted/30 px-2 py-1.5"
            >
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {toolPart.toolName ?? toolPart.type.replace(/^tool-/, '')}
                </span>
                {toolPart.state && (
                  <span className="text-[9px] opacity-60">({toolPart.state})</span>
                )}
              </div>
            </div>
          )
        }

        return null
      })}
    </div>
  )
}

function findAgentByThreadId(
  crewState: ChatRuntimeCrewUiSlotState,
  threadId: string,
): ChatRuntimeCrewAgentItem | null {
  for (const call of crewState.calls ?? []) {
    for (const agent of call.agents ?? []) {
      if (agent.threadId === threadId) {
        return agent
      }
    }
  }
  return null
}

function findSubagentOutputFromMessages(
  messages: UIMessage[],
  threadId: string,
): UIMessage | null {
  for (const msg of messages) {
    for (const part of msg.parts ?? []) {
      if (!('output' in part)) continue
      const output = (part as { output?: unknown }).output
      const subagentMsg = readSubagentOutputMessage(output)
      if (subagentMsg && subagentMsg.id?.includes(threadId)) {
        return subagentMsg
      }
    }
  }
  return null
}

function formatAgentStatus(status: string): string {
  const labels: Record<string, string> = {
    pendingInit: 'Pending',
    running: 'Running',
    interrupted: 'Interrupted',
    completed: 'Completed',
    errored: 'Error',
    shutdown: 'Shutdown',
    notFound: 'Not Found',
  }
  return labels[status] ?? status
}

function getAgentStatusTone(status: string): 'active' | 'success' | 'error' | 'idle' {
  if (status === 'running') return 'active'
  if (status === 'completed') return 'success'
  if (status === 'errored' || status === 'interrupted') return 'error'
  return 'idle'
}
