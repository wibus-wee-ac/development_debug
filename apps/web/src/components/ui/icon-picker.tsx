import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SearchIcon, XIcon } from 'lucide-react'

import { cn } from '~/lib/cn'
import { getLobeIconUrl, iconCatalog, searchIcons } from '~/lib/lobe-icons'
import type { IconCatalogEntry } from '~/lib/lobe-icons'
import { useResolvedThemeMode } from '~/store/theme'

import { Popover, PopoverContent, PopoverTrigger } from './popover'

// ── Lazy PNG icon renderer ──

function IconImage({ slug, className }: { slug: string, className?: string }) {
  const theme = useResolvedThemeMode()
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setUrl(null)
    getLobeIconUrl(slug, theme).then((u) => {
      if (!cancelled) {
        setUrl(u)
      }
    })
    return () => {
      cancelled = true
    }
  }, [slug, theme])

  if (!url) {
    return <div className={cn('animate-pulse rounded bg-muted', className)} />
  }

  return (
    <img
      src={url}
      alt={slug}
      className={cn(
        'object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.16)] dark:drop-shadow-[0_1px_1px_rgba(255,255,255,0.14)]',
        className,
      )}
    />
  )
}

// ── Icon Picker ──

export interface IconPickerProps {
  value: string | null
  onChange: (slug: string | null) => void
  children: React.ReactNode
  disabled?: boolean
}

export function IconPicker({ value, onChange, children, disabled }: IconPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return iconCatalog
    }
    return searchIcons(query)
  }, [query])

  const handleSelect = useCallback((entry: IconCatalogEntry) => {
    onChange(entry.slug)
    setOpen(false)
    setQuery('')
  }, [onChange])

  const handleRemove = useCallback(() => {
    onChange(null)
    setOpen(false)
    setQuery('')
  }, [onChange])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-0"
      >
        {/* Search */}
        <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search icons..."
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-muted-foreground/60 hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>

        {/* Remove option */}
        {value && (
          <button
            type="button"
            onClick={handleRemove}
            className="flex w-full items-center gap-2 border-b border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-fill hover:text-foreground"
          >
            <XIcon className="size-3" />
            Remove custom icon
          </button>
        )}

        {/* Grid */}
        <div className="grid max-h-72 grid-cols-6 gap-1 overflow-y-auto p-2">
          {filtered.map(entry => (
            <button
              key={entry.slug}
              type="button"
              title={entry.title}
              onClick={() => handleSelect(entry)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md px-1 py-1.5 transition-colors hover:bg-fill',
                value === entry.slug && 'bg-fill ring-1 ring-foreground/10',
              )}
            >
              <IconImage slug={entry.slug} className="size-6" />
              <span className="w-full truncate text-center text-[9px] leading-tight text-muted-foreground/70">
                {entry.title}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-6 py-6 text-center text-xs text-muted-foreground/60">
              No icons found
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
