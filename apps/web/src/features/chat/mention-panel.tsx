import { Fzf } from 'fzf'
import { FolderIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { WorkspaceFileIcon, WorkspaceFileIconSpriteSheet } from '~/components/common/workspace-file-icon'
import { DelayedSpinner } from '~/components/ui/spinner'
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
  searchItems?: (query: string, signal?: AbortSignal) => Promise<MentionItem[]>
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

export function MentionPanel({ items, query, searchItems, onSelect, onClose, visible }: MentionPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [remoteItems, setRemoteItems] = useState<MentionItem[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  const previousQueryRef = useRef(query)
  const requestSeqRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const effectiveItems = searchItems ? remoteItems : items

  // Build the fzf index once per items change; reuse for each query.
  const fzfIndex = useMemo(
    () => new Fzf(effectiveItems, { selector: (item: MentionItem) => item.path, limit: MAX_RESULTS }),
    [effectiveItems],
  )

  // Fuzzy search with fzf
  const results = useMemo(() => {
    if (!query) {
      return effectiveItems.slice(0, MAX_RESULTS).map(item => ({ item, positions: new Set<number>() }))
    }
    return fzfIndex.find(query)
  }, [fzfIndex, query, effectiveItems])

  const effectiveActiveIndex = previousQueryRef.current === query ? activeIndex : 0
  previousQueryRef.current = query

  useEffect(() => {
    setActiveIndex(0)
  }, [items, query, visible])

  useEffect(() => {
    if (!visible || !searchItems) {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      setRemoteItems([])
      setRemoteLoading(false)
      return
    }

    const requestSeq = requestSeqRef.current + 1
    requestSeqRef.current = requestSeq
    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    setRemoteLoading(true)
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const nextItems = await searchItems(query, abortController.signal)
          if (requestSeqRef.current === requestSeq) {
            setRemoteItems(nextItems)
          }
        }
        catch (error) {
          if (requestSeqRef.current === requestSeq && !abortController.signal.aborted) {
            console.error('[MentionPanel] failed to search workspace files:', error)
            setRemoteItems([])
          }
        }
        finally {
          if (requestSeqRef.current === requestSeq) {
            setRemoteLoading(false)
          }
        }
      })()
    }, 80)

    return () => {
      window.clearTimeout(timeoutId)
      abortController.abort()
    }
  }, [query, searchItems, visible])

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    const active = list.children[effectiveActiveIndex] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest' })
  }, [effectiveActiveIndex])

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
    else if ((e.key === 'Enter' || e.key === 'Tab') && results[effectiveActiveIndex]) {
      e.preventDefault()
      setActiveIndex(0)
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

  if (!visible || (results.length === 0 && !remoteLoading)) {
    return null
  }

  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-1.5 max-h-64 overflow-hidden rounded-xl border border-border bg-popover/95 shadow-xs backdrop-blur-md">
      <WorkspaceFileIconSpriteSheet />
      <div
        ref={listRef}
        className="max-h-64 overflow-y-auto p-1"
        role="listbox"
      >
        {remoteLoading && results.length === 0 && (
          <div className="flex h-9 items-center justify-center">
            <DelayedSpinner active delayMs={180} className="size-3.5 text-muted-foreground" />
          </div>
        )}
        {results.map(({ item, positions }, idx) => (
          <button
            key={item.path}
            type="button"
            role="option"
            aria-selected={idx === effectiveActiveIndex}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs',
              idx === effectiveActiveIndex
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground/80 hover:bg-accent/40',
            )}
            onMouseEnter={() => setActiveIndex(idx)}
            onClick={() => handleOptionClick(item)}
          >
            {item.type === 'directory'
              ? <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              : <WorkspaceFileIcon path={item.path} className="size-3.5 text-muted-foreground/60" />}
            <span className="min-w-0 truncate">
              <HighlightedText text={item.path} positions={positions} />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
