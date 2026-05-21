import { Fzf } from 'fzf'
import { FileIcon, FolderIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '~/lib/cn'

export interface MentionItem {
  type: 'file' | 'directory'
  name: string
  /** Relative path from workspace root */
  path: string
}

interface MentionPanelProps {
  items: MentionItem[]
  query: string
  onSelect: (item: MentionItem) => void
  onClose: () => void
  visible: boolean
}

/** Render text with fuzzy-matched character positions highlighted */
function HighlightedText({ text, positions }: { text: string, positions: Set<number> }) {
  if (positions.size === 0) {
    return <span>{text}</span>
  }

  const parts: React.ReactNode[] = []
  let offset = 0
  while (offset < text.length) {
    if (positions.has(offset)) {
      // Collect consecutive highlighted chars
      let end = offset
      while (end < text.length && positions.has(end)) {
        end++
      }
      parts.push(
        <span key={`hl-${offset}`} className="font-bold text-primary">
          {text.slice(offset, end)}
        </span>,
      )
      offset = end
    }
    else {
      // Collect consecutive non-highlighted chars
      let end = offset
      while (end < text.length && !positions.has(end)) {
        end++
      }
      parts.push(<span key={`t-${offset}`}>{text.slice(offset, end)}</span>)
      offset = end
    }
  }
  return <>{parts}</>
}

const MAX_RESULTS = 30

export function MentionPanel({ items, query, onSelect, onClose, visible }: MentionPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  const previousQueryRef = useRef(query)

  // Build the fzf index once per items change; reuse for each query.
  const fzfIndex = useMemo(
    () => new Fzf(items, { selector: (item: MentionItem) => item.path, limit: MAX_RESULTS }),
    [items],
  )

  // Fuzzy search with fzf
  const results = useMemo(() => {
    if (!query) {
      return items.slice(0, MAX_RESULTS).map(item => ({ item, positions: new Set<number>() }))
    }
    return fzfIndex.find(query)
  }, [fzfIndex, query, items])

  // eslint-disable-next-line react-hooks/refs -- intentional: sync ref read during render for perf
  const effectiveActiveIndex = previousQueryRef.current === query ? activeIndex : 0
  // eslint-disable-next-line react-hooks/refs -- intentional: sync ref write during render
  previousQueryRef.current = query

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    const active = list.children[effectiveActiveIndex] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest' })
  }, [effectiveActiveIndex])

  // eslint-disable-next-line react-hooks/refs -- intentional: key handler ref assigned during render
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (!visible) {
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(prev => (prev + 1) % Math.max(results.length, 1))
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => (prev - 1 + results.length) % Math.max(results.length, 1))
    }
    else if (e.key === 'Enter' && results[effectiveActiveIndex]) {
      e.preventDefault()
      onSelect(results[effectiveActiveIndex].item)
    }
    else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keyHandlerRef.current(e)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleOptionClick = useCallback((item: MentionItem) => {
    onSelect(item)
  }, [onSelect])

  if (!visible || results.length === 0) {
    return null
  }

  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-1.5 max-h-56 overflow-hidden rounded-xl border border-border/40 bg-popover/95 shadow-xl backdrop-blur-md">
      <div
        ref={listRef}
        className="max-h-56 overflow-y-auto p-1"
        role="listbox"
      >
        {results.map(({ item, positions }, idx) => (
          <button
            key={item.path}
            type="button"
            role="option"
            aria-selected={idx === effectiveActiveIndex}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
              idx === effectiveActiveIndex
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground/80 hover:bg-accent/40',
            )}
            onMouseEnter={() => setActiveIndex(idx)}
            onClick={() => handleOptionClick(item)}
          >
            {item.type === 'directory'
              ? <FolderIcon className="size-3.5 shrink-0 text-amber-500/70" aria-hidden="true" />
              : <FileIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
            <span className="min-w-0 truncate">
              <HighlightedText text={item.path} positions={positions} />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
