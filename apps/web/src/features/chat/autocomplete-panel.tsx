// Output: Shared composer autocomplete popover with fuzzy search and keyboard selection.
// Input: Trigger-specific item adapters from mention, skill, and future composer pickers.
// Position: Feature/chat UI primitive shared by composer-owned autocomplete surfaces.

import { Fzf } from 'fzf'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DelayedSpinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

export interface AutocompletePanelItem {
  id: string
  searchText: string
}

interface AutocompletePanelProps<TItem extends AutocompletePanelItem> {
  items: TItem[]
  query: string
  searchItems?: (query: string, signal?: AbortSignal) => Promise<TItem[]>
  onSelect: (item: TItem) => void
  onClose: () => void
  visible: boolean
  maxResults?: number
  emptyLogLabel: string
  renderItem: (input: {
    item: TItem
    positions: Set<number>
    active: boolean
  }) => React.ReactNode
}

export function HighlightedAutocompleteText({ text, positions }: { text: string, positions: Set<number> }) {
  if (positions.size === 0) {
    return <span>{text}</span>
  }

  const parts: React.ReactNode[] = []
  let offset = 0
  while (offset < text.length) {
    if (positions.has(offset)) {
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

export function AutocompletePanel<TItem extends AutocompletePanelItem>({
  items,
  query,
  searchItems,
  onSelect,
  onClose,
  visible,
  maxResults = 30,
  emptyLogLabel,
  renderItem,
}: AutocompletePanelProps<TItem>) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [remoteItems, setRemoteItems] = useState<TItem[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  const previousQueryRef = useRef(query)
  const requestSeqRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const effectiveItems = searchItems ? remoteItems : items

  const fzfIndex = useMemo(
    () => new Fzf(effectiveItems as AutocompletePanelItem[], { selector: item => item.searchText, limit: maxResults }),
    [effectiveItems, maxResults],
  )

  const results = useMemo(() => {
    if (!query) {
      return effectiveItems.slice(0, maxResults).map(item => ({ item, positions: new Set<number>() }))
    }
    return fzfIndex.find(query).map(result => ({ ...result, item: result.item as TItem }))
  }, [effectiveItems, fzfIndex, maxResults, query])

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
            console.error(`[AutocompletePanel] failed to search ${emptyLogLabel}:`, error)
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
  }, [emptyLogLabel, query, searchItems, visible])

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

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  const handleOptionClick = useCallback((item: TItem) => {
    onSelect(item)
  }, [onSelect])

  if (!visible || (results.length === 0 && !remoteLoading)) {
    return null
  }

  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-1.5 max-h-64 overflow-hidden rounded-xl border border-border bg-popover/95 shadow-xs backdrop-blur-md">
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
            key={item.id}
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
            onMouseDown={event => event.preventDefault()}
            onClick={() => handleOptionClick(item)}
          >
            {renderItem({ item, positions, active: idx === effectiveActiveIndex })}
          </button>
        ))}
      </div>
    </div>
  )
}
