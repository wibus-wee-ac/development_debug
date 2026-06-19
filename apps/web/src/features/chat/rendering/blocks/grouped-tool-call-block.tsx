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
  ListChecksIcon,
  ListTodoIcon,
  NotebookTabsIcon,
  PanelTopIcon,
  ServerIcon,
  SquareTerminalIcon,
} from 'lucide-react'
import { m } from 'motion/react'
import type { ComponentType } from 'react'
import { useState } from 'react'

import { cn } from '~/lib/cn'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import { hasTerminalDetails } from '../terminal-tool-details'
import type { RenderableToolPart, ToolState, ToolUiKind } from '../tool-ui-classifier'
import { describeToolCall, readToolInputPayload, readToolPayload } from '../tool-ui-classifier'
import {
  FileDiffExecutionDetails,
  hasFileDiffInlineContent,
  readFileDiffPayload,
  readFileDiffTarget,
  TerminalExecutionDetails,
} from './tool-call-block'

const BACKSLASH_PATTERN = /\\/g
const LINE_BREAK_PATTERN = /\r?\n/

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
  'plan-implementation': ListChecksIcon,
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

function isDiffKind(uiKind: ToolUiKind): boolean {
  return uiKind === 'file-diff' || uiKind === 'notebook-diff'
}

function hasExpandableDetails(part: RenderableToolPart, uiKind: ToolUiKind): boolean {
  if (uiKind === 'terminal') {
    return hasTerminalDetails(part.input, part.output, part.errorText, part.argumentsText)
  }
  if (isDiffKind(uiKind)) {
    if (part.errorText) {
      return true
    }
    const payload = readFileDiffPayload(part.input, part.output, part.argumentsText)
    return hasFileDiffInlineContent(payload.input, payload.output)
  }
  return false
}

function basename(value: string): string {
  return value.replace(BACKSLASH_PATTERN, '/').split('/').filter(Boolean).pop() ?? value
}

function readFirstLine(value: string | null): string | null {
  if (!value) {
    return null
  }
  return value.split(LINE_BREAK_PATTERN, 1)[0] ?? value
}

function getItemLabel(part: RenderableToolPart, target: string | null, uiKind: ToolUiKind): string {
  if (uiKind === 'terminal') {
    const input = readToolInputPayload(part.input, part.argumentsText)
    const output = readToolPayload(part.output)
    return readFirstLine(input.command ?? output.command ?? target) ?? '—'
  }

  if (!target) { return '—' }
  return FILE_KINDS.has(uiKind) ? basename(target) : target
}

function getOverallState(items: ToolCallItem[]): ToolState {
  const states = items.map(item => item.part.state)
  if (states.some(s => s === 'output-error' || s === 'output-denied')) { return 'output-error' }
  if (states.some(s => s === 'input-streaming' || s === 'input-available' || s === 'approval-requested')) { return 'input-available' }
  return 'output-available'
}

function ItemStatusIcon({ state, animated = true }: { state: ToolState, animated?: boolean }) {
  if (state === 'output-error' || state === 'output-denied') {
    return <CircleAlertIcon className="size-3 text-destructive" aria-hidden />
  }
  if (state === 'output-available' || state === 'approval-responded') {
    return <CheckCircle2Icon className="size-3 text-emerald-500" aria-hidden />
  }
  return <ClockIcon className={cn('size-3 text-muted-foreground/60', animated && 'animate-pulse')} aria-hidden />
}

function OverallStatusIcon({ state, animated = true }: { state: ToolState, animated?: boolean }) {
  if (state === 'output-error' || state === 'output-denied') {
    return <CircleAlertIcon className="size-3.5 text-destructive" aria-hidden />
  }
  if (state === 'output-available' || state === 'approval-responded') {
    return <CheckCircle2Icon className="size-3.5 text-emerald-500" aria-hidden />
  }
  return <ClockIcon className={cn('size-3.5 text-amber-500 dark:text-amber-400', animated && 'animate-pulse')} aria-hidden />
}

export function GroupedToolCallBlock({
  items,
  uiKind,
  animated = true,
  workspaceDiffTarget,
}: {
  items: ToolCallItem[]
  uiKind: ToolUiKind
  animated?: boolean
  workspaceDiffTarget?: { workspaceId: string, ownerId?: string | null }
}) {
  const firstDescriptor = describeToolCall(items[0].part)
  const Icon = TOOL_ICON_MAP[uiKind]
  const overallState = getOverallState(items)
  const isRunning = overallState === 'input-available'
  const groupTitle = PLURAL_TITLES[uiKind] ?? firstDescriptor.title
  const openWorkspaceDiffTab = useBrowserPanelStore(s => s.openWorkspaceDiffTab)
  const requestScrollToFilePath = useBrowserPanelStore(s => s.requestScrollToFilePath)
  const setBrowserPanelOpen = useLayoutStore(s => s.setBrowserPanelOpen)
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

  const openWorkspaceDiff = (path: string) => {
    if (!workspaceDiffTarget) {
      return
    }
    const tabId = openWorkspaceDiffTab({
      workspaceId: workspaceDiffTarget.workspaceId,
      title: 'All Changes',
      ownerId: workspaceDiffTarget.ownerId,
    })
    setBrowserPanelOpen(true, workspaceDiffTarget.ownerId)
    requestScrollToFilePath({ path, tabId })
  }

  const content = (
    <>
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
          <OverallStatusIcon state={overallState} animated={animated} />
        </div>
        {isRunning && (
          <div className="h-px overflow-hidden bg-muted">
            {animated
              ? (
                  <m.div
                    className="h-full w-1/3 rounded-full bg-muted-foreground/25"
                    animate={{ x: ['-100%', '400%'] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  />
                )
              : <div className="h-full w-1/3 rounded-full bg-muted-foreground/25" />}
          </div>
        )}
      </div>

      {/* Individual items with connector lines */}
      <div className="relative ml-3 mt-0.5">
        {/* Vertical connector line */}
        <div className="absolute left-2 top-2 bottom-2 w-px bg-border/80" />

        {items.map((item, idx) => {
          const descriptor = describeToolCall(item.part)
          const label = getItemLabel(item.part, descriptor.target, uiKind)
          const isLast = idx === items.length - 1
          const expandable = hasExpandableDetails(item.part, uiKind)
          const workspaceDiffPath = isDiffKind(uiKind)
            ? readFileDiffTarget(item.part.input, item.part.output, item.part.argumentsText)
            : null
          const canOpenWorkspaceDiff = !!workspaceDiffTarget && !!workspaceDiffPath
          const interactive = expandable || canOpenWorkspaceDiff
          const expanded = expandedItems.has(item.key)
          const handleItemClick = () => {
            if (expandable) {
              toggleItem(item.key)
              return
            }
            if (workspaceDiffPath) {
              openWorkspaceDiff(workspaceDiffPath)
            }
          }
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
                  interactive && 'transition-colors duration-100 hover:bg-muted/35 active:bg-muted/50',
                )}
                disabled={!interactive}
                aria-expanded={expandable ? expanded : undefined}
                onClick={handleItemClick}
              >
                {expandable && (
                  <ChevronRightIcon
                    className={cn(
                      'size-3 shrink-0 text-muted-foreground/40',
                      animated && 'transition-transform duration-200',
                      expanded && 'rotate-90',
                    )}
                    aria-hidden
                  />
                )}
                <span className={cn(
                  'min-w-0 flex-1 cursor-default font-mono text-foreground/70',
                  animated ? 'truncate' : 'whitespace-normal break-all',
                )}
                >
                  {label}
                </span>
                <ItemStatusIcon state={item.part.state} animated={animated} />
              </button>
              {expandable && expanded && (
                <div className="mt-1 pr-1.5">
                  {uiKind === 'terminal'
                    ? (
                        <TerminalExecutionDetails
                          input={item.part.input}
                          output={item.part.output}
                          errorText={item.part.errorText}
                          argumentsText={item.part.argumentsText}
                        />
                      )
                    : (
                        <FileDiffExecutionDetails
                          input={item.part.input}
                          output={item.part.output}
                          errorText={item.part.errorText}
                          argumentsText={item.part.argumentsText}
                          state={item.part.state}
                        />
                      )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )

  if (!animated) {
    return <div className="py-1.5">{content}</div>
  }

  return (
    <div
      // initial={{ opacity: 0, y: 4 }}
      // animate={{ opacity: 1, y: 0 }}
      // transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      className="py-1.5"
    >
      {content}
    </div>
  )
}
