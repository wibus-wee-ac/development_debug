// Input: UIMessage from ai, subagent message store, Streamdown renderer, block components, motion
// Output: MessageBubble — animated message with parts rendering, grouping, and execution-phase folding
// Position: Core display component in chat feature for rendering individual messages

import { Streamdown } from '@cradle/streamdown'
import type { UIMessage } from 'ai'
import { CheckIcon, CopyIcon, UserIcon } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import { useChatStore } from '~/store/chat'
import { useStreamdownStore } from '~/store/streamdown'

import { ReasoningBlock, ToolCallBlock, GroupedToolCallBlock } from './blocks'
import type { ChatRenderItem } from './chat-render-plan'
import { groupMessageParts, splitExecutionPhase } from './chat-render-plan'

const BUBBLE_TRANSITION = { type: 'spring', stiffness: 500, damping: 35, mass: 0.8 } as const

/* ─── Subagent part render ──────────────────────────────────────── */

function renderSubagentItem(
  item: ChatRenderItem,
  isStreaming: boolean,
  streamdownSettings: { animationPreset: string, animateMode: 'char' | 'word', showCursor: boolean },
) {
  switch (item.kind) {
    case 'text':
      return (
        <Streamdown
          key={item.key}
          content={item.text}
          streaming={isStreaming}
          animationPreset={streamdownSettings.animationPreset as 'minimal' | 'balanced' | 'dramatic'}
          animateMode={streamdownSettings.animateMode}
          showCursor={streamdownSettings.showCursor}
        />
      )
    case 'reasoning':
      return <ReasoningBlock key={item.key} text={item.text} state={item.state} />
    case 'tool-call': {
      const toolPart = item.part
      return (
        <ToolCallBlock
          key={item.key}
          toolName={toolPart.toolName ?? toolPart.type.replace('tool-', '')}
          toolCallId={toolPart.toolCallId}
          state={toolPart.state}
          input={toolPart.input}
          output={toolPart.output}
          errorText={toolPart.errorText}
        />
      )
    }
    case 'tool-group':
      return <GroupedToolCallBlock key={item.key} items={item.items} uiKind={item.uiKind} />
    default:
      return null
  }
}

/* ─── Execution Phase Fold ──────────────────────────────────────── */

function ExecutionPhaseFold({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-1">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setExpanded(v => !v)}
        className="h-6 px-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
      >
        {expanded ? 'Hide execution details' : 'Show execution details'}
      </Button>
      <AnimatePresence initial={false}>
        {expanded && (
          <m.div
            key="exec-fold"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden -mx-3 px-3"
          >
            <div className="mt-1 space-y-1">
              {children}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─── Main Component ────────────────────────────────────────────── */

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

  const isFirstAppearance = !seenMessageIds.has(message.id)
  if (isFirstAppearance) {
    seenMessageIds.add(message.id)
  }

  const plainText = useMemo(() => {
    return message.parts
      .flatMap(p => p.type === 'text' ? [(p as { text: string }).text] : [])
      .join('\n')
  }, [message.parts])

  const groupedItems = useMemo(
    () => groupMessageParts(message.parts, message.id, subagentMap),
    [message.parts, message.id, subagentMap],
  )

  const executionPhaseSplit = useMemo(
    () => isStreaming ? null : splitExecutionPhase(groupedItems),
    [groupedItems, isStreaming],
  )

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

  /* ─── Render items ─── */
  function renderItem(item: ChatRenderItem) {
    switch (item.kind) {
      case 'text':
        if (isUser) {
          return (
            <span key={item.key} className="whitespace-pre-wrap wrap-break-word">
              {item.text}
            </span>
          )
        }
        return (
          <Streamdown
            key={item.key}
            content={item.text}
            streaming={isStreaming}
            animationPreset={animationPreset}
            animateMode={animateMode}
            showCursor={showCursor}
          />
        )

      case 'reasoning':
        return <ReasoningBlock key={item.key} text={item.text} state={item.state} />

      case 'tool-group':
        return (
          <GroupedToolCallBlock
            key={item.key}
            items={item.items}
            uiKind={item.uiKind}
          />
        )

      case 'tool-call':
        return (
          <ToolCallBlock
            key={item.key}
            toolName={item.part.toolName ?? item.part.type.replace('tool-', '')}
            toolCallId={item.part.toolCallId}
            state={item.part.state}
            input={item.part.input}
            output={item.part.output}
            errorText={item.part.errorText}
          >
            {item.subagentMessages.flatMap(subMsg => {
              const groupedParts = groupMessageParts(subMsg.parts, subMsg.id, undefined)
              return groupedParts.map(groupedItem => renderSubagentItem(groupedItem, isStreaming, { animationPreset, animateMode, showCursor }))
            })}
          </ToolCallBlock>
        )

      case 'file-attachment':
        return (
          <div key={item.key} className="my-1 flex items-center gap-1.5 text-xs text-muted-foreground/60">
            <UserIcon className="size-3" aria-hidden="true" />
            <span>File attachment</span>
          </div>
        )

      default:
        return null
    }
  }

  /* ─── Separate execution-phase items from final reply ─── */
  function renderContent() {
    if (!executionPhaseSplit) {
      return groupedItems.map(renderItem)
    }

    return (
      <>
        <ExecutionPhaseFold>
          {executionPhaseSplit.executionItems.map(renderItem)}
        </ExecutionPhaseFold>
        {executionPhaseSplit.finalItems.map(renderItem)}
      </>
    )
  }

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
          {renderContent()}
        </div>

        {/* Action bar — appears on hover for all messages */}
        {!isStreaming && plainText.length > 0 && (
          <div className={cn(
            'mt-1 flex items-center gap-0.5 opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-[opacity,transform] duration-150',
            isUser && 'justify-end',
          )}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleCopy}
              className="text-muted-foreground/50 hover:text-foreground"
              aria-label="Copy message"
            >
              {copied
                ? <CheckIcon className="size-3.5 text-emerald-500" aria-hidden="true" />
                : <CopyIcon className="size-3.5" aria-hidden="true" />}
            </Button>
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
