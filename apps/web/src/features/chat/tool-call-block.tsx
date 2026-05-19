// Input: UIMessage tool parts, cn utility
// Output: ToolCallBlock — ambient inline tool step, status via left-rail color
// Position: Sub-component of message bubble for rendering tool call/result parts

import { AnimatePresence, m } from 'motion/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { cn } from '~/lib/cn'

const TOOL_LABEL_PATTERNS: Array<readonly [RegExp, string]> = [
  [/read_file/, 'Reading'],
  [/write_file/, 'Writing'],
  [/edit_file/, 'Editing'],
  [/search/, 'Searching'],
  [/grep/, 'Grepping'],
  [/bash|shell|terminal/, 'Running'],
]

function getToolLabel(toolName: string): string {
  const lower = toolName.toLowerCase()
  for (const [pattern, label] of TOOL_LABEL_PATTERNS) {
    if (pattern.test(lower)) return label
  }
  return 'Using'
}

function getToolTarget(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  const candidate = obj.path ?? obj.file ?? obj.filename ?? obj.command ?? obj.query
  if (typeof candidate === 'string' && candidate.length > 0) {
    // Trim long paths to last segment
    const parts = candidate.split('/')
    return parts.at(-1) ?? candidate
  }
  return null
}

type ToolState =
  | 'input-streaming'
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
  children?: ReactNode
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'undefined') return ''
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
  const isDone = state === 'output-available' || state === 'approval-responded'
  const isError = state === 'output-error' || state === 'output-denied'

  const label = getToolLabel(toolName)
  const target = getToolTarget(input)

  return (
    <div
      className="my-0.5"
      data-testid={`chat-tool-call-${toolCallId}`}
      data-tool-name={toolName}
    >
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        data-testid={`chat-tool-call-toggle-${toolCallId}`}
        className={cn(
          'group/tool relative flex items-center gap-2 pl-3 pr-2 py-1 rounded-sm w-full text-left',
          'transition-colors duration-200',
          'hover:bg-muted/40',
          // State-driven opacity — done steps recede
          isDone && 'opacity-50 hover:opacity-100',
        )}
      >
        {/* Status rail — the sole visual indicator of state */}
        <span
          className={cn(
            'absolute left-0 top-1 bottom-1 w-[2px] rounded-full',
            'transition-colors duration-500',
            isRunning && 'bg-amber-400/70',
            isDone && 'bg-emerald-500/40',
            isError && 'bg-destructive/60',
            // Shimmer sweep on the rail while running
            isRunning && 'animate-[shimmer_1.4s_linear_infinite]',
          )}
          aria-hidden="true"
          style={isRunning ? {
            maskImage: 'linear-gradient(90deg, transparent 0%, black 40%, black 60%, transparent 100%)',
            maskSize: '200% 100%',
          } : undefined}
        />

        <span className={cn(
          'font-mono text-[11px] leading-none',
          isRunning && 'text-foreground/70',
          isDone && 'text-muted-foreground',
          isError && 'text-destructive/80',
        )}>
          {label}
          {target && (
            <span className="text-muted-foreground/60 ml-1">{target}</span>
          )}
        </span>

        {/* Expand hint — only visible on hover once there's something to show */}
        {(input !== undefined || output !== undefined || errorText || children) && (
          <span className={cn(
            'ml-auto text-[10px] text-muted-foreground/40 opacity-0 group-hover/tool:opacity-100 transition-opacity',
          )}>
            {expanded ? 'hide' : 'details'}
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <m.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
            className="overflow-hidden"
          >
            {/* Gradient mask so content fades in from the top */}
            <div
              className="ml-3 pl-3 border-l border-border/40 py-1.5 space-y-1.5"
              data-testid={`chat-tool-call-content-${toolCallId}`}
              style={{
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 12px)',
              }}
            >
              {input !== undefined && (
                <pre
                  className="text-[10px] leading-relaxed text-muted-foreground/60 whitespace-pre-wrap break-all max-h-32 overflow-auto"
                  data-testid={`chat-tool-call-input-${toolCallId}`}
                >
                  {formatValue(input)}
                </pre>
              )}
              {(output !== undefined || isDone) && (
                <pre
                  className="text-[10px] leading-relaxed text-muted-foreground/40 whitespace-pre-wrap break-all max-h-32 overflow-auto"
                  data-testid={`chat-tool-call-output-${toolCallId}`}
                >
                  {formatValue(output)}
                </pre>
              )}
              {errorText && (
                <pre
                  className="text-[10px] leading-relaxed text-destructive/60 whitespace-pre-wrap break-all"
                  data-testid={`chat-tool-call-error-${toolCallId}`}
                >
                  {errorText}
                </pre>
              )}
              {children && (
                <div className="mt-1 space-y-0.5">
                  {children}
                </div>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
