import { Streamdown } from '@cradle/streamdown'
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
          'group/reason flex items-center gap-1.5 rounded-sm px-0 py-0.5 text-[11px]',
          'text-muted-foreground/50 hover:text-muted-foreground transition-colors duration-150',
          'italic leading-none',
        )}
      >
        {/* Pulse dot while streaming — only indicator */}
        <span
          className={cn(
            'inline-block size-1 rounded-full flex-shrink-0',
            'transition-colors duration-300',
            isStreaming
              ? 'bg-primary/50 animate-pulse'
              : 'bg-muted-foreground/25',
          )}
          aria-hidden="true"
        />
        <span>
          {isStreaming ? 'thinking' : 'thought'}
        </span>
        <span className={cn(
          'text-[10px] not-italic opacity-0 group-hover/reason:opacity-100 transition-opacity ml-0.5',
        )}>
          {expanded ? '↑' : '↓'}
        </span>
      </button>

      {expanded && (
        <div className="overflow-hidden">
          <div
            data-testid="chat-reasoning-content"
            className="mt-1 pl-3 border-l border-border/30 text-[11px] text-muted-foreground/45 leading-relaxed italic"
            style={{
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 10px)',
            }}
          >
            <Streamdown
              content={text}
              streaming={isStreaming}
              animationPreset={animationPreset}
              animateMode={animateMode}
              showCursor={false}
            />
          </div>
        </div>
      )}
    </div>
  )
}
