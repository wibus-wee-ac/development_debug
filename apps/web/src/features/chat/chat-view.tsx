// Input: useChatSession hook, MessageBubble, Composer, ScrollArea, Virtualizer (virtua)
// Output: ChatView — virtualized chat view: only renders visible messages, instant-to-bottom scroll
// Position: Primary chat feature view — does NOT own message sending lifecycle

import { useQuery } from '@tanstack/react-query'
// Per-message wrapper that subscribes to generating state from the store.
// This ensures only truly-generating messages get streaming=true — not passive/stale state.
import type { UIMessage } from 'ai'
import { AlertCircleIcon, ExternalLinkIcon, LoaderCircleIcon } from 'lucide-react'
import { m } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VirtualizerHandle } from 'virtua'
import { Virtualizer } from 'virtua'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getUsageSessionsBySessionId } from '~/api-gen/sdk.gen'
import { ScrollArea } from '~/components/ui/scroll-area'
import { useAgentModels } from '~/features/agent-runtime/use-agent-models'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useLayoutStore } from '~/store/layout'

import { SessionApprovalList } from '../approval/approval-card'
import { ChatMinimap } from './chat-minimap'
import { Composer } from './composer'
import type { MentionItem } from './mention-panel'
import { MessageBubble } from './message-bubble'
import type { ChatSessionMessageRow } from './use-chat-session'
import { useChatSession } from './use-chat-session'
import { useSessionAwaitSummary } from './use-session-await'

interface ChatViewProps {
  sessionId: string | null
  /** Pre-loaded snapshot rows from a route loader; eliminates empty-state flash on first visit. */
  initialSnapshotRows?: ChatSessionMessageRow[]
  /** Available files for @ mention */
  availableFiles?: MentionItem[]
  /** Custom toolbar rendered in the composer left slot */
  composerToolbar?: React.ReactNode
  /** Ref to read per-message overrides (modelId, thinkingEffort) before sending */
  sendOverridesRef?: React.MutableRefObject<{ modelId?: string, thinkingEffort?: 'low' | 'medium' | 'high' | 'auto' | null }>
  /** Custom context bar rendered before the send button */
  composerContextBar?: React.ReactNode
  /** Placeholder text for composer */
  placeholder?: string
}

interface ChatScrollMetrics {
  offset: number
  scrollHeight: number
  viewportHeight: number
  barProgress: number[]
}

const EMPTY_FILES: MentionItem[] = []
const EMPTY_SCROLL_METRICS: ChatScrollMetrics = { offset: 0, scrollHeight: 0, viewportHeight: 0, barProgress: [] }

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`
  }
  return String(tokens)
}

function ChatMessageListPane({
  messages,
  status,
  error,
  isReady,
  showThinking,
  scrollContainerRef,
  viewportRef,
  virtualizerRef,
  keepMountedIndices,
  onVirtualScroll,
  scrollMetrics,
  onScrollToIndex,
  onScrollTo,
}: {
  messages: ReturnType<typeof useChatSession>['messages']
  status: ReturnType<typeof useChatSession>['status']
  error: ReturnType<typeof useChatSession>['error']
  isReady: boolean
  showThinking: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  viewportRef: React.RefObject<HTMLDivElement | null>
  virtualizerRef: React.RefObject<VirtualizerHandle | null>
  keepMountedIndices?: number[]
  onVirtualScroll: (offset: number) => void
  scrollMetrics: ChatScrollMetrics
  onScrollToIndex: (index: number) => void
  onScrollTo: (offset: number) => void
}) {
  return (
    <div ref={scrollContainerRef} className="relative min-h-0 flex-1 overflow-hidden">
      <ScrollArea className="h-full **:data-[slot=scroll-area-scrollbar]:hidden">
        <div className="mx-auto max-w-208 px-4 pt-4">
          {messages.length === 0 && isReady && (
            <div className="flex h-full items-center justify-center py-32">
              <p className="select-none text-sm text-muted-foreground">
                发送消息开始对话
              </p>
            </div>
          )}

          <Virtualizer
            ref={virtualizerRef}
            scrollRef={viewportRef}
            startMargin={24}
            keepMounted={keepMountedIndices}
            onScroll={onVirtualScroll}
          >
            {messages.map(message => (
              <MessageBubbleWithStreamState
                key={message.id}
                message={message}
              />
            ))}
          </Virtualizer>

          {status === 'error' && (
            <m.div
              data-testid="chat-error-banner"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
              className="flex items-center gap-2 pl-1 pt-4"
            >
              <AlertCircleIcon className="size-3.5 text-destructive/70" aria-hidden="true" />
              <span className="text-xs text-destructive/70">
                {error ?? '发送失败，请重试'}
              </span>
            </m.div>
          )}

          {showThinking && (
            <m.div
              data-testid="chat-thinking-indicator"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
              className="flex items-center gap-2 pl-1 pt-4"
            >
              <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground/50" aria-hidden="true" />
              <span className="text-xs text-muted-foreground">正在思考...</span>
            </m.div>
          )}

          <div className="h-6" aria-hidden="true" />
        </div>
      </ScrollArea>

      <ChatMinimap
        messages={messages}
        scrollOffset={scrollMetrics.offset}
        scrollHeight={scrollMetrics.scrollHeight}
        viewportHeight={scrollMetrics.viewportHeight}
        barProgress={scrollMetrics.barProgress}
        onScrollToIndex={onScrollToIndex}
        onScrollTo={onScrollTo}
      />
    </div>
  )
}

function ChatAwaitBanner({ awaitSummary }: { awaitSummary: Awaited<ReturnType<typeof useSessionAwaitSummary>['data']> }) {
  if (!awaitSummary?.awaiting) {
    return null
  }

  return (
    <div className="mb-2 flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
      <span className="min-w-0 truncate">
        {(awaitSummary.reason as string) ?? `Waiting for ${(awaitSummary.primarySource as string) ?? 'event'}...`}
      </span>
      <button
        type="button"
        onClick={() => useLayoutStore.getState().openAsideTab('await')}
        className="ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ExternalLinkIcon className="size-3" />
        <span>查看</span>
      </button>
    </div>
  )
}

function ChatComposerSection({
  awaitSummary,
  onSend,
  onStop,
  isStreaming,
  disabled,
  placeholder,
  availableFiles,
  toolbar,
  contextBar,
  droppedPath,
  sessionTokens,
  sessionContextWindow,
}: {
  awaitSummary: Awaited<ReturnType<typeof useSessionAwaitSummary>['data']>
  onSend: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  disabled: boolean
  placeholder?: string
  availableFiles: MentionItem[]
  toolbar?: React.ReactNode
  contextBar?: React.ReactNode
  droppedPath: { text: string, ts: number } | null
  sessionTokens: number
  sessionContextWindow: number | null
}) {
  return (
    <div className="shrink-0 bg-background/80 px-4 py-3 backdrop-blur-sm">
      <div className="mx-auto max-w-208">
        <ChatAwaitBanner awaitSummary={awaitSummary} />
        <Composer
          onSend={onSend}
          onStop={onStop}
          isStreaming={isStreaming}
          disabled={disabled}
          placeholder={placeholder}
          availableFiles={availableFiles}
          toolbar={toolbar}
          contextBar={contextBar}
          appendText={droppedPath ? `${droppedPath.text}` : undefined}
          appendTextKey={droppedPath?.ts}
        />
        {sessionTokens > 0 && (
          <div className="mt-1.5 flex items-center justify-end gap-2">
            <div className="flex items-center gap-1.5">
              {sessionContextWindow != null && sessionContextWindow > 0 && (
                <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/40 transition-all"
                    style={{ width: `${Math.min(100, (sessionTokens / sessionContextWindow) * 100)}%` }}
                  />
                </div>
              )}
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {formatTokenCount(sessionTokens)}
                {sessionContextWindow != null && sessionContextWindow > 0
                  ? ` / ${formatTokenCount(sessionContextWindow)}`
                  : ''}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function ChatView({
  sessionId,
  initialSnapshotRows,
  availableFiles = EMPTY_FILES,
  composerToolbar,
  composerContextBar,
  sendOverridesRef,
  placeholder,
}: ChatViewProps) {
  const { messages, status, error, sendMessage, stop, isReady } = useChatSession(sessionId, { initialSnapshotRows })
  const { data: awaitSummary } = useSessionAwaitSummary(sessionId)
  const isAwaiting = awaitSummary?.awaiting ?? false
  const [droppedPath, setDroppedPath] = useState<{ text: string, ts: number } | null>(null)
  const [sessionTokens, setSessionTokens] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { data: sessionBinding } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId ?? '' } }),
    enabled: !!sessionId,
    staleTime: 60_000,
    select: data => data
      ? {
          agentProfileId: typeof data.agentProfileId === 'string' ? data.agentProfileId : null,
          modelId: typeof data.modelId === 'string' ? data.modelId : null,
        }
      : null,
  })
  const { models: sessionModels } = useAgentModels(sessionBinding?.agentProfileId ?? null)
  const sessionContextWindow = useMemo(() => {
    if (!sessionBinding?.modelId) {
      return null
    }

    const model = sessionModels.find(candidate => candidate.id === sessionBinding.modelId)
    const contextWindow = model?.capabilities.contextWindow
    return contextWindow != null && contextWindow > 0 ? contextWindow : null
  }, [sessionBinding, sessionModels])

  /**
   * Ref to the ScrollArea's scrollable viewport — shared with Virtualizer so
   * it can track scroll position without a separate listener.
   */
  const viewportRef = useRef<HTMLDivElement>(null)
  const virtualizerRef = useRef<VirtualizerHandle>(null)

  /** True when the user is near the bottom (<= 200 px away). Auto-scroll only fires when true. */
  const isAtBottomRef = useRef(true)

  /** Scroll metrics for the minimap */
  const [scrollMetrics, setScrollMetrics] = useState<ChatScrollMetrics>(EMPTY_SCROLL_METRICS)

  const isStreaming = status === 'streaming'

  useEffect(() => {
    viewportRef.current = scrollContainerRef.current?.querySelector(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLDivElement | null

    return () => {
      viewportRef.current = null
    }
  }, [])

  // Keep the streaming message mounted to prevent re-animation on scroll recycle
  const generatingIds = useChatStore(s => s.generatingMessageIds)
  const keepMountedIndices = useMemo(() => {
    if (generatingIds.size === 0) {
      return undefined
    }
    const indices: number[] = []
    for (let i = 0; i < messages.length; i++) {
      if (generatingIds.has(messages[i].id)) {
        indices.push(i)
      }
    }
    return indices.length > 0 ? indices : undefined
  }, [generatingIds, messages])

  const lastMsg = messages.at(-1)
  const assistantHasVisibleText = lastMsg?.role === 'assistant'
    && lastMsg.parts.some(
      p => p.type === 'text' && (p as { text: string }).text.trim().length > 0,
    )
  const showThinking = isStreaming && !assistantHasVisibleText

  const scrollToBottom = useCallback(() => {
    const vp = viewportRef.current
    if (vp) {
      vp.scrollTop = vp.scrollHeight
      isAtBottomRef.current = true
    }
  }, [])

  // When the session changes, jump to the bottom after virtua has had a chance
  // to render its first batch of items.  requestAnimationFrame delays the scroll
  // until after the browser has painted, at which point scrollHeight reflects the
  // actual rendered content and vp.scrollTop = vp.scrollHeight works correctly.
  const prevSessionIdRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (prevSessionIdRef.current === sessionId) {
      return
    }
    prevSessionIdRef.current = sessionId
    isAtBottomRef.current = true
    if (messages.length > 0) {
      // First: tell virtua which index to anchor to so it renders the bottom items
      virtualizerRef.current?.scrollToIndex(messages.length - 1, { align: 'end' })
      // Then: after the browser paints, force the viewport all the way down
      // (handles any remaining offset gap from unresolved item heights)
      requestAnimationFrame(() => {
        const vp = viewportRef.current
        if (vp) {
          vp.scrollTop = vp.scrollHeight
        }
      })
    }
  }, [messages.length, sessionId])

  // Ongoing auto-scroll during streaming and after new messages are appended —
  // but only when the user was already near the bottom (respect manual scroll-up).
  useEffect(() => {
    if (!isAtBottomRef.current) {
      return
    }
    scrollToBottom()
  }, [messages, status, scrollToBottom])

  // Track whether the user is near the bottom. Fires on every scroll offset from virtua.
  const handleVirtScroll = useCallback((offset: number) => {
    const vp = viewportRef.current
    if (!vp) {
      return
    }
    isAtBottomRef.current = offset + vp.offsetHeight >= vp.scrollHeight - 200
    setScrollMetrics(prev => ({
      ...prev,
      offset,
      scrollHeight: vp.scrollHeight,
      viewportHeight: vp.offsetHeight,
    }))
  }, [])

  // Fetch session token count after each turn completes
  useEffect(() => {
    if (sessionId && status !== 'streaming') {
      getUsageSessionsBySessionId({ path: { sessionId } }).then((res) => {
        if (res.data) {
          setSessionTokens(res.data.totalTokens)
        }
      }).catch(() => { })
    }
  }, [sessionId, status, messages.length])

  const handleSend = useCallback(
    (text: string) => {
      if (!isReady || !text.trim()) {
        return
      }
      const overrides = sendOverridesRef?.current
      sendMessage(text, overrides)
    },
    [isReady, sendMessage, sendOverridesRef],
  )

  const handleMinimapScrollToIndex = useCallback(
    (index: number) => {
      const virt = virtualizerRef.current
      const vp = viewportRef.current
      if (!virt || !vp) {
        return
      }
      // Use real item offset for accurate positioning, then native smooth scroll
      const targetOffset = virt.getItemOffset(index)
      vp.scrollTo({ top: targetOffset, behavior: 'smooth' })
    },
    [],
  )

  const handleMinimapScrollTo = useCallback(
    (offset: number) => {
      const vp = viewportRef.current
      if (vp) {
        vp.scrollTop = offset
      }
    },
    [],
  )

  return (
    <div
      className="flex h-full flex-col"
      data-testid="chat-view"
      data-chat-ready={isReady ? 'true' : 'false'}
      data-chat-session-id={sessionId ?? ''}
      data-chat-status={status}
      suppressHydrationWarning
      onDrop={(e) => {
        e.preventDefault()
        const path = e.dataTransfer.getData('text/plain')
        if (path) {
          setDroppedPath({ text: path, ts: Date.now() })
        }
      }}
      onDragOver={e => e.preventDefault()}
    >
      <ChatMessageListPane
        messages={messages}
        status={status}
        error={error}
        isReady={isReady}
        showThinking={showThinking}
        scrollContainerRef={scrollContainerRef}
        viewportRef={viewportRef}
        virtualizerRef={virtualizerRef}
        keepMountedIndices={keepMountedIndices}
        onVirtualScroll={handleVirtScroll}
        scrollMetrics={scrollMetrics}
        onScrollToIndex={handleMinimapScrollToIndex}
        onScrollTo={handleMinimapScrollTo}
      />

      {/* Approval cards — pinned above composer */}
      <SessionApprovalList chatSessionId={sessionId} />

      <ChatComposerSection
        awaitSummary={awaitSummary}
        onSend={handleSend}
        onStop={stop}
        isStreaming={isStreaming}
        disabled={!isReady || isAwaiting}
        placeholder={placeholder}
        availableFiles={availableFiles}
        toolbar={composerToolbar}
        contextBar={composerContextBar}
        droppedPath={droppedPath}
        sessionTokens={sessionTokens}
        sessionContextWindow={sessionContextWindow}
      />
    </div>
  )
}

function MessageBubbleWithStreamState({ message }: { message: UIMessage }) {
  const isGenerating = useChatStore(chatSelectors.isGenerating(message.id))
  return <MessageBubble message={message} isStreaming={isGenerating} />
}
