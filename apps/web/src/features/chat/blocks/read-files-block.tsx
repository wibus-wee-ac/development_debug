import { useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { cn } from '~/lib/cn'

interface ReadFilesBlockProps {
  paths: string[]
}

const MAX_VISIBLE = 5

export function ReadFilesBlock({ paths }: ReadFilesBlockProps) {
  const [expanded, setExpanded] = useState(false)

  const visiblePaths = expanded ? paths : paths.slice(0, MAX_VISIBLE)
  const hiddenCount = paths.length - MAX_VISIBLE

  return (
    <div className="py-2">
      <span className="text-xs text-muted-foreground/60 mb-1.5 block">
        Files accessed
      </span>
      <div className="flex flex-col gap-0.5">
        <AnimatePresence initial={true}>
          {visiblePaths.map((path, i) => (
            <m.button
              key={path}
              type="button"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{
                duration: 0.2,
                delay: i * 0.03,
                ease: [0.25, 0.1, 0.25, 1],
              }}
              className={cn(
                'text-left font-mono text-sm text-muted-foreground',
                'py-0.5 px-1 -mx-1 rounded-sm',
                'transition-colors duration-150',
                'hover:text-foreground',
                'cursor-pointer',
              )}
            >
              {path}
            </m.button>
          ))}
        </AnimatePresence>
      </div>
      {hiddenCount > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={expanded}
          className="text-xs text-muted-foreground/50 hover:text-muted-foreground mt-1 transition-colors duration-150"
        >
          and {hiddenCount} more...
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded={expanded}
          className="text-xs text-muted-foreground/50 hover:text-muted-foreground mt-1 transition-colors duration-150"
        >
          show less
        </button>
      )}
    </div>
  )
}
