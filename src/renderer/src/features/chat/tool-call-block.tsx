// Input: UIMessage tool parts, cn utility, lucide icons
// Output: ToolCallBlock — collapsible inline tool invocation display
// Position: Sub-component of message bubble for rendering tool call/result parts

import { cn } from '@renderer/lib/utils'
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
import { useState } from 'react'

const TOOL_ICONS: Record<string, typeof WrenchIcon> = {
  read_file: FileSearchIcon,
  write_file: FileEditIcon,
  edit_file: FileEditIcon,
  search: SearchIcon,
  grep: SearchIcon,
  bash: TerminalIcon,
  shell: TerminalIcon,
  terminal: TerminalIcon,
}

function getToolIcon(toolName: string) {
  for (const [key, icon] of Object.entries(TOOL_ICONS)) {
    if (toolName.toLowerCase().includes(key)) {
      return icon
    }
  }
  return WrenchIcon
}

type ToolState
  = 'input-streaming'
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
}

export function ToolCallBlock({
  toolName,
  state,
  input,
  output,
  errorText,
}: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const Icon = getToolIcon(toolName)

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
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
          'text-muted-foreground/70 hover:text-foreground hover:bg-muted/50',
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        <span className="font-medium">{toolName}</span>
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
        <div className="mt-1 ml-2 space-y-1.5 border-l-2 border-muted pl-3 text-xs">
          {input !== undefined && (
            <div>
              <span className="text-muted-foreground/50 text-[10px] uppercase tracking-wider">Input</span>
              <pre className="mt-0.5 max-h-40 overflow-auto rounded bg-muted/30 p-2 text-muted-foreground/70 whitespace-pre-wrap break-all">
                {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {output !== undefined && (
            <div>
              <span className="text-muted-foreground/50 text-[10px] uppercase tracking-wider">Output</span>
              <pre className="mt-0.5 max-h-40 overflow-auto rounded bg-muted/30 p-2 text-muted-foreground/70 whitespace-pre-wrap break-all">
                {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
              </pre>
            </div>
          )}
          {errorText && (
            <div>
              <span className="text-destructive/70 text-[10px] uppercase tracking-wider">Error</span>
              <pre className="mt-0.5 rounded bg-destructive/5 p-2 text-destructive/80 whitespace-pre-wrap break-all">
                {errorText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
