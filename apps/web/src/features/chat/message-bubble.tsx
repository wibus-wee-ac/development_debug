// Input: UIMessage from ai, subagent message store, Streamdown renderer, ReasoningBlock, ToolCallBlock, motion
// Output: MessageBubble — animated message with parts rendering and action bar
// Position: Core display component in chat feature for rendering individual messages

import type { UIMessage } from 'ai'
import { CheckIcon, CopyIcon, UserIcon } from 'lucide-react'
import { m } from 'motion/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from '@cradle/streamdown'

import { cn } from '~/lib/cn'
import { useChatStore } from '~/store/chat'
import { useStreamdownStore } from '~/store/streamdown'

import { ReasoningBlock } from './reasoning-block'
import { ToolCallBlock } from './tool-call-block'

const BUBBLE_TRANSITION = { type: 'spring', stiffness: 500, damping: 35, mass: 0.8 } as const

type MessagePart = UIMessage['parts'][number]
type RenderableToolPart = {
  type: string
  toolName?: string
  toolCallId: string
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | 'output-denied' | 'approval-requested' | 'approval-responded'
  input?: unknown
  output?: unknown
  errorText?: string
}

/**
 * Render a single subagent part inside the fold.
 */
function renderSubagentPart(part: MessagePart, key: string, isStreaming: boolean, streamdownSettings: { animationPreset: string, animateMode: 'char' | 'word', showCursor: boolean }) {
  if (part.type === 'text') {
    return (
      <Streamdown
        key={key}
        content={part.text}
        streaming={isStreaming}
        animationPreset={streamdownSettings.animationPreset as 'minimal' | 'balanced' | 'dramatic'}
        animateMode={streamdownSettings.animateMode}
        showCursor={streamdownSettings.showCursor}
      />
    )
  }
  if (part.type === 'reasoning') {
    return <ReasoningBlock key={key} text={part.text} state={(part as { state?: 'streaming' | 'done' }).state} />
  }
  if (part.type === 'dynamic-tool' || (part.type.startsWith('tool-') && 'toolCallId' in part)) {
    const toolPart = part as RenderableToolPart
    return (
      <ToolCallBlock
        key={key}
        toolName={toolPart.toolName ?? toolPart.type.replace('tool-', '')}
        toolCallId={toolPart.toolCallId}
        state={toolPart.state}
        input={toolPart.input}
        output={toolPart.output}
        errorText={toolPart.errorText}
      />
    )
  }
  return null
}

/**
 * Module-level set of message IDs that have already been rendered at least once.
 * Used to suppress Framer Motion entrance animation when a virtualizer remounts
 * an item that scrolled out of view — we only want the animation on the true
 * first appearance of each message.
 */
const seenMessageIds = new Set<string>()

interface MessageBubbleProps {
  message: UIMessage
  isStreaming: boolean
}

function MessageBubbleView({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const { animationPreset, animateMode, showCursor } = useStreamdownStore()
  const subagentMap = useChatStore(s => s.subagentMessagesMap.get(message.id))

  // Only animate on the true first appearance — skip if the virtualizer is
  // remounting an item that simply scrolled out of view.
  const isFirstAppearance = !seenMessageIds.has(message.id)
  if (isFirstAppearance) {
    seenMessageIds.add(message.id)
  }

  // Extract plain text only (no reasoning/thinking) for copy
  const plainText = useMemo(() => {
    return message.parts
      .flatMap(p => p.type === 'text' ? [(p as { text: string }).text] : [])
      .join('\n')
  }, [message.parts])

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(plainText)
    setCopied(true)

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copyFeedbackTimerRef.current = null
    }, 1500)
  }, [plainText])

  return (
    <m.div
      initial={isFirstAppearance ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={BUBBLE_TRANSITION}
      data-testid={`message-bubble-${message.role}`}
      data-message-id={message.id}
      data-message-role={message.role}
      data-message-streaming={isStreaming ? 'true' : 'false'}
      className={cn(
        'group flex w-full gap-3',
        isUser && 'justify-end',
      )}
    >
      <div
        className={cn(
          'min-w-0',
          isUser && 'max-w-[70%] ',
          !isUser && 'w-full',
        )}
      >
        {/* Bubble */}
        <div
          className={cn(
            'rounded-lg text-sm leading-relaxed',
            isUser && 'bg-muted text-foreground rounded-br-sm px-3 py-2',
            isAssistant && 'text-foreground',
          )}
        >
          {message.parts.map((part, i) => {
            const key = 'toolCallId' in part
              ? (part as { toolCallId: string }).toolCallId
              : `${message.id}-${part.type}-${i}`

            if (part.type === 'text') {
              if (isUser) {
                return (
                  <span key={key} className="whitespace-pre-wrap wrap-break-word">
                    {part.text}
                  </span>
                )
              }
              return (
                <Streamdown
                  key={key}
                  content={part.text}
                  streaming={isStreaming}
                  animationPreset={animationPreset}
                  animateMode={animateMode}
                  showCursor={showCursor}
                />
              )
            }

            if (part.type === 'reasoning') {
              return (
                <ReasoningBlock
                  key={key}
                  text={part.text}
                  state={part.state}
                />
              )
            }

            // Tool calls: dynamic-tool or typed tool-{name}
            if (
              part.type === 'dynamic-tool'
              || (part.type.startsWith('tool-') && 'toolCallId' in part)
            ) {
              const toolPart = part as {
                type: string
                toolName: string
                toolCallId: string
                state: string
                input?: unknown
                output?: unknown
                errorText?: string
              }

              const subagentMessages = subagentMap?.get(toolPart.toolCallId) ?? []

              return (
                <ToolCallBlock
                  key={key}
                  toolName={toolPart.toolName ?? toolPart.type.replace('tool-', '')}
                  toolCallId={toolPart.toolCallId}
                  state={toolPart.state as 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | 'output-denied' | 'approval-requested' | 'approval-responded'}
                  input={toolPart.input}
                  output={toolPart.output}
                  errorText={toolPart.errorText}
                >
                  {subagentMessages.flatMap(subagentMessage => subagentMessage.parts.map((sp, si) => renderSubagentPart(sp, `${subagentMessage.id}-sub-${si}`, isStreaming, { animationPreset, animateMode, showCursor })))}
                </ToolCallBlock>
              )
            }

            if (part.type === 'file') {
              return (
                <div key={key} className="my-1 flex items-center gap-1.5 text-xs text-muted-foreground/60">
                  <UserIcon className="size-3" aria-hidden="true" />
                  <span>File attachment</span>
                </div>
              )
            }

            return null
          })}
        </div>

        {/* Action bar — appears on hover for all messages */}
        {!isStreaming && plainText.length > 0 && (
          <div className={cn(
            'mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150',
            isUser && 'justify-end',
          )}
          >
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label="Copy message"
            >
              {copied
                ? <CheckIcon className="size-3 text-emerald-500" aria-hidden="true" />
                : <CopyIcon className="size-3" aria-hidden="true" />}
            </button>
          </div>
        )}
      </div>
    </m.div>
  )
}

export const MessageBubble = memo(
  MessageBubbleView,
  (prevProps, nextProps) =>
    prevProps.message === nextProps.message
    && prevProps.isStreaming === nextProps.isStreaming,
)
