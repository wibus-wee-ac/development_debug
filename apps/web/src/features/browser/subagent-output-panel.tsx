import { useQuery } from '@tanstack/react-query'
import { BotIcon, CheckCircle2Icon, LoaderCircleIcon, XCircleIcon } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { cn } from '~/lib/cn'
import { chatSelectors, useChatStore } from '~/store/chat'

import { ChatStreamingHandler } from '../chat/chat-streaming-handler'
import { MessageBubble } from '../chat/message-bubble'
import {
  getProviderThread,
  getProviderThreadTurns,
  providerThreadQueryKey,
  providerThreadTurnsQueryKey,
  subscribeProviderThreadStream,
} from '../chat/provider-thread-command'
import { buildUIMessageChunkStreamFromResponse } from '../chat/sse-chat-transport'

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
  const outputScrollRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const viewSessionId = useMemo(
    () => buildProviderThreadViewSessionId(sessionId, threadId),
    [sessionId, threadId],
  )

  const threadQuery = useQuery({
    queryKey: providerThreadQueryKey(sessionId, threadId),
    queryFn: ({ signal }) => getProviderThread(sessionId, threadId, signal),
    enabled: !!sessionId && !!threadId,
    retry: false,
  })

  const turnsQuery = useQuery({
    queryKey: providerThreadTurnsQueryKey(sessionId, threadId),
    queryFn: ({ signal }) => getProviderThreadTurns(sessionId, threadId, signal),
    enabled: !!sessionId && !!threadId,
    retry: false,
  })

  useEffect(() => {
    const messages = turnsQuery.data?.messages
    if (!messages) {
      return
    }
    const store = useChatStore.getState()
    const hydratedIds = new Set(messages.map(message => message.id))
    const liveMessages = (store.messagesMap.get(viewSessionId) ?? [])
      .filter(message => !hydratedIds.has(message.id))
    store.setMessages(viewSessionId, [...messages, ...liveMessages])
  }, [turnsQuery.data?.messages, viewSessionId])

  useEffect(() => {
    if (!sessionId || !threadId) {
      return
    }
    const controller = new AbortController()
    const placeholderMessageId = `provider-thread:${sessionId}:${threadId}:live`
    const handler = new ChatStreamingHandler(
      viewSessionId,
      placeholderMessageId,
      performance.now(),
      { mode: 'passive', useStoredMessageSnapshot: false },
    )
    handler.start(controller)

    void (async () => {
      try {
        const response = await subscribeProviderThreadStream({
          sessionId,
          threadId,
          signal: controller.signal,
        })
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new Error(`Failed to subscribe provider thread stream: ${response.status} ${body}`)
        }
        const stream = buildUIMessageChunkStreamFromResponse(response, viewSessionId)
        await handler.consume(stream)
        handler.finish()
      }
      catch (error) {
        if (controller.signal.aborted) {
          return
        }
        handler.fail(error instanceof Error ? error.message : 'Provider thread stream failed')
      }
    })()

    return () => {
      controller.abort()
      handler.dispose()
    }
  }, [sessionId, threadId, viewSessionId])

  const messages = useChatStore(useShallow(chatSelectors.messages(viewSessionId)))
  const thread = threadQuery.data?.thread ?? null
  const displayName = thread?.agentNickname ?? thread?.name ?? agentName
  const displayRole = thread?.agentRole ?? agentRole
  const status = thread?.status ?? (turnsQuery.isLoading ? 'active' : 'idle')
  const statusLabel = formatAgentStatus(status)
  const hasError = threadQuery.isError || turnsQuery.isError

  const scrollOutputToBottom = useCallback(() => {
    const viewport = outputScrollRef.current
    if (!viewport) {
      return
    }
    viewport.scrollTop = viewport.scrollHeight
  }, [])

  const handleOutputScroll = useCallback(() => {
    const viewport = outputScrollRef.current
    if (!viewport) {
      return
    }
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    shouldStickToBottomRef.current = distanceFromBottom < 48
  }, [])

  useLayoutEffect(() => {
    shouldStickToBottomRef.current = true
    scrollOutputToBottom()
    const frame = window.requestAnimationFrame(scrollOutputToBottom)
    return () => window.cancelAnimationFrame(frame)
  }, [scrollOutputToBottom, viewSessionId])

  useLayoutEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return
    }
    scrollOutputToBottom()
    const frame = window.requestAnimationFrame(scrollOutputToBottom)
    return () => window.cancelAnimationFrame(frame)
  }, [hasError, messages.length, scrollOutputToBottom])

  useEffect(() => {
    const viewport = outputScrollRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      if (shouldStickToBottomRef.current) {
        scrollOutputToBottom()
      }
    })
    observer.observe(viewport)
    const content = viewport.firstElementChild
    if (content instanceof HTMLElement) {
      observer.observe(content)
    }

    return () => observer.disconnect()
  }, [messages.length, scrollOutputToBottom])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-testid="subagent-output-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-card px-3 py-2">
        <div className="flex size-6 shrink-0 items-center rounded-md bg-primary/10">
          <BotIcon className="mx-auto size-3.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{displayName}</p>
          {displayRole && (
            <p className="truncate text-[10px] text-muted-foreground">{displayRole}</p>
          )}
        </div>
        <AgentStatusBadge status={hasError ? 'errored' : status} label={hasError ? 'Error' : statusLabel} />
      </div>

      <div ref={outputScrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" onScroll={handleOutputScroll}>
        {hasError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground/60">
            <XCircleIcon className="size-8 text-destructive/70" />
            <p className="text-[11px]">Unable to load subagent thread</p>
          </div>
        ) : messages.length > 0 ? (
          <div className="space-y-3">
            {messages.map(message => (
              <ProviderThreadMessage
                key={message.id}
                viewSessionId={viewSessionId}
                messageId={message.id}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground/60">
            <BotIcon className="size-8 opacity-40" />
            <p className="text-[11px]">
              {turnsQuery.isLoading ? 'Loading output...' : 'No output yet'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function ProviderThreadMessage({
  viewSessionId,
  messageId,
}: {
  viewSessionId: string
  messageId: string
}) {
  const message = useChatStore(chatSelectors.message(viewSessionId, messageId))
  const isStreaming = useChatStore(chatSelectors.isVisibleStreamingMessage(viewSessionId, messageId))
  if (!message) {
    return null
  }
  return (
    <MessageBubble
      message={message}
      isStreaming={isStreaming}
      executionDetailsDefaultOpen={false}
    />
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

function buildProviderThreadViewSessionId(sessionId: string, threadId: string): string {
  return `provider-thread:${sessionId}:${threadId}`
}

function formatAgentStatus(status: string): string {
  const labels: Record<string, string> = {
    active: 'Running',
    idle: 'Idle',
    notLoaded: 'Pending',
    systemError: 'Error',
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
  if (status === 'active' || status === 'running') { return 'active' }
  if (status === 'completed') { return 'success' }
  if (status === 'errored' || status === 'interrupted' || status === 'systemError') { return 'error' }
  return 'idle'
}
