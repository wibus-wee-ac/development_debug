// Input: UIMessage parts (reasoning), Streamdown, cn utility, lucide icons
// Output: ReasoningBlock — collapsible inline thinking chain display with Markdown
// Position: Sub-component of message bubble for rendering reasoning/thinking parts

import { cn } from '@renderer/lib/cn'
import { BrainIcon, ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import { Streamdown } from 'streamdown'

interface ReasoningBlockProps {
  text: string
  state?: 'streaming' | 'done'
}

export function ReasoningBlock({ text, state }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const isStreaming = state === 'streaming'

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
          'text-muted-foreground/70 hover:text-foreground hover:bg-muted/50',
        )}
      >
        <BrainIcon className={cn('size-3.5', isStreaming && 'animate-pulse text-primary/70')} aria-hidden="true" />
        <span>{isStreaming ? '思考中...' : '思考过程'}</span>
        <ChevronRightIcon
          className={cn('size-3 transition-transform duration-150', expanded && 'rotate-90')}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div className="mt-1 ml-2 border-l-2 border-muted pl-3 text-xs text-muted-foreground/60 leading-relaxed">
          <Streamdown animated isAnimating={isStreaming}>
            {text}
          </Streamdown>
        </div>
      )}
    </div>
  )
}
