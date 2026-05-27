import {
  BotIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  ClockIcon,
  Code2Icon,
  DiffIcon,
  FileSearchIcon,
  FileTextIcon,
  GitBranchIcon,
  GlobeIcon,
  HelpCircleIcon,
  ListTodoIcon,
  NotebookTabsIcon,
  PanelTopIcon,
  ServerIcon,
  SquareTerminalIcon,
} from 'lucide-react'
import { m } from 'motion/react'
import type { ComponentType } from 'react'
import { useState } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import { hasTerminalDetails } from '../terminal-tool-details'
import type { RenderableToolPart, ToolState, ToolUiKind } from '../tool-ui-classifier'
import { describeToolCall } from '../tool-ui-classifier'
import { TerminalExecutionDetails } from './tool-call-block'

const BACKSLASH_PATTERN = /\\/g

type IconComponent = ComponentType<{ 'className'?: string, 'aria-hidden'?: boolean }>

interface ToolCallItem {
  key: string
  part: RenderableToolPart
}

const TOOL_ICON_MAP: Record<ToolUiKind, IconComponent> = {
  'file-read': FileTextIcon,
  'file-diff': DiffIcon,
  'notebook-diff': NotebookTabsIcon,
  'terminal': SquareTerminalIcon,
  'search': FileSearchIcon,
  'web': GlobeIcon,
  'subagent': BotIcon,
  'task-control': ClockIcon,
  'todo': ListTodoIcon,
  'plan': PanelTopIcon,
  'question': HelpCircleIcon,
  'mcp': ServerIcon,
  'worktree': GitBranchIcon,
  'generic': Code2Icon,
}

const FILE_KINDS = new Set<ToolUiKind>(['file-read', 'file-diff', 'search', 'notebook-diff'])

const PLURAL_TITLES: Partial<Record<ToolUiKind, string>> = {
  'terminal': 'Run commands',
  'file-read': 'Read files',
  'file-diff': 'Edit files',
  'search': 'Search files',
  'notebook-diff': 'Edit notebooks',
}

function basename(value: string): string {
  return value.replace(BACKSLASH_PATTERN, '/').split('/').filter(Boolean).pop() ?? value
}

function getItemLabel(target: string | null, uiKind: ToolUiKind): string {
  if (!target) { return '—' }
  return FILE_KINDS.has(uiKind) ? basename(target) : target
}

function getOverallState(items: ToolCallItem[]): ToolState {
  const states = items.map(item => item.part.state)
  if (states.some(s => s === 'output-error' || s === 'output-denied')) { return 'output-error' }
  if (states.some(s => s === 'input-streaming' || s === 'input-available' || s === 'approval-requested')) { return 'input-available' }
  return 'output-available'
}

function ItemStatusIcon({ state }: { state: ToolState }) {
  if (state === 'output-error' || state === 'output-denied') {
    return <CircleAlertIcon className="size-3 text-destructive" aria-hidden />
  }
  if (state === 'output-available' || state === 'approval-responded') {
    return <CheckCircle2Icon className="size-3 text-emerald-500" aria-hidden />
  }
  return <ClockIcon className={cn('size-3 text-muted-foreground/60', 'animate-pulse')} aria-hidden />
}

function OverallStatusIcon({ state }: { state: ToolState }) {
  if (state === 'output-error' || state === 'output-denied') {
    return <CircleAlertIcon className="size-3.5 text-destructive" aria-hidden />
  }
  if (state === 'output-available' || state === 'approval-responded') {
    return <CheckCircle2Icon className="size-3.5 text-emerald-500" aria-hidden />
  }
  return <ClockIcon className="size-3.5 animate-pulse text-amber-500 dark:text-amber-400" aria-hidden />
}

export function GroupedToolCallBlock({ items, uiKind }: { items: ToolCallItem[], uiKind: ToolUiKind }) {
  const firstDescriptor = describeToolCall(items[0].part)
  const Icon = TOOL_ICON_MAP[uiKind]
  const overallState = getOverallState(items)
  const isRunning = overallState === 'input-available'
  const groupTitle = PLURAL_TITLES[uiKind] ?? firstDescriptor.title
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => {
    return new Set(
      items
        .filter(item => item.part.state === 'output-error' || item.part.state === 'output-denied')
        .map(item => item.key),
    )
  })

  const toggleItem = (key: string) => {
    setExpandedItems((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      }
      else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <m.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      className="py-1.5"
    >
      {/* Group header card */}
      <div className={cn(
        'overflow-hidden mx-1 -px-1 rounded-lg bg-card ring-1 ring-border',
        (overallState === 'output-error' || overallState === 'output-denied') && 'ring-1 ring-destructive/30',
      )}
      >
        <div className="flex h-8 items-center gap-2 px-3">
          <Icon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground/60',
              isRunning && 'text-amber-500 dark:text-amber-400',
            )}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/80">
            {groupTitle}
          </span>
          <span className="shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {items.length}
          </span>
          <OverallStatusIcon state={overallState} />
        </div>
        {isRunning && (
          <div className="h-px overflow-hidden bg-muted">
            <m.div
              className="h-full w-1/3 rounded-full bg-muted-foreground/25"
              animate={{ x: ['-100%', '400%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            />
          </div>
        )}
      </div>

      {/* Individual items with connector lines */}
      <div className="relative ml-3 mt-0.5">
        {/* Vertical connector line */}
        <div className="absolute left-2 top-2 bottom-2 w-px bg-border/80" />

        {items.map((item, idx) => {
          const descriptor = describeToolCall(item.part)
          const label = getItemLabel(descriptor.target, uiKind)
          const isLast = idx === items.length - 1
          const expandable = uiKind === 'terminal' && hasTerminalDetails(item.part.input, item.part.output, item.part.errorText, item.part.argumentsText)
          const expanded = expandedItems.has(item.key)
          return (
            <div key={item.key} className="relative py-0.5 pl-7">
              {/* Horizontal branch */}
              <div className={cn(
                'absolute left-2 top-1/2 -translate-y-1/2 h-px w-3 bg-border/80',
                isLast && 'top-[calc(50%-1px)]',
              )}
              />
              <button
                type="button"
                className={cn(
                  'flex min-w-0 w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px]',
                  expandable && 'transition-colors duration-100 hover:bg-muted/35 active:bg-muted/50',
                )}
                disabled={!expandable}
                aria-expanded={expandable ? expanded : undefined}
                onClick={() => toggleItem(item.key)}
              >
                {expandable && (
                  <ChevronRightIcon
                    className={cn(
                      'size-3 shrink-0 text-muted-foreground/40 transition-transform duration-200',
                      expanded && 'rotate-90',
                    )}
                    aria-hidden
                  />
                )}
                <Tooltip delayDuration={600}>
                  <TooltipTrigger asChild>
                    <span className="min-w-0 flex-1 cursor-default truncate font-mono text-foreground/70">
                      {label}
                    </span>
                  </TooltipTrigger>
                  {descriptor.target && (
                    <TooltipContent side="bottom" className="font-mono text-[11px]">
                      {descriptor.target}
                    </TooltipContent>
                  )}
                </Tooltip>
                <ItemStatusIcon state={item.part.state} />
              </button>
              {expandable && expanded && (
                <div className="mt-1 pr-1.5">
                  <TerminalExecutionDetails
                    input={item.part.input}
                    output={item.part.output}
                    errorText={item.part.errorText}
                    argumentsText={item.part.argumentsText}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </m.div>
  )
}
