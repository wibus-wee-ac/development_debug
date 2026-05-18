// Input: Reasoning/thinking text and streaming state
// Output: A collapsible brain-icon block rendering thinking content via Streamdown
// Position: apps/web/src/features/chat/blocks/reasoning-block.tsx

import { useId, useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { Streamdown } from '@cradle/streamdown'
import { useStreamdownStore } from '~/store/streamdown'
import { cn } from '~/lib/cn'

interface ReasoningBlockProps {
  text: string
  state?: 'streaming' | 'done'
}

function BrainSvg({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z" />
      <path d="M9 21h6" />
      <path d="M10 17v4" />
      <path d="M14 17v4" />
      <path d="M8.5 10c0-1 .5-2 1.5-2.5" />
      <path d="M15.5 10c0-1-.5-2-1.5-2.5" />
    </svg>
  )
}

export function ReasoningBlock({ text, state = 'done' }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const { animationPreset, animateMode, showCursor } = useStreamdownStore()

  return (
    <div className="py-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={contentId}
        className={cn(
          'flex items-center gap-1.5 text-xs transition-colors duration-150',
          expanded ? 'text-muted-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground',
        )}
      >
        <BrainSvg
          className={cn(
            'size-4',
            state === 'streaming' && 'animate-pulse',
            state === 'done' && 'opacity-60',
          )}
        />
        <span>Thinking</span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            id={contentId}
            className="overflow-hidden"
          >
            <div className="relative pt-2 pl-5">
              <div className="text-sm text-muted-foreground/70 leading-relaxed">
                <Streamdown
                  content={text}
                  streaming={state === 'streaming'}
                  animationPreset={animationPreset}
                  animateMode={animateMode}
                  showCursor={showCursor}
                />
              </div>
              {/* Bottom fade mask */}
              <div
                className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
                style={{
                  background: 'linear-gradient(to top, var(--background) 0%, transparent 100%)',
                }}
              />
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
