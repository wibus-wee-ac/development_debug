// Input: UIMessage from ai, Streamdown renderer, ReasoningBlock, ToolCallBlock, motion
// Output: MessageBubble — animated message with parts rendering and action bar
// Position: Core display component in chat feature for rendering individual messages

import { cn } from '@renderer/lib/utils'
import type { UIMessage } from 'ai'
import { CheckIcon, CopyIcon, UserIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useMemo, useState } from 'react'
import { Streamdown } from 'streamdown'

import { ReasoningBlock } from './reasoning-block'
import { ToolCallBlock } from './tool-call-block'

const BUBBLE_TRANSITION = { type: 'spring', stiffness: 500, damping: 35, mass: 0.8 } as const

interface MessageBubbleProps {
  message: UIMessage
  isStreaming: boolean
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const [copied, setCopied] = useState(false)

  // Extract plain text only (no reasoning/thinking) for copy
  const plainText = useMemo(() => {
    return message.parts
      .filter(p => p.type === 'text')
      .map(p => (p as { text: string }).text)
      .join('\n')
  }, [message.parts])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(plainText)
    setCopied(true)
    const timer = setTimeout(setCopied, 1500, false)
    return () => clearTimeout(timer)
  }, [plainText])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={BUBBLE_TRANSITION}
      className={cn(
        'group flex w-full gap-3',
        isUser && 'justify-end',
      )}
    >
      <div
        className={cn(
          'max-w-[85%] min-w-0',
          isUser && 'max-w-[70%]',
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
                  animated
                  isAnimating={isStreaming}
                >
                  {part.text}
                </Streamdown>
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
              return (
                <ToolCallBlock
                  key={key}
                  toolName={toolPart.toolName ?? toolPart.type.replace('tool-', '')}
                  toolCallId={toolPart.toolCallId}
                  state={toolPart.state as 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | 'output-denied' | 'approval-requested' | 'approval-responded'}
                  input={toolPart.input}
                  output={toolPart.output}
                  errorText={toolPart.errorText}
                />
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
          )}>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label="复制"
            >
              {copied
                ? <CheckIcon className="size-3 text-emerald-500" aria-hidden="true" />
                : <CopyIcon className="size-3" aria-hidden="true" />}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  )
}
