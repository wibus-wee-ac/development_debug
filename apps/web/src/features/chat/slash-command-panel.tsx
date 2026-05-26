import { CommandIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '~/lib/cn'

import type { ChatComposerSlashCommand } from './chat-slash-commands'
import { getSlashCommandSourceLabel, hasDuplicateSlashCommandName } from './chat-slash-commands'
import { getSlashCommandPanelItems, isSlashCommandAvailable } from './slash-command-input'

interface SlashCommandPanelProps {
  commands: ChatComposerSlashCommand[]
  query: string
  listboxId?: string
  onActiveOptionIdChange?: (optionId: string | undefined) => void
  onSelect: (command: ChatComposerSlashCommand) => void
  onClose: () => void
  visible: boolean
}

const MAX_RESULTS = 24
const UNSAFE_OPTION_ID_CHAR_RE = /[^\w-]/g

function formatCommandSubtitle(commands: ChatComposerSlashCommand[], command: ChatComposerSlashCommand): string {
  const aliases = command.aliases?.length ? `Aliases: ${command.aliases.map(alias => `/${alias}`).join(', ')}` : ''
  return [command.description, command.availability?.enabled === false ? command.availability.reason : '', aliases].filter(Boolean).join(' · ')
}

function formatSlashCommandOptionId(command: ChatComposerSlashCommand, index: number): string {
  return `chat-slash-command-${formatCommandKey(command, index).replace(UNSAFE_OPTION_ID_CHAR_RE, '-')}`
}

function formatCommandKey(command: ChatComposerSlashCommand, index: number): string {
  return command.id || `${command.source}:${command.name}:${index}`
}

function getCommandBadge(commands: ChatComposerSlashCommand[], command: ChatComposerSlashCommand): string {
  return hasDuplicateSlashCommandName(commands, command) ? getSlashCommandSourceLabel(command) : ''
}

function getCommandBadgeClassName(command: ChatComposerSlashCommand): string {
  return command.source === 'runtime'
    ? 'border-primary/20 bg-primary/10 text-primary'
    : 'border-border bg-muted text-muted-foreground'
}

export function SlashCommandPanel({ commands, listboxId, onActiveOptionIdChange, query, onSelect, onClose, visible }: SlashCommandPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  const previousQueryRef = useRef(query)

  const results = useMemo(() => {
    return getSlashCommandPanelItems(commands, query).slice(0, MAX_RESULTS).map(item => ({ item }))
  }, [commands, query])

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
    else if ((e.key === 'Enter' || e.key === 'Tab') && results[effectiveActiveIndex] && isSlashCommandAvailable(results[effectiveActiveIndex].item)) {
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

  const handleOptionClick = useCallback((command: ChatComposerSlashCommand) => {
    if (!isSlashCommandAvailable(command)) {
      return
    }
    onSelect(command)
  }, [onSelect])

  const activeCommand = results[effectiveActiveIndex]?.item
  const activeSubtitle = activeCommand ? formatCommandSubtitle(commands, activeCommand) : ''
  const activeBadge = activeCommand ? getCommandBadge(commands, activeCommand) : ''
  const activeOptionId = activeCommand ? formatSlashCommandOptionId(activeCommand, effectiveActiveIndex) : undefined

  useEffect(() => {
    onActiveOptionIdChange?.(visible ? activeOptionId : undefined)
  }, [activeOptionId, onActiveOptionIdChange, visible])

  if (!visible || results.length === 0) {
    return null
  }

  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-1.5 max-h-72 overflow-hidden rounded-xl border border-border bg-popover shadow-xl backdrop-blur-md">
      <div className="flex max-h-72 min-h-0">
        <div
          ref={listRef}
          className="max-h-72 min-w-0 flex-1 overflow-y-auto p-1"
          id={listboxId}
          role="listbox"
        >
          {results.map(({ item }, idx) => {
            const subtitle = formatCommandSubtitle(commands, item)
            const badge = getCommandBadge(commands, item)
            const isAvailable = isSlashCommandAvailable(item)
            return (
              <button
                key={formatCommandKey(item, idx)}
                type="button"
                id={formatSlashCommandOptionId(item, idx)}
                role="option"
                aria-label={`/${item.name} ${getSlashCommandSourceLabel(item)}`}
                aria-selected={formatSlashCommandOptionId(item, idx) === activeOptionId}
                disabled={!isAvailable}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  isAvailable
                    ? idx === effectiveActiveIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground/80 hover:bg-accent/40'
                    : 'cursor-not-allowed text-muted-foreground/45 opacity-75',
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
                    {badge && (
                      <span className={cn('rounded border px-1 py-px text-[9px] font-medium leading-none', getCommandBadgeClassName(item))}>
                        {badge}
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
              {activeBadge && (
                <span className={cn('rounded border px-1 py-px text-[9px] font-medium leading-none', getCommandBadgeClassName(activeCommand))}>
                  {activeBadge}
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
