// Input: useChatSession hook, MessageBubble, Composer, ScrollArea, AnimatePresence
// Output: ChatView — main chat interface with animated message list and composer
// Position: Primary chat feature view, displays conversation with ACP agent

import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { LoaderCircleIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef } from 'react'

import { Composer } from './composer'
import type { MentionItem } from './mention-panel'
import { MessageBubble } from './message-bubble'
import { useChatSession } from './use-chat-session'

interface ChatViewProps {
  agentId: string | null
  sessionId: string | null
  /** Initial message to send on mount (from empty-state composer) */
  initialMessage?: string
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
  agentId,
  sessionId,
  initialMessage,
  availableFiles = [],
  composerToolbar,
  composerContextBar,
  placeholder,
}: ChatViewProps) {
  const { messages, status, sendMessage, stop, isReady } = useChatSession({ agentId, sessionId })
  const scrollEndRef = useRef<HTMLDivElement>(null)
  const initialSentRef = useRef(false)

  const isStreaming = status === 'streaming' || status === 'submitted'

  // Send initial message on first mount when ready
  useEffect(() => {
    if (initialMessage && isReady && !initialSentRef.current) {
      initialSentRef.current = true
      sendMessage({ text: initialMessage })
    }
  }, [initialMessage, isReady, sendMessage])

  // Auto-scroll to bottom on new messages or streaming updates
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: status === 'streaming' ? 'auto' : 'smooth' })
  }, [messages, status])

  const handleSend = useCallback(
    (text: string) => {
      if (!isReady || !text.trim()) {
        return
      }
      sendMessage({ text })
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

          {/* Waiting indicator */}
          {status === 'submitted' && (
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
