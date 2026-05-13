import { ChevronRightIcon, LayersIcon, LoaderCircleIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { cn } from '~/lib/cn'

interface SubagentFoldProps {
  /** Number of inner parts (tool calls, text blocks, reasoning blocks) */
  itemCount: number
  /** Whether the subagent is still running (has streaming parts) */
  isStreaming: boolean
  children: ReactNode
}

export function SubagentFold({ itemCount, isStreaming, children }: SubagentFoldProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-muted/50',
        )}
      >
        <LayersIcon className="size-3.5" aria-hidden="true" />
        <span className="font-medium">Subagent</span>
        <span className="text-muted-foreground/60">
          {itemCount}
          {' '}
          {itemCount === 1 ? 'item' : 'items'}
        </span>
        {isStreaming && (
          <LoaderCircleIcon className="size-3 animate-spin text-primary/70" aria-hidden="true" />
        )}
        <ChevronRightIcon
          className={cn('size-3 transition-transform duration-150', expanded && 'rotate-90')}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div className="mt-1 ml-2 border-l-2 border-primary/20 pl-3 space-y-0.5">
          {children}
        </div>
      )}
    </div>
  )
}
