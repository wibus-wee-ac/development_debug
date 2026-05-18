// Input: UIMessage parts (reasoning), Streamdown, cn utility, lucide icons
// Output: ReasoningBlock — collapsible inline thinking chain display with Markdown
// Position: Sub-component of message bubble for rendering reasoning/thinking parts

import { Streamdown } from '@cradle/streamdown'
import { BrainIcon, ChevronRightIcon } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useState } from 'react'

import { cn } from '~/lib/cn'
import { useStreamdownStore } from '~/store/streamdown'

interface ReasoningBlockProps {
  text: string
  state?: 'streaming' | 'done'
}

export function ReasoningBlock({ text, state }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const isStreaming = state === 'streaming'
  const { animationPreset, animateMode } = useStreamdownStore()

  return (
    <div className="my-1" data-testid="chat-reasoning-block">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        data-testid="chat-reasoning-toggle"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-muted/50',
        )}
      >
        <BrainIcon className={cn('size-3.5', isStreaming && 'animate-pulse text-primary/70')} aria-hidden="true" />
        <span>{isStreaming ? '思考中...' : '思考过程'}</span>
        <ChevronRightIcon
          className={cn('size-3 transition-transform duration-150', expanded && 'rotate-90')}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <m.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
            className="overflow-hidden"
          >
            <div
              data-testid="chat-reasoning-content"
              className="mt-1 ml-2 border-l-2 border-muted pl-3 text-xs text-muted-foreground leading-relaxed"
            >
              <Streamdown
                content={text}
                streaming={isStreaming}
                animationPreset={animationPreset}
                animateMode={animateMode}
                showCursor={false}
              />
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
