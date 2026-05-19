// Input: Runtime-native slash command list, query text, keyboard events
// Output: SlashCommandPanel — fuzzy command picker above the composer
// Position: Sub-component of Composer for Claude Agent SDK slash command discovery

import { Fzf } from 'fzf'
import { CommandIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '~/lib/cn'

import type { ChatSlashCommand } from './chat-capabilities'

interface SlashCommandPanelProps {
  commands: ChatSlashCommand[]
  query: string
  onSelect: (command: ChatSlashCommand) => void
  onClose: () => void
  visible: boolean
}

const MAX_RESULTS = 24

function formatCommandSubtitle(command: ChatSlashCommand): string {
  const aliases = command.aliases?.length ? `Aliases: ${command.aliases.map(alias => `/${alias}`).join(', ')}` : ''
  if (command.description && aliases) {
    return `${command.description} · ${aliases}`
  }
  return command.description || aliases
}

export function SlashCommandPanel({ commands, query, onSelect, onClose, visible }: SlashCommandPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  const previousQueryRef = useRef(query)

  const fzfIndex = useMemo(
    () => new Fzf(commands, {
      selector: command => `${command.name} ${command.description} ${command.argumentHint} ${(command.aliases ?? []).join(' ')}`,
      limit: MAX_RESULTS,
    }),
    [commands],
  )

  const results = useMemo(() => {
    if (!query) {
      return commands.slice(0, MAX_RESULTS).map(item => ({ item }))
    }
    return fzfIndex.find(query).map(result => ({ item: result.item }))
  }, [commands, fzfIndex, query])

  // eslint-disable-next-line react-hooks/refs -- intentional: sync ref read during render for perf
  const effectiveActiveIndex = previousQueryRef.current === query ? activeIndex : 0
  // eslint-disable-next-line react-hooks/refs -- intentional: sync ref write during render
  previousQueryRef.current = query

  useEffect(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    const active = list.children[effectiveActiveIndex] as HTMLElement | undefined
    if (typeof active?.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' })
    }
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

  const handleOptionClick = useCallback((command: ChatSlashCommand) => {
    onSelect(command)
  }, [onSelect])

  if (!visible || results.length === 0) {
    return null
  }

  const activeCommand = results[effectiveActiveIndex]?.item
  const activeSubtitle = activeCommand ? formatCommandSubtitle(activeCommand) : ''

  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-1.5 max-h-72 overflow-hidden rounded-xl border border-border bg-popover shadow-xl backdrop-blur-md">
      <div
        className="flex max-h-72 min-h-0"
      >
        <div
          ref={listRef}
          className="max-h-72 min-w-0 flex-1 overflow-y-auto p-1"
          role="listbox"
        >
          {results.map(({ item }, idx) => {
            const subtitle = formatCommandSubtitle(item)
            return (
              <button
                key={idx}
                type="button"
                role="option"
                aria-selected={idx === effectiveActiveIndex}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  idx === effectiveActiveIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground/80 hover:bg-accent/40',
                )}
                onMouseEnter={() => setActiveIndex(idx)}
                onFocus={() => setActiveIndex(idx)}
                onClick={() => handleOptionClick(item)}
              >
                <CommandIcon className="mt-0.5 size-3.5 shrink-0 text-primary/70" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate text-xs font-medium">
                      /
                      {item.name}
                    </span>
                    {item.argumentHint && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {item.argumentHint}
                      </span>
                    )}
                  </span>
                  {subtitle && (
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {subtitle}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
        {activeCommand && (
          <aside
            className="hidden w-64 shrink-0 border-l border-border/40 bg-background/35 p-3 sm:block"
            data-testid="slash-command-description"
          >
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate font-mono text-xs font-medium text-foreground">
                /
                {activeCommand.name}
              </span>
              {activeCommand.argumentHint && (
                <span className="truncate font-mono text-[11px] text-primary/75">
                  {activeCommand.argumentHint}
                </span>
              )}
            </div>
            {activeSubtitle && (
              <p className="mt-2 text-pretty text-xs leading-5 text-muted-foreground">
                {activeSubtitle}
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
