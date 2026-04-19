// Input: useChatSession hook (thin subscriber), MessageBubble, Composer, ScrollArea, AnimatePresence
// Output: ChatView — read-only chat view: reads messages, subscribes to stream, renders results
// Position: Primary chat feature view — does NOT own message sending lifecycle

import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { AlertCircleIcon, LoaderCircleIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef } from 'react'

import { Composer } from './composer'
import type { MentionItem } from './mention-panel'
import { MessageBubble } from './message-bubble'
import { useChatSession } from './use-chat-session'

interface ChatViewProps {
  sessionId: string | null
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
  availableFiles = [],
  composerToolbar,
  composerContextBar,
  placeholder,
}: ChatViewProps) {
  const { messages, status, error, sendMessage, stop, isReady } = useChatSession(sessionId)
  const scrollEndRef = useRef<HTMLDivElement>(null)

  const isStreaming = status === 'streaming'

  // Show the "thinking" indicator whenever we're streaming but the user can't
  // yet see any assistant text output — this covers:
  //  - pre-first-chunk (assistant message not created yet, last msg is user)
  //  - reasoning-only phase (reasoning block collapsed by default, visually silent)
  //  - tool-call-only phase (no user-facing text yet)
  const lastMsg = messages.at(-1)
  const assistantHasVisibleText = lastMsg?.role === 'assistant'
    && lastMsg.parts.some(
      p => p.type === 'text' && (p as { text: string }).text.trim().length > 0,
    )
  const showThinking = isStreaming && !assistantHasVisibleText

  // Auto-scroll to bottom on new messages or streaming updates
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: status === 'streaming' ? 'auto' : 'smooth' })
  }, [messages, status])

  const handleSend = useCallback(
    (text: string) => {
      if (!isReady || !text.trim()) {
        return
      }
      sendMessage(text)
    },
    [isReady, sendMessage],
  )

  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl px-4 py-6">
          {messages.length === 0 && (
            <div className="flex items-center justify-center py-20">
              <p className="text-sm text-muted-foreground/50 select-none">
                发送消息开始对话
              </p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages.map(message => (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={status === 'streaming' && message === messages.at(-1)}
              />
            ))}
          </AnimatePresence>

          {/* Error indicator */}
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

          {/* Thinking indicator — anchored below the last message whenever the
              assistant has no visible text yet (pre-first-chunk, reasoning only,
              or tool-call only). Hides as soon as text starts streaming. */}
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

          <div ref={scrollEndRef} />
        </div>
      </ScrollArea>

      {/* Composer — pinned to bottom, no border-t */}
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
          />
        </div>
      </div>
    </div>
  )
}
