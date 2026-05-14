// Input: UIMessage tool parts, cn utility, lucide icons
// Output: ToolCallBlock — collapsible inline tool invocation display
// Position: Sub-component of message bubble for rendering tool call/result parts

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  FileEditIcon,
  FileSearchIcon,
  LoaderCircleIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { cn } from '~/lib/cn'

type ToolIconKind = 'file-search' | 'file-edit' | 'search' | 'terminal' | 'wrench'

const TOOL_ICON_MATCHERS: Array<{ keyword: string, iconKind: ToolIconKind }> = [
  { keyword: 'read_file', iconKind: 'file-search' },
  { keyword: 'write_file', iconKind: 'file-edit' },
  { keyword: 'edit_file', iconKind: 'file-edit' },
  { keyword: 'search', iconKind: 'search' },
  { keyword: 'grep', iconKind: 'search' },
  { keyword: 'bash', iconKind: 'terminal' },
  { keyword: 'shell', iconKind: 'terminal' },
  { keyword: 'terminal', iconKind: 'terminal' },
]

function getToolIconKind(toolName: string): ToolIconKind {
  for (const { keyword, iconKind } of TOOL_ICON_MATCHERS) {
    if (toolName.toLowerCase().includes(keyword)) {
      return iconKind
    }
  }
  return 'wrench'
}

function renderToolIcon(toolName: string, className?: string): ReactNode {
  switch (getToolIconKind(toolName)) {
    case 'file-search':
      return <FileSearchIcon className={className} aria-hidden="true" />
    case 'file-edit':
      return <FileEditIcon className={className} aria-hidden="true" />
    case 'search':
      return <SearchIcon className={className} aria-hidden="true" />
    case 'terminal':
      return <TerminalIcon className={className} aria-hidden="true" />
    default:
      return <WrenchIcon className={className} aria-hidden="true" />
  }
}

type ToolState = 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied'

interface ToolCallBlockProps {
  toolName: string
  toolCallId: string
  state: ToolState
  input?: unknown
  output?: unknown
  errorText?: string
  /** Nested content rendered inline when expanded (e.g. subagent parts). */
  children?: ReactNode
}

function formatToolPanelValue(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return value.length > 0 ? value : fallback
  }

  if (typeof value === 'undefined') {
    return fallback
  }

  return JSON.stringify(value, null, 2)
}

export function ToolCallBlock({
  toolName,
  toolCallId,
  state,
  input,
  output,
  errorText,
  children,
}: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false)

  const isRunning = state === 'input-streaming' || state === 'input-available' || state === 'approval-requested'
  const isDone = state === 'output-available'
  const isError = state === 'output-error' || state === 'output-denied'

  const StatusIcon = isRunning
    ? LoaderCircleIcon
    : isDone
      ? CheckCircle2Icon
      : isError
        ? AlertCircleIcon
        : LoaderCircleIcon

  return (
    <div className="my-0.5" data-testid={`chat-tool-call-${toolCallId}`} data-tool-name={toolName}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        data-testid={`chat-tool-call-toggle-${toolCallId}`}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors w-full text-left',
          'text-muted-foreground hover:text-foreground hover:bg-muted/50',
        )}
      >
        {renderToolIcon(toolName, 'size-3.5')}
        <span className="font-medium flex-1 w-full truncate">{toolName}</span>
        <StatusIcon
          className={cn(
            'size-3',
            isRunning && 'animate-spin text-primary/70',
            isDone && 'text-emerald-500',
            isError && 'text-destructive',
          )}
          aria-hidden="true"
        />
        <ChevronRightIcon
          className={cn('size-3 transition-transform duration-150', expanded && 'rotate-90')}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div
          className="mt-1 ml-2 space-y-1.5 border-l-2 border-muted pl-3 text-xs"
          data-testid={`chat-tool-call-content-${toolCallId}`}
        >
          {input !== undefined && (
            <div>
              <span className="text-[10px] text-muted-foreground/60">Input</span>
              <pre
                className="mt-0.5 max-h-40 overflow-auto rounded bg-muted/30 p-2 text-muted-foreground whitespace-pre-wrap break-all"
                data-testid={`chat-tool-call-input-${toolCallId}`}
              >
                {formatToolPanelValue(input, 'No input captured')}
              </pre>
            </div>
          )}
          {(output !== undefined || isDone) && (
            <div>
              <span className="text-[10px] text-muted-foreground/60">Output</span>
              <pre
                className="mt-0.5 max-h-40 overflow-auto rounded bg-muted/30 p-2 text-muted-foreground/70 whitespace-pre-wrap break-all"
                data-testid={`chat-tool-call-output-${toolCallId}`}
              >
                {formatToolPanelValue(output, 'No output captured')}
              </pre>
            </div>
          )}
          {errorText && (
            <div>
              <span className="text-[10px] text-destructive/70">Error</span>
              <pre
                className="mt-0.5 rounded bg-destructive/5 p-2 text-destructive/80 whitespace-pre-wrap break-all"
                data-testid={`chat-tool-call-error-${toolCallId}`}
              >
                {errorText}
              </pre>
            </div>
          )}
          {children && (
            <div className="mt-1.5 space-y-1">
              {children}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
