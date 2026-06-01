import {
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  ClockIcon,
  Code2Icon,
  DiffIcon,
  FilePenLineIcon,
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
import type { ComponentType, FocusEvent, KeyboardEvent, PointerEvent, ReactElement, ReactNode } from 'react'
import { Activity, cloneElement, useEffect, useMemo, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { Table, TableBody, TableCell, TableRow } from '~/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import { projectChatTodos, readTodoCompletion } from '../chat-todo-projection'
import { readTerminalOutputSections } from '../terminal-tool-details'
import type { RenderableToolPart, ToolPayload, ToolState, ToolUiDescriptor, ToolUiKind } from '../tool-ui-classifier'
import {
  describeToolCall,
  readToolInputPayload,
  readToolPayload,
} from '../tool-ui-classifier'
import { EditFileBlock } from './edit-file-block'

interface ToolCallBlockProps {
  toolName: string
  toolCallId: string
  state: ToolState
  animated?: boolean
  approval?: {
    id: string
    approved?: boolean
    reason?: string
  }
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
  workspaceDiffTarget?: { workspaceId: string, ownerId?: string | null }
  onApprovalResponse?: (approval: { id: string, approved: boolean }) => void
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

const CODE_TEXT_CLASS = 'font-mono text-[11px] leading-relaxed text-muted-foreground'
const BACKSLASH_PATTERN = /\\/g

function isRunning(state: ToolState): boolean {
  return state === 'input-streaming' || state === 'input-available' || state === 'approval-requested'
}

function isError(state: ToolState): boolean {
  return state === 'output-error' || state === 'output-denied'
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value === null || value === undefined) {
    return ''
  }
  return JSON.stringify(value, null, 2)
}

function basename(value: string): string {
  return value.replace(BACKSLASH_PATTERN, '/').split('/').filter(Boolean).pop() ?? value
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

function hasRenderableChildren(children: ReactNode): boolean {
  if (children === null || children === undefined || typeof children === 'boolean') {
    return false
  }
  if (Array.isArray(children)) {
    return children.some(hasRenderableChildren)
  }
  return true
}

interface EditDiffPreview {
  filePath: string
  oldContent: string
  newContent: string
}

export function readEditDiffPreview(input: ToolPayload, output: ToolPayload): EditDiffPreview | null {
  const filePath = input.filePath ?? output.filePath
  if (!filePath) {
    return null
  }

  const oldString = input.oldString ?? output.oldString
  const newString = input.newString ?? output.newString
  const originalFile = output.originalFile
  const writtenContent = input.contentText ?? output.contentText

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

function readStreamingInputText(input: ToolPayload): string | null {
  return input.rawText ?? input.inputText
}

function readEditTarget(input: ToolPayload, output: ToolPayload): string | null {
  return input.filePath ?? output.filePath
}

function readEditPayloadSize(input: ToolPayload): number {
  const streamingText = readStreamingInputText(input)
  if (streamingText) {
    return streamingText.length
  }
  const parts = [
    input.oldString,
    input.newString,
    input.contentText,
  ].filter((value): value is string => value !== null)
  return parts.reduce((total, value) => total + value.length, 0)
}

function hasDiffPreviewContent(input: ToolPayload, output: ToolPayload, errorText?: string): boolean {
  return !!errorText
    || hasFileDiffPayloadContent(input, output)
}

export function hasFileDiffPayloadContent(input: ToolPayload, output: ToolPayload): boolean {
  return readEditDiffPreview(input, output) !== null
    || readEditTarget(input, output) !== null
    || readEditPayloadSize(input) > 0
    || output.gitDiff.patch.length > 0
    || output.structuredPatch.length > 0
}

export function hasFileDiffInlineContent(input: ToolPayload, output: ToolPayload): boolean {
  return readEditDiffPreview(input, output) !== null
    || readEditPayloadSize(input) > 0
    || output.gitDiff.patch.length > 0
    || output.structuredPatch.length > 0
}

function hasDiffHeroContent(input: ToolPayload, output: ToolPayload): boolean {
  return hasFileDiffPayloadContent(input, output)
}

export function readFileDiffPayload(input: unknown, output: unknown, argumentsText?: string): { input: ToolPayload, output: ToolPayload } {
  const inputPayload = readToolInputPayload(input, argumentsText)
  const outputPayload = readToolPayload(output)
  return { input: inputPayload, output: outputPayload }
}

export function readFileDiffTarget(input: unknown, output: unknown, argumentsText?: string): string | null {
  const payload = readFileDiffPayload(input, output, argumentsText)
  return readEditTarget(payload.input, payload.output)
}

export function hasFileDiffDetails(input: unknown, output: unknown, argumentsText?: string, errorText?: string): boolean {
  const payload = readFileDiffPayload(input, output, argumentsText)
  return hasDiffPreviewContent(payload.input, payload.output, errorText)
}

function readReplaceAll(input: ToolPayload, output: ToolPayload): boolean {
  return input.replaceAll === true || output.replaceAll === true
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
  return <NativeCodeBlock text={text} className={className} />
}

function NativeCodeBlock({
  text,
  destructive = false,
  wrap = true,
  className,
}: {
  text: string
  destructive?: boolean
  wrap?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'max-h-56 overflow-auto overscroll-contain rounded-md bg-muted/35',
        destructive && 'bg-destructive/5',
        className,
      )}
      onClick={event => event.stopPropagation()}
    >
      <pre
        className={cn(
          CODE_TEXT_CLASS,
          wrap ? 'whitespace-pre-wrap break-words' : 'min-w-max whitespace-pre',
          'p-2.5',
          destructive && 'text-destructive/80',
        )}
      >
        {text}
      </pre>
    </div>
  )
}

export function TerminalExecutionDetails({
  input,
  output,
  errorText,
  argumentsText,
  className,
}: {
  input: unknown
  output: unknown
  errorText?: string
  argumentsText?: string
  className?: string
}) {
  const inputPayload = readToolInputPayload(input, argumentsText)
  const outputPayload = readToolPayload(output)
  const sections = readTerminalOutputSections(outputPayload, errorText)
  const command = inputPayload.command
  const timeout = inputPayload.timeout
  const backgroundTaskId = outputPayload.backgroundTaskId

  if (!command && timeout === null && !backgroundTaskId && sections.length === 0) {
    return null
  }

  return (
    <div className={cn('grid gap-3', className)}>
      {(command || timeout !== null || backgroundTaskId) && (
        <DetailSection title="Command">
          <div className="grid gap-1.5">
            {command && <NativeCodeBlock text={command} wrap={false} className="max-h-32" />}
            <KeyValueTable
              rows={[
                ['Timeout', timeout],
                ['Background', backgroundTaskId],
              ]}
            />
          </div>
        </DetailSection>
      )}
      {sections.length > 0 && (
        <DetailSection title="Output">
          <div className="grid gap-2">
            {sections.map(section => (
              <section key={section.label} className="grid gap-1">
                {sections.length > 1 && (
                  <div className={cn(
                    'px-0.5 font-mono text-[10px] font-medium',
                    section.destructive ? 'text-destructive/70' : 'text-muted-foreground/60',
                  )}
                  >
                    {section.label}
                  </div>
                )}
                <NativeCodeBlock text={section.text} destructive={section.destructive} wrap={false} className="max-h-44" />
              </section>
            ))}
          </div>
        </DetailSection>
      )}
    </div>
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

function ToolHero({ descriptor, state, input, output, errorText }: { descriptor: ToolUiDescriptor, state: ToolState, input: ToolPayload, output: ToolPayload, errorText?: string }) {
  switch (descriptor.kind) {
    case 'terminal':
      return <TerminalSummary errorText={errorText} />
    case 'file-read':
      return <FileReadSummary output={output} />
    case 'file-diff':
      return <DiffSummary input={input} output={output} state={state} />
    case 'notebook-diff':
      return <DiffSummary input={input} output={output} state={state} />
    case 'search':
      return <SearchSummary output={output} />
    case 'web':
      return <WebSummary output={output} />
    case 'subagent':
      return <SubagentSummary output={output} />
    case 'todo':
      return <TodoSummary input={input} output={output} />
    case 'plan':
      return <PlanSummary input={input} output={output} />
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

function TerminalSummary({ errorText }: { errorText?: string }) {
  if (!errorText) {
    return null
  }
  return (
    <div className="rounded-md bg-destructive/5 px-2.5 py-2 text-xs text-destructive/80">
      Command failed
    </div>
  )
}

function FileReadSummary({ output }: { output: ToolPayload }) {
  const outputType = output.type
  const file = output.file
  if (!file) {
    return null
  }
  if (outputType === 'image') {
    const mimeType = file.type ?? 'image/png'
    const base64 = file.base64
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
    return <RawValue value={file.content} />
  }
  return (
    <KeyValueTable
      rows={[
        ['Type', outputType],
        ['Path', file.filePath],
        ['Size', file.originalSize],
        ['Pages', file.count],
        ['Output', file.outputDir],
      ]}
    />
  )
}

function DiffSummary({ input, output, state, defaultOpen = false }: { input: ToolPayload, output: ToolPayload, state: ToolState, defaultOpen?: boolean }) {
  const editPreview = readEditDiffPreview(input, output)
  if (editPreview) {
    return (
      <EditFileBlock
        filePath={editPreview.filePath}
        oldContent={editPreview.oldContent}
        newContent={editPreview.newContent}
        defaultOpen={defaultOpen}
      />
    )
  }

  const filePath = readEditTarget(input, output)
  const payloadSize = readEditPayloadSize(input)
  if (filePath || payloadSize > 0) {
    return (
      <div
        className="grid gap-2 rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground"
        data-testid="chat-edit-file-streaming-preview"
      >
        <div className="flex min-w-0 items-center gap-2">
          <FilePenLineIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/75" title={filePath ?? undefined}>
            {filePath ?? 'Receiving file edit'}
          </span>
          {payloadSize > 0 && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/60">
              {formatCount(payloadSize, 'char')}
            </span>
          )}
        </div>
        {isRunning(state) && <Progress value={65} className="h-1" />}
      </div>
    )
  }

  const patch = output.gitDiff.patch
  if (patch) {
    return <RawValue value={patch} className="max-h-64" />
  }
  if (output.structuredPatch.length > 0) {
    const lines = output.structuredPatch.flatMap(hunk => hunk.lines)
    return <RawValue value={lines.join('\n')} className="max-h-64" />
  }
  return <p className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">File change prepared.</p>
}

export function FileDiffExecutionDetails({
  input,
  output,
  errorText,
  argumentsText,
  state,
  className,
}: {
  input: unknown
  output: unknown
  errorText?: string
  argumentsText?: string
  state: ToolState
  className?: string
}) {
  const inputPayload = readToolInputPayload(input, argumentsText)
  const outputPayload = readToolPayload(output)

  return (
    <div className={cn('grid gap-2', className)}>
      {errorText && (
        <DetailSection title="Error">
          <RawValue value={errorText} className="max-h-40 bg-destructive/5" />
        </DetailSection>
      )}
      {hasFileDiffPayloadContent(inputPayload, outputPayload) && (
        <DiffSummary input={inputPayload} output={outputPayload} state={state} defaultOpen />
      )}
    </div>
  )
}

function SearchSummary({ output }: { output: ToolPayload }) {
  const filenames = output.filenames
  const content = output.contentText
  if (content) {
    return <RawValue value={content} />
  }
  return <PathList paths={filenames} emptyText="Search returned no files." />
}

function WebSummary({ output }: { output: ToolPayload }) {
  const links = output.results.flatMap(item => item.content.map(hit => ({
    title: hit.title ?? 'Untitled',
    url: hit.url ?? '',
  })))
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
  return null
}

function SubagentSummary({ output }: { output: ToolPayload }) {
  const status = output.status
  const content = output.contentBlocks.map(item => item.text).filter(Boolean).join('\n\n')

  if (!status && !content) {
    return null
  }

  return (
    <div className="grid gap-2">
      {status === 'async_launched' && (
        <Alert className="border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300">
          <ClockIcon className="size-4" aria-hidden />
          <AlertTitle>Background agent launched</AlertTitle>
          <AlertDescription>{output.outputFile ?? 'Output will be available when the task completes.'}</AlertDescription>
        </Alert>
      )}
      {content && <RawValue value={content} />}
    </div>
  )
}

function TodoSummary({ input, output }: { input: ToolPayload, output: ToolPayload }) {
  const todos = projectChatTodos(input, output)
  if (todos.length === 0) {
    return <RawValue value={output.rawText ?? input.rawText ?? output} />
  }
  const { completed } = readTodoCompletion(todos)
  return (
    <div className="grid gap-2">
      <Progress value={safePercent(completed, todos.length)} className="h-1.5" />
      <div className="grid gap-1">
        {todos.map(todo => (
          <div key={todo.id ?? todo.content} className="flex items-start gap-2 rounded-md bg-muted/30 px-2 py-1.5">
            <CheckCircle2Icon
              className={cn(
                'mt-0.5 size-3.5 shrink-0',
                todo.status === 'completed' ? 'text-emerald-500' : 'text-muted-foreground',
              )}
              aria-hidden
            />
            <span className={cn(
              'min-w-0 flex-1 text-xs text-foreground/85',
              todo.status === 'completed' && 'text-muted-foreground line-through decoration-muted-foreground/50',
            )}
            >
              {todo.content}
            </span>
            <span className="shrink-0 rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {todo.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PlanSummary({ input, output }: { input: ToolPayload, output: ToolPayload }) {
  const text = output.plan ?? input.plan ?? output.text ?? input.text ?? output.rawText ?? input.rawText
  if (!text) {
    return null
  }
  return (
    <div className="rounded-md bg-muted/30 px-2.5 py-2">
      <div className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">
        {text}
      </div>
    </div>
  )
}

function QuestionSummary({ output }: { output: ToolPayload }) {
  const answers = output.answers
  if (!answers) {
    return <RawValue value={output} />
  }
  return (
    <KeyValueTable
      rows={Object.entries(answers).map(([question, answer]) => [question, String(answer)])}
    />
  )
}

function _ToolDetails({ descriptor, input, output, errorText, children }: {
  descriptor: ToolUiDescriptor
  input: ToolPayload
  output: ToolPayload
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

function ToolSpecificDetails({ descriptor, input, output }: { descriptor: ToolUiDescriptor, input: ToolPayload, output: ToolPayload }) {
  switch (descriptor.kind) {
    case 'terminal':
      return (
        <KeyValueTable
          rows={[
            ['Command', input.command],
            ['Timeout', input.timeout],
            ['Background', output.backgroundTaskId],
          ]}
        />
      )
    case 'file-diff':
      return <FileDiffDetails input={input} output={output} />
    case 'search':
      return (
        <KeyValueTable
          rows={[
            ['Pattern', input.pattern],
            ['Path', input.filePath],
            ['Mode', output.mode],
            ['Files', output.numFiles],
            ['Matches', output.numMatches],
          ]}
        />
      )
    case 'web':
      return (
        <KeyValueTable
          rows={[
            ['URL', input.url ?? output.url],
            ['Query', input.query ?? output.query],
            ['Status', output.code],
          ]}
        />
      )
    case 'worktree':
      return (
        <KeyValueTable
          rows={[
            ['Path', output.worktreeTarget ?? input.worktreeTarget],
            ['Branch', output.worktreeBranch],
            ['Action', output.action],
          ]}
        />
      )
    default:
      return null
  }
}

function FileDiffDetails({ input, output }: { input: ToolPayload, output: ToolPayload }) {
  const editPreview = readEditDiffPreview(input, output)

  return (
    <div className="grid gap-2">
      <KeyValueTable
        rows={[
          ['File', input.filePath ?? output.filePath],
          ['Mode', output.type],
          ['Replace all', input.replaceAll === true ? 'Yes' : null],
          ['User modified', output.userModified === true ? 'Yes' : null],
        ]}
      />
      {editPreview && (
        <EditFileBlock
          filePath={editPreview.filePath}
          oldContent={editPreview.oldContent}
          newContent={editPreview.newContent}
          defaultOpen
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

function StatusIcon({ state, animated = true }: { state: ToolState, animated?: boolean }) {
  if (isError(state)) {
    return <CircleAlertIcon className="size-3.5 text-destructive" aria-hidden />
  }
  if (state === 'output-available' || state === 'approval-responded') {
    return <CheckCircle2Icon className="size-3.5 text-emerald-500" aria-hidden />
  }
  return <ClockIcon className={cn('size-3.5 text-muted-foreground', animated && isRunning(state) && 'animate-pulse')} aria-hidden />
}

type LazyTooltipTriggerProps = {
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void
  onFocus?: (event: FocusEvent<HTMLElement>) => void
  onBlur?: (event: FocusEvent<HTMLElement>) => void
  title?: string
}

export function LazyTooltip({
  children,
  content,
  delayDuration,
  side,
  contentClassName,
  title,
}: {
  children: ReactElement<LazyTooltipTriggerProps>
  content: ReactNode
  delayDuration?: number
  side?: React.ComponentProps<typeof TooltipContent>['side']
  contentClassName?: string
  title?: string
}) {
  const [active, setActive] = useState(false)
  const [open, setOpen] = useState(false)

  const trigger = cloneElement(children, {
    title: active ? undefined : title,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      children.props.onPointerEnter?.(event)
      setActive(true)
      setOpen(true)
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      children.props.onPointerLeave?.(event)
      setOpen(false)
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      children.props.onFocus?.(event)
      setActive(true)
      setOpen(true)
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      children.props.onBlur?.(event)
      setOpen(false)
    },
  })

  if (!active) {
    return trigger
  }

  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={delayDuration}>
      <TooltipTrigger asChild>
        {trigger}
      </TooltipTrigger>
      <TooltipContent side={side} className={contentClassName}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

function hasHeroContent(descriptor: ToolUiDescriptor, input: ToolPayload, output: ToolPayload, errorText?: string): boolean {
  if (errorText) {
    return true
  }
  switch (descriptor.kind) {
    case 'terminal':
      return !!errorText
    case 'file-read':
      return output.file !== null
    case 'file-diff':
    case 'notebook-diff':
      return hasDiffHeroContent(input, output)
    case 'web':
      return output.results.some(item => item.content.length > 0)
    case 'subagent':
      return !!(output.status || output.contentBlocks.length > 0)
    case 'todo':
      return projectChatTodos(input, output).length > 0 || output.rawText !== null || input.rawText !== null
    case 'plan':
      return !!(output.plan ?? input.plan ?? output.text ?? input.text ?? output.rawText ?? input.rawText)
    default:
      return output.rawText !== null
        || output.outputText !== null
        || output.contentText !== null
        || output.text !== null
  }
}

export function ToolCallBlock({ toolName, toolCallId, state, animated = true, approval, argumentsText, input, output, errorText, workspaceDiffTarget, onApprovalResponse, children }: ToolCallBlockProps) {
  const inputPayload = useMemo(() => readToolInputPayload(input, argumentsText), [argumentsText, input])
  const outputPayload = useMemo(() => readToolPayload(output), [output])
  const descriptor = useMemo(() => {
    const part: RenderableToolPart = {
      type: 'dynamic-tool',
      toolName,
      toolCallId,
      state,
      argumentsText,
      input,
      output,
      errorText,
    }
    return describeToolCall(part)
  }, [argumentsText, errorText, input, output, state, toolCallId, toolName])

  const hasTerminalPanel = descriptor.kind === 'terminal' && (
    inputPayload.command !== null
    || inputPayload.timeout !== null
    || outputPayload.backgroundTaskId !== null
    || readTerminalOutputSections(outputPayload, errorText).length > 0
  )
  const hasDiffPanel = (descriptor.kind === 'file-diff' || descriptor.kind === 'notebook-diff') && (
    !!errorText || hasFileDiffInlineContent(inputPayload, outputPayload)
  )
  const workspaceDiffPath = descriptor.kind === 'file-diff' || descriptor.kind === 'notebook-diff'
    ? readEditTarget(inputPayload, outputPayload)
    : null
  const canOpenWorkspaceDiff = !!workspaceDiffTarget && !!workspaceDiffPath
  const openWorkspaceDiffTab = useBrowserPanelStore(s => s.openWorkspaceDiffTab)
  const requestScrollToFilePath = useBrowserPanelStore(s => s.requestScrollToFilePath)
  const setBrowserPanelOpen = useLayoutStore(s => s.setBrowserPanelOpen)
  const hasChildren = hasRenderableChildren(children)
  const expandable = hasTerminalPanel || hasDiffPanel || hasChildren
  const interactive = expandable || canOpenWorkspaceDiff
  const [expanded, setExpanded] = useState(() => isError(state) && (hasTerminalPanel || hasDiffPanel))
  const Icon = TOOL_ICON_MAP[descriptor.kind]
  const running = isRunning(state)
  const errored = isError(state)
  const retainNestedActivity = descriptor.kind === 'subagent' && hasChildren

  useEffect(() => {
    if (errored && (hasTerminalPanel || hasDiffPanel)) {
      setExpanded(true)
    }
  }, [errored, hasDiffPanel, hasTerminalPanel])

  const openWorkspaceDiff = () => {
    if (!workspaceDiffTarget || !workspaceDiffPath) {
      return
    }
    const tabId = openWorkspaceDiffTab({
      workspaceId: workspaceDiffTarget.workspaceId,
      title: 'All Changes',
      ownerId: workspaceDiffTarget.ownerId,
    })
    setBrowserPanelOpen(true, workspaceDiffTarget.ownerId)
    requestScrollToFilePath({ path: workspaceDiffPath, tabId })
  }

  const toggleExpanded = () => {
    if (expandable) {
      setExpanded(value => !value)
      return
    }
    if (canOpenWorkspaceDiff) {
      openWorkspaceDiff()
    }
  }

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleExpanded()
    }
  }

  const frameContent = (
    <>
      <div
        className={cn(
          'overflow-hidden rounded-lg mx-1 -px-1 bg-card border-border border',
          errored && 'ring-1 ring-destructive/30',
          interactive && 'select-none',
        )}
      >
        <div
          className={cn('flex h-8 items-center gap-2 px-3', interactive && 'cursor-pointer')}
          role={interactive ? 'button' : undefined}
          tabIndex={interactive ? 0 : undefined}
          aria-expanded={expandable ? expanded : undefined}
          onClick={toggleExpanded}
          onKeyDown={handleHeaderKeyDown}
        >
          <Icon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground/60',
              running && 'text-amber-500 dark:text-amber-400',
              errored && 'text-destructive',
            )}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/80">
            {descriptor.title}
          </span>
          {(descriptor.target || descriptor.summary) && (
            <span className={cn(
              'flex min-w-0 shrink-0 items-center gap-1 text-[11px] text-muted-foreground/50',
              animated ? 'max-w-48' : 'max-w-none flex-wrap justify-end text-right',
            )}
            >
              {descriptor.target && (animated
                ? (
                    <LazyTooltip
                      delayDuration={600}
                      side="bottom"
                      content={descriptor.target}
                      contentClassName="font-mono text-[11px]"
                      title={descriptor.target}
                    >
                      <span className="cursor-default truncate font-mono">
                        {descriptor.kind === 'terminal' ? descriptor.target : basename(descriptor.target)}
                      </span>
                    </LazyTooltip>
                  )
                : (
                    <span className="cursor-default break-all font-mono">
                      {descriptor.kind === 'terminal' ? descriptor.target : basename(descriptor.target)}
                    </span>
                  ))}
              {descriptor.summary && descriptor.target && (
                <span className="text-muted-foreground/30">·</span>
              )}
              {descriptor.summary && (
                <span className={cn(animated ? 'truncate' : 'whitespace-normal break-words')}>{descriptor.summary}</span>
              )}
            </span>
          )}
          {expandable && (
            <ChevronDownIcon
              className={cn(
                'size-3 shrink-0 text-muted-foreground/40',
                animated && 'transition-transform duration-200',
                expanded && 'rotate-180',
              )}
              aria-hidden
            />
          )}
          {animated
            ? (
                <LazyTooltip
                  content={(
                    <>
                      {descriptor.displayName}
                      {' '}
                      ·
                      {' '}
                      {STATUS_LABELS[state]}
                    </>
                  )}
                  title={`${descriptor.displayName} · ${STATUS_LABELS[state]}`}
                >
                  <span className={cn(
                    'flex shrink-0 items-center',
                    isError(state) ? 'text-destructive/70' : 'text-muted-foreground/40',
                    (state === 'output-available' || state === 'approval-responded') && 'text-emerald-500/80',
                  )}
                  >
                    <StatusIcon state={state} animated={animated} />
                  </span>
                </LazyTooltip>
              )
            : (
                <span
                  className={cn(
                    'flex shrink-0 items-center',
                    isError(state) ? 'text-destructive/70' : 'text-muted-foreground/40',
                    (state === 'output-available' || state === 'approval-responded') && 'text-emerald-500/80',
                  )}
                  title={`${descriptor.displayName} · ${STATUS_LABELS[state]}`}
                >
                  <StatusIcon state={state} animated={animated} />
                </span>
              )}
        </div>

        {running && (
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

        {hasTerminalPanel && expanded && (
          <div className="px-3 pb-3">
            <TerminalExecutionDetails input={input} output={output} errorText={errorText} argumentsText={argumentsText} />
          </div>
        )}

        {hasDiffPanel && expanded && (
          <div className="px-3 pb-3">
            <FileDiffExecutionDetails
              input={input}
              output={output}
              errorText={errorText}
              argumentsText={argumentsText}
              state={state}
            />
          </div>
        )}

        {(!(hasTerminalPanel || hasDiffPanel) || !expanded) && hasHeroContent(descriptor, inputPayload, outputPayload, errorText) && (
          <div className="px-3 pb-3">
            <ToolHero descriptor={descriptor} state={state} input={inputPayload} output={outputPayload} errorText={errorText} />
          </div>
        )}

        {state === 'approval-requested' && approval && onApprovalResponse && (
          <div className="flex items-center justify-end gap-1.5 border-t border-border/60 px-3 py-2" data-testid="approval-card">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="approval-deny-btn"
              onClick={() => onApprovalResponse({ id: approval.id, approved: false })}
            >
              Deny
            </Button>
            <Button
              type="button"
              size="xs"
              data-testid="approval-allow-btn"
              onClick={() => onApprovalResponse({ id: approval.id, approved: true })}
            >
              Approve
            </Button>
          </div>
        )}
      </div>

      {hasChildren && (retainNestedActivity
        ? (
            <Activity name={`tool:${toolCallId}:nested-activity`} mode={expanded ? 'visible' : 'hidden'}>
              <div className={cn('ml-3 mt-0.5 overflow-y-auto space-y-0', !running && 'max-h-80')}>{children}</div>
            </Activity>
          )
        : expanded
          ? <div className={cn('ml-3 mt-0.5 overflow-y-auto space-y-0', !running && 'max-h-80')}>{children}</div>
          : null)}
    </>
  )

  const frameProps = {
    'className': 'py-1.5',
    'data-testid': `chat-tool-call-${toolCallId}`,
    'data-tool-name': toolName,
    'data-tool-kind': descriptor.kind,
  }

  if (!animated) {
    return <div {...frameProps}>{frameContent}</div>
  }

  return (
    <m.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      {...frameProps}
    >
      {frameContent}
    </m.div>
  )
}
