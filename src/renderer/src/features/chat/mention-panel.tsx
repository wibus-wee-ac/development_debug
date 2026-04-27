// Input: file list from IPC, fzf fuzzy matcher, keyboard events
// Output: MentionPanel — fuzzy file picker panel above composer with character-level highlighting
// Position: Sub-component of Composer for @ file mention selection

import { cn } from '@renderer/lib/cn'
import { Fzf } from 'fzf'
import { FileIcon, FolderIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  let i = 0
  while (i < text.length) {
    if (positions.has(i)) {
      // Collect consecutive highlighted chars
      let j = i
      while (j < text.length && positions.has(j)) {
        j++
      }
      parts.push(
        <span key={i} className="font-bold text-primary">
          {text.slice(i, j)}
        </span>,
      )
      i = j
    }
    else {
      // Collect consecutive non-highlighted chars
      let j = i
      while (j < text.length && !positions.has(j)) {
        j++
      }
      parts.push(<span key={i}>{text.slice(i, j)}</span>)
      i = j
    }
  }
  return <>{parts}</>
}

const MAX_RESULTS = 30

export function MentionPanel({ items, query, onSelect, onClose, visible }: MentionPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

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

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    const active = list.children[activeIndex] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
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
      else if (e.key === 'Enter' && results[activeIndex]) {
        e.preventDefault()
        onSelect(results[activeIndex].item)
      }
      else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [visible, results, activeIndex, onSelect, onClose],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!visible || results.length === 0) {
    return null
  }

  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-1.5 max-h-56 overflow-hidden rounded-xl border border-border/40 bg-popover/95 backdrop-blur-md shadow-xl">
      <div
        ref={listRef}
        className="overflow-y-auto p-1 max-h-56"
        role="listbox"
      >
        {results.map(({ item, positions }, idx) => (
          <button
            key={item.path}
            type="button"
            role="option"
            aria-selected={idx === activeIndex}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors',
              idx === activeIndex
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground/80 hover:bg-accent/40',
            )}
            onMouseEnter={() => setActiveIndex(idx)}
            onClick={() => onSelect(item)}
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
