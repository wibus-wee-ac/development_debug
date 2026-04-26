// Input: useChatSession hook, MessageBubble, Composer, ScrollArea, Virtualizer (virtua)
// Output: ChatView — virtualized chat view: only renders visible messages, instant-to-bottom scroll
// Position: Primary chat feature view — does NOT own message sending lifecycle

import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { ipc } from '@renderer/lib/ipc'
import { AlertCircleIcon, LoaderCircleIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { VirtualizerHandle } from 'virtua'
import { Virtualizer } from 'virtua'

import { ChatMinimap } from './chat-minimap'
import { Composer } from './composer'
import type { MentionItem } from './mention-panel'
import { MessageBubble } from './message-bubble'
import type { ChatMessageRow } from './use-chat-session'
import { useChatSession } from './use-chat-session'

interface ChatViewProps {
  sessionId: string | null
  /** Pre-loaded message rows from a route loader; eliminates empty-state flash on first visit. */
  initialMessageRows?: ChatMessageRow[]
  /** Available files for @ mention */
  availableFiles?: MentionItem[]
  /** Custom toolbar rendered in the composer left slot */
  composerToolbar?: React.ReactNode
  /** Custom context bar rendered before the send button */
  composerContextBar?: React.ReactNode
  /** Placeholder text for composer */
  placeholder?: string
}

export function ChatView({
  sessionId,
  initialMessageRows,
  availableFiles = [],
  composerToolbar,
  composerContextBar,
  placeholder,
}: ChatViewProps) {
  const { messages, status, error, sendMessage, stop, isReady } = useChatSession(sessionId, { initialMessageRows })
  const [droppedPath, setDroppedPath] = useState<{ text: string, ts: number } | null>(null)
  const [sessionTokens, setSessionTokens] = useState(0)

  /**
   * Ref to the ScrollArea's scrollable viewport — shared with Virtualizer so
   * it can track scroll position without a separate listener.
   */
  const viewportRef = useRef<HTMLElement>(null)
  const virtualizerRef = useRef<VirtualizerHandle>(null)

  /** True when the user is near the bottom (<= 200 px away). Auto-scroll only fires when true. */
  const isAtBottomRef = useRef(true)

  /** Scroll metrics for the minimap */
  const [scrollMetrics, setScrollMetrics] = useState({ offset: 0, scrollHeight: 0, viewportHeight: 0, barProgress: [] as number[] })

  const isStreaming = status === 'streaming'

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
  })

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
    const sh = vp.scrollHeight
    const vh = vp.offsetHeight

    // Compute per-message reading progress from real virtualizer item sizes
    const virt = virtualizerRef.current
    let progress: number[] = []
    if (virt && messages.length > 0) {
      const vpTop = offset
      const vpBottom = offset + vh
      progress = messages.map((_, i) => {
        const msgTop = virt.getItemOffset(i)
        const msgSize = virt.getItemSize(i)
        const msgBottom = msgTop + msgSize
        if (vpBottom <= msgTop) {
          return 0
        }
        if (vpTop >= msgBottom) {
          return 1
        }
        if (msgSize <= 0) {
          return 0
        }
        return Math.min((Math.max(vpTop, msgTop) - msgTop) / msgSize, 1)
      })
    }

    setScrollMetrics({ offset, scrollHeight: sh, viewportHeight: vh, barProgress: progress })
  }, [messages])

  // Fetch session token count after each turn completes
  useEffect(() => {
    if (sessionId && status !== 'streaming') {
      ipc?.usage.getSessionUsage(sessionId).then((result) => {
        if (result) {
          setSessionTokens((result as { totalTokens: number }).totalTokens)
        }
      }).catch(() => { })
    }
  }, [sessionId, status, messages.length])

  const handleSend = useCallback(
    (text: string) => {
      if (!isReady || !text.trim()) {
        return
      }
      sendMessage(text)
    },
    [isReady, sendMessage],
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
      onDrop={(e) => {
        e.preventDefault()
        const path = e.dataTransfer.getData('text/plain')
        if (path) {
          setDroppedPath({ text: path, ts: Date.now() })
        }
      }}
      onDragOver={e => e.preventDefault()}
    >
      {/* Virtualized message list */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full **:data-[slot=scroll-area-scrollbar]:hidden" viewportRef={viewportRef}>
          <div className="mx-auto max-w-2xl px-4 pt-4">
            {messages.length === 0 && isReady && (
              <div className="flex items-center justify-center py-20">
                <p className="text-sm text-muted-foreground/50 select-none">
                  发送消息开始对话
                </p>
              </div>
            )}

            <Virtualizer
              ref={virtualizerRef}
              scrollRef={viewportRef}
              startMargin={24}
              onScroll={handleVirtScroll}
            >
              {messages.map(message => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isStreaming={status === 'streaming' && message === messages.at(-1)}
                />
              ))}
            </Virtualizer>

            {status === 'error' && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
                className="flex items-center gap-2 pt-4 pl-1"
              >
                <AlertCircleIcon className="size-3.5 text-destructive/70" aria-hidden="true" />
                <span className="text-xs text-destructive/70">
                  {error ?? '发送失败，请重试'}
                </span>
              </motion.div>
            )}

            {showThinking && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
                className="flex items-center gap-2 pt-4 pl-1"
              >
                <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground/50" aria-hidden="true" />
                <span className="text-xs text-muted-foreground/50">正在思考...</span>
              </motion.div>
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
          onScrollToIndex={handleMinimapScrollToIndex}
          onScrollTo={handleMinimapScrollTo}
        />
      </div>

      {/* Composer — pinned to bottom */}
      <div className="shrink-0 bg-background/80 backdrop-blur-sm px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <Composer
            onSend={handleSend}
            onStop={stop}
            isStreaming={isStreaming}
            disabled={!isReady}
            placeholder={placeholder}
            availableFiles={availableFiles}
            toolbar={composerToolbar}
            contextBar={composerContextBar}
            appendText={droppedPath ? `${droppedPath.text}` : undefined}
            appendTextKey={droppedPath?.ts}
          />
          {sessionTokens > 0 && (
            <p className="mt-1.5 text-right text-[10px] tabular-nums text-muted-foreground/30">
              {sessionTokens >= 1_000
                ? `${(sessionTokens / 1_000).toFixed(1)}K`
                : sessionTokens}
              {' '}
              tokens
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
