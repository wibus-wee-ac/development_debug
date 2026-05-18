// Input: Tool call metadata including name, state, input/output data
// Output: A classified tool call display with structured input/output previews
// Position: apps/web/src/features/chat/blocks/tool-call-block.tsx

import { Streamdown } from '@cradle/streamdown'
import {
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
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
import { AnimatePresence, m } from 'motion/react'
import type { ComponentType, ReactNode } from 'react'
import { useMemo, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { Progress } from '~/components/ui/progress'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { Table, TableBody, TableCell, TableRow } from '~/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import type { RenderableToolPart, ToolState, ToolUiDescriptor, ToolUiKind } from '../tool-ui-classifier'
import {
  describeToolCall,
  isRecord,
  readNumberValue,
  readStringArray,
  readStringValue,
} from '../tool-ui-classifier'
import { EditFileBlock } from './edit-file-block'

interface ToolCallBlockProps {
  toolName: string
  toolCallId: string
  state: ToolState
  input?: unknown
  output?: unknown
  errorText?: string
  children?: ReactNode
}

type IconComponent = ComponentType<{ 'className'?: string, 'aria-hidden'?: boolean }>

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

const STATUS_LABELS: Record<ToolState, string> = {
  'input-streaming': 'Preparing',
  'input-available': 'Running',
  'approval-requested': 'Awaiting approval',
  'approval-responded': 'Approved',
  'output-available': 'Done',
  'output-error': 'Failed',
  'output-denied': 'Denied',
}

const STATUS_BADGE_VARIANTS: Record<ToolState, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  'input-streaming': 'secondary',
  'input-available': 'secondary',
  'approval-requested': 'outline',
  'approval-responded': 'outline',
  'output-available': 'outline',
  'output-error': 'destructive',
  'output-denied': 'destructive',
}

const CODE_TEXT_CLASS = 'font-mono text-[11px] leading-relaxed text-muted-foreground'
const BACKSLASH_PATTERN = /\\/g

function isRunning(state: ToolState): boolean {
  return state === 'input-streaming' || state === 'input-available' || state === 'approval-requested'
}

function isError(state: ToolState): boolean {
  return state === 'output-error' || state === 'output-denied'
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

function compactPath(value: string): string {
  const normalized = value.replace(BACKSLASH_PATTERN, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 3) {
    return value
  }
  return `.../${parts.slice(-3).join('/')}`
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}

function safePercent(value: number | null, max: number): number {
  if (value === null || max <= 0) {
    return 0
  }
  return Math.min(100, Math.max(0, (value / max) * 100))
}

function readObjectArray(value: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    return []
  }
  return value[key].filter(isRecord)
}

function readNestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value[key])) {
    return null
  }
  return value[key]
}

interface EditDiffPreview {
  filePath: string
  oldContent: string
  newContent: string
}

function readEditDiffPreview(input: unknown, output: unknown): EditDiffPreview | null {
  const filePath = readStringValue(input, ['file_path', 'filePath', 'path'])
    ?? readStringValue(output, ['filePath', 'file_path', 'path'])
  if (!filePath) {
    return null
  }

  const oldString = readStringValue(input, ['old_string', 'oldString'])
    ?? readStringValue(output, ['oldString', 'old_string'])
  const newString = readStringValue(input, ['new_string', 'newString'])
    ?? readStringValue(output, ['newString', 'new_string'])
  const originalFile = readStringValue(output, ['originalFile', 'original_file'])
  const writtenContent = readStringValue(input, ['content'])
    ?? readStringValue(output, ['content'])

  if (originalFile && oldString && newString) {
    return {
      filePath,
      oldContent: originalFile,
      newContent: applyEditPreview(originalFile, oldString, newString, readReplaceAll(input, output)),
    }
  }

  if (originalFile && writtenContent) {
    return {
      filePath,
      oldContent: originalFile,
      newContent: writtenContent,
    }
  }

  if (oldString && newString) {
    return {
      filePath,
      oldContent: oldString,
      newContent: newString,
    }
  }

  return null
}

function readReplaceAll(input: unknown, output: unknown): boolean {
  return (isRecord(input) && input.replace_all === true)
    || (isRecord(input) && input.replaceAll === true)
    || (isRecord(output) && output.replaceAll === true)
}

function applyEditPreview(originalFile: string, oldString: string, newString: string, replaceAll: boolean): string {
  if (!oldString || !originalFile.includes(oldString)) {
    return newString
  }
  return replaceAll ? originalFile.split(oldString).join(newString) : originalFile.replace(oldString, newString)
}

function RawValue({ value, className }: { value: unknown, className?: string }) {
  const text = formatValue(value)
  if (!text) {
    return null
  }
  return (
    <ScrollArea className={cn('max-h-56 rounded-md bg-muted/35', className)}>
      <pre className={cn(CODE_TEXT_CLASS, 'whitespace-pre-wrap break-words p-2.5')}>
        {text}
      </pre>
    </ScrollArea>
  )
}

function KeyValueTable({ rows }: { rows: Array<[string, ReactNode]> }) {
  const visibleRows = rows.filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (visibleRows.length === 0) {
    return null
  }
  return (
    <Table className="text-xs">
      <TableBody>
        {visibleRows.map(([label, value]) => (
          <TableRow key={label} className="border-border/50 hover:bg-transparent">
            <TableCell className="w-28 py-1.5 pr-3 align-top font-medium text-muted-foreground">
              {label}
            </TableCell>
            <TableCell className="min-w-0 py-1.5 whitespace-normal text-foreground/85">
              {value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function PathList({ paths, emptyText = 'No paths returned' }: { paths: string[], emptyText?: string }) {
  if (paths.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>
  }
  return (
    <div className="grid gap-1">
      {paths.slice(0, 24).map(path => (
        <div key={path} className="flex min-w-0 items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5">
          <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate font-mono text-[11px] text-foreground/80" title={path}>{path}</span>
        </div>
      ))}
      {paths.length > 24 && (
        <p className="px-2 text-xs text-muted-foreground">
          {formatCount(paths.length - 24, 'more path')}
        </p>
      )}
    </div>
  )
}

function ToolHero({ descriptor, state, input, output, errorText }: { descriptor: ToolUiDescriptor, state: ToolState, input: unknown, output: unknown, errorText?: string }) {
  switch (descriptor.kind) {
    case 'terminal':
      return <TerminalSummary output={output} errorText={errorText} />
    case 'file-read':
      return <FileReadSummary output={output} />
    case 'file-diff':
      return <DiffSummary input={input} output={output} />
    case 'notebook-diff':
      return <DiffSummary input={input} output={output} />
    case 'search':
      return <SearchSummary output={output} />
    case 'web':
      return <WebSummary output={output} />
    case 'subagent':
      return <SubagentSummary output={output} />
    case 'todo':
      return <TodoSummary output={output} />
    case 'question':
      return <QuestionSummary output={output} />
    default:
      return (
        <div className={cn(
          'rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground',
          isError(state) && 'bg-destructive/5 text-destructive/80',
        )}
        >
          {errorText || descriptor.summary || 'Tool details are available below.'}
        </div>
      )
  }
}

function TerminalSummary({ output, errorText }: { output: unknown, errorText?: string }) {
  const stdout = readStringValue(output, ['stdout'])
  const stderr = readStringValue(output, ['stderr'])
  const message = errorText || stderr || stdout
  if (!message) {
    return <p className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">Command started.</p>
  }
  return (
    <ScrollArea className={cn('max-h-44 rounded-md', errorText || stderr ? 'bg-destructive/5' : 'bg-muted/35')}>
      <pre className={cn(CODE_TEXT_CLASS, 'whitespace-pre-wrap break-words p-2.5', (errorText || stderr) && 'text-destructive/80')}>
        {message}
      </pre>
    </ScrollArea>
  )
}

function FileReadSummary({ output }: { output: unknown }) {
  const outputType = readStringValue(output, ['type'])
  const file = readNestedRecord(output, 'file')
  if (!file) {
    return <p className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">File read requested.</p>
  }
  if (outputType === 'image') {
    const mimeType = readStringValue(file, ['type']) ?? 'image/png'
    const base64 = readStringValue(file, ['base64'])
    return base64
      ? (
          <img
            src={`data:${mimeType};base64,${base64}`}
            alt="Tool result preview"
            className="max-h-64 rounded-md object-contain outline outline-1 outline-black/10 dark:outline-white/10"
          />
        )
      : null
  }
  if (outputType === 'text') {
    const content = readStringValue(file, ['content'])
    return <RawValue value={content} />
  }
  return (
    <KeyValueTable
      rows={[
        ['Type', outputType],
        ['Path', readStringValue(file, ['filePath'])],
        ['Size', readNumberValue(file, ['originalSize'])],
        ['Pages', readNumberValue(file, ['count'])],
        ['Output', readStringValue(file, ['outputDir'])],
      ]}
    />
  )
}

function DiffSummary({ input, output }: { input: unknown, output: unknown }) {
  const editPreview = readEditDiffPreview(input, output)
  if (editPreview) {
    return (
      <EditFileBlock
        filePath={editPreview.filePath}
        oldContent={editPreview.oldContent}
        newContent={editPreview.newContent}
      />
    )
  }

  const gitDiff = readNestedRecord(output, 'gitDiff')
  const patch = readStringValue(gitDiff, ['patch'])
  if (patch) {
    return <RawValue value={patch} className="max-h-64" />
  }
  const structuredPatch = readObjectArray(output, 'structuredPatch')
  if (structuredPatch.length > 0) {
    const lines = structuredPatch.flatMap(hunk => Array.isArray(hunk.lines) ? hunk.lines : [])
    return <RawValue value={lines.join('\n')} className="max-h-64" />
  }
  return <p className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">File change prepared.</p>
}

function SearchSummary({ output }: { output: unknown }) {
  const filenames = readStringArray(output, ['filenames'])
  const content = readStringValue(output, ['content'])
  if (content) {
    return <RawValue value={content} />
  }
  return <PathList paths={filenames} emptyText="Search returned no files." />
}

function WebSummary({ output }: { output: unknown }) {
  const result = readStringValue(output, ['result'])
  if (result) {
    return (
      <div className="rounded-md bg-muted/30 p-2.5 text-xs text-foreground/85">
        <Streamdown content={result} streaming={false} animationPreset="minimal" animateMode="word" showCursor={false} />
      </div>
    )
  }
  const results = isRecord(output) && Array.isArray(output.results) ? output.results : []
  const links = results.flatMap((item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      return []
    }
    return item.content.filter(isRecord).map(hit => ({
      title: readStringValue(hit, ['title']) ?? 'Untitled',
      url: readStringValue(hit, ['url']) ?? '',
    }))
  })
  if (links.length > 0) {
    return (
      <div className="grid gap-1">
        {links.slice(0, 8).map(link => (
          <a
            key={`${link.title}:${link.url}`}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-muted/30 px-2 py-1.5 text-xs text-foreground/85 transition-colors hover:bg-muted/60"
          >
            <span className="block truncate">{link.title}</span>
            <span className="block truncate font-mono text-[10px] text-muted-foreground">{link.url}</span>
          </a>
        ))}
      </div>
    )
  }
  return <RawValue value={output} />
}

function SubagentSummary({ output }: { output: unknown }) {
  const status = readStringValue(output, ['status'])
  const toolCount = readNumberValue(output, ['totalToolUseCount'])
  const duration = readNumberValue(output, ['totalDurationMs'])
  const tokens = readNumberValue(output, ['totalTokens'])
  const content = isRecord(output) && Array.isArray(output.content)
    ? output.content.filter(isRecord).map(item => readStringValue(item, ['text'])).filter(Boolean).join('\n\n')
    : ''

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-3 gap-1.5">
        <Metric label="Tools" value={toolCount} />
        <Metric label="Tokens" value={tokens} />
        <Metric label="Time" value={duration === null ? null : `${(duration / 1000).toFixed(1)}s`} />
      </div>
      {status === 'async_launched' && (
        <Alert className="border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300">
          <ClockIcon className="size-4" aria-hidden />
          <AlertTitle>Background agent launched</AlertTitle>
          <AlertDescription>{readStringValue(output, ['outputFile']) ?? 'Output will be available when the task completes.'}</AlertDescription>
        </Alert>
      )}
      {content && <RawValue value={content} />}
    </div>
  )
}

function Metric({ label, value }: { label: string, value: string | number | null }) {
  return (
    <div className="rounded-md bg-muted/30 px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-xs tabular-nums text-foreground">{value ?? '-'}</div>
    </div>
  )
}

function TodoSummary({ output }: { output: unknown }) {
  const todos = readObjectArray(output, 'newTodos')
  if (todos.length === 0) {
    return <RawValue value={output} />
  }
  const completed = todos.filter(todo => readStringValue(todo, ['status']) === 'completed').length
  return (
    <div className="grid gap-2">
      <Progress value={safePercent(completed, todos.length)} className="h-1.5" />
      <div className="grid gap-1">
        {todos.map(todo => (
          <div key={readStringValue(todo, ['content']) ?? readStringValue(todo, ['activeForm']) ?? JSON.stringify(todo)} className="flex items-start gap-2 rounded-md bg-muted/30 px-2 py-1.5">
            <CheckCircle2Icon
              className={cn(
                'mt-0.5 size-3.5 shrink-0',
                readStringValue(todo, ['status']) === 'completed' ? 'text-emerald-500' : 'text-muted-foreground',
              )}
              aria-hidden
            />
            <span className="text-xs text-foreground/85">{readStringValue(todo, ['content'])}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function QuestionSummary({ output }: { output: unknown }) {
  const answers = isRecord(output) && isRecord(output.answers) ? output.answers : null
  if (!answers) {
    return <RawValue value={output} />
  }
  return (
    <KeyValueTable
      rows={Object.entries(answers).map(([question, answer]) => [question, String(answer)])}
    />
  )
}

function ToolDetails({ descriptor, input, output, errorText, children }: {
  descriptor: ToolUiDescriptor
  input: unknown
  output: unknown
  errorText?: string
  children?: ReactNode
}) {
  return (
    <div className="grid gap-3">
      <ToolSpecificDetails descriptor={descriptor} input={input} output={output} />
      {input !== undefined && (
        <DetailSection title="Input">
          <RawValue value={input} />
        </DetailSection>
      )}
      {(output !== undefined || errorText) && (
        <DetailSection title={errorText ? 'Error' : 'Output'}>
          <RawValue value={errorText ?? output} />
        </DetailSection>
      )}
      {children && (
        <DetailSection title="Nested activity">
          <div className="grid gap-1.5">{children}</div>
        </DetailSection>
      )}
    </div>
  )
}

function ToolSpecificDetails({ descriptor, input, output }: { descriptor: ToolUiDescriptor, input: unknown, output: unknown }) {
  switch (descriptor.kind) {
    case 'terminal':
      return (
        <KeyValueTable
          rows={[
            ['Command', readStringValue(input, ['command', 'cmd'])],
            ['Timeout', readNumberValue(input, ['timeout'])],
            ['Background', readStringValue(output, ['backgroundTaskId'])],
          ]}
        />
      )
    case 'file-diff':
      return <FileDiffDetails input={input} output={output} />
    case 'search':
      return (
        <KeyValueTable
          rows={[
            ['Pattern', readStringValue(input, ['pattern'])],
            ['Path', readStringValue(input, ['path'])],
            ['Mode', readStringValue(input, ['output_mode']) ?? readStringValue(output, ['mode'])],
            ['Files', readNumberValue(output, ['numFiles'])],
            ['Matches', readNumberValue(output, ['numMatches'])],
          ]}
        />
      )
    case 'web':
      return (
        <KeyValueTable
          rows={[
            ['URL', readStringValue(input, ['url']) ?? readStringValue(output, ['url'])],
            ['Query', readStringValue(input, ['query']) ?? readStringValue(output, ['query'])],
            ['Status', readNumberValue(output, ['code'])],
          ]}
        />
      )
    case 'worktree':
      return (
        <KeyValueTable
          rows={[
            ['Path', readStringValue(output, ['worktreePath']) ?? readStringValue(input, ['path'])],
            ['Branch', readStringValue(output, ['worktreeBranch'])],
            ['Action', readStringValue(output, ['action'])],
          ]}
        />
      )
    default:
      return null
  }
}

function FileDiffDetails({ input, output }: { input: unknown, output: unknown }) {
  const editPreview = readEditDiffPreview(input, output)

  return (
    <div className="grid gap-2">
      <KeyValueTable
        rows={[
          ['File', readStringValue(input, ['file_path', 'filePath']) ?? readStringValue(output, ['filePath'])],
          ['Mode', readStringValue(output, ['type'])],
          ['Replace all', isRecord(input) && input.replace_all === true ? 'Yes' : null],
          ['User modified', isRecord(output) && output.userModified === true ? 'Yes' : null],
        ]}
      />
      {editPreview && (
        <EditFileBlock
          filePath={editPreview.filePath}
          oldContent={editPreview.oldContent}
          newContent={editPreview.newContent}
        />
      )}
    </div>
  )
}

function DetailSection({ title, children }: { title: string, children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{title}</div>
      {children}
    </section>
  )
}

function StatusIcon({ state }: { state: ToolState }) {
  if (isError(state)) {
    return <CircleAlertIcon className="size-3.5 text-destructive" aria-hidden />
  }
  if (state === 'output-available' || state === 'approval-responded') {
    return <CheckCircle2Icon className="size-3.5 text-emerald-500" aria-hidden />
  }
  return <ClockIcon className={cn('size-3.5 text-muted-foreground', isRunning(state) && 'animate-pulse')} aria-hidden />
}

export function ToolCallBlock({ toolName, toolCallId, state, input, output, errorText, children }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const descriptor = useMemo(() => {
    const part: RenderableToolPart = {
      type: 'dynamic-tool',
      toolName,
      toolCallId,
      state,
      input,
      output,
      errorText,
    }
    return describeToolCall(part)
  }, [errorText, input, output, state, toolCallId, toolName])

  const Icon = TOOL_ICON_MAP[descriptor.kind]
  const running = isRunning(state)
  const errored = isError(state)
  const detailsId = `chat-tool-call-content-${toolCallId}`

  return (
    <m.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      className="py-1.5"
      data-testid={`chat-tool-call-${toolCallId}`}
      data-tool-name={toolName}
      data-tool-kind={descriptor.kind}
    >
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div
          className={cn(
            'overflow-hidden rounded-lg bg-card shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_10px_24px_rgba(0,0,0,0.04)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08)]',
            errored && 'ring-1 ring-destructive/30',
          )}
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start rounded-none px-3 py-2.5 text-left active:scale-[0.96]"
              data-testid={`chat-tool-call-toggle-${toolCallId}`}
              aria-expanded={expanded}
              aria-controls={detailsId}
            >
              <span className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground',
                running && 'text-amber-600 dark:text-amber-300',
                errored && 'bg-destructive/10 text-destructive',
              )}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{descriptor.title}</span>
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                      <Badge variant={STATUS_BADGE_VARIANTS[state]} className="h-5 shrink-0">
                        <StatusIcon state={state} />
                        {STATUS_LABELS[state]}
                      </Badge>
                      )}
                    />
                    <TooltipContent>
                      {descriptor.displayName}
                    </TooltipContent>
                  </Tooltip>
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {descriptor.target && (
                    <span className="truncate font-mono" title={descriptor.target}>{compactPath(descriptor.target)}</span>
                  )}
                  {descriptor.summary && (
                    <>
                      {descriptor.target && <span className="text-muted-foreground/45">/</span>}
                      <span className="truncate">{descriptor.summary}</span>
                    </>
                  )}
                </span>
              </span>
              <ChevronDownIcon
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                  expanded && 'rotate-180',
                )}
                aria-hidden
              />
            </Button>
          </CollapsibleTrigger>

          {running && (
            <div className="h-px overflow-hidden bg-muted">
              <m.div
                className="h-full w-1/3 rounded-full bg-muted-foreground/25"
                animate={{ x: ['-100%', '400%'] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              />
            </div>
          )}

          {!expanded && (
            <div className="px-3 pb-3">
              <ToolHero descriptor={descriptor} state={state} input={input} output={output} errorText={errorText} />
            </div>
          )}

          <AnimatePresence initial={false}>
            {expanded && (
              <CollapsibleContent forceMount asChild>
                <m.div
                  id={detailsId}
                  data-testid={detailsId}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
                  className="overflow-hidden"
                >
                  <Separator />
                  <div className="p-3">
                    <ToolDetails descriptor={descriptor} input={input} output={output} errorText={errorText}>
                      {children}
                    </ToolDetails>
                  </div>
                </m.div>
              </CollapsibleContent>
            )}
          </AnimatePresence>
        </div>
      </Collapsible>
    </m.div>
  )
}
