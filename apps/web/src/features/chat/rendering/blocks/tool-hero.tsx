import { StaticRender } from '@cradle/streamdown'
import {
  CheckCircleLine as CheckCircle2Icon,
  ClockLine as ClockIcon,
  FileLine as FileTextIcon,
  FullscreenLine as Maximize2Icon,
  RightSmallLine as ChevronRightIcon,
  LayoutTopLine as PanelTopIcon,
} from '@mingcute/react'
import { useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'
import { boundedPercent } from '~/lib/number-format'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import { projectChatTodos, readTodoCompletion } from '../../capabilities/chat-todo-projection'
import type { ToolPayload, ToolState, ToolUiDescriptor } from '../tool-ui-classifier'
import {
  DiffSummary,
  hasDiffHeroContent,
  KeyValueTable,
  PathList,
  RawValue,
} from './tool-call-details'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isError(state: ToolState): boolean {
  return state === 'output-error' || state === 'output-denied'
}

// ---------------------------------------------------------------------------
// Has hero content
// ---------------------------------------------------------------------------

export function hasHeroContent(
  descriptor: ToolUiDescriptor,
  input: ToolPayload,
  output: ToolPayload,
  errorText?: string,
): boolean {
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
      return (
        projectChatTodos(input, output).length > 0
        || output.rawText !== null
        || input.rawText !== null
      )
    case 'plan-implementation':
      return true
    case 'plan':
      return !!(
        output.planContent
        ?? input.planContent
        ?? output.plan
        ?? input.plan
        ?? output.text
        ?? input.text
        ?? output.rawText
        ?? input.rawText
      )
    default:
      return (
        output.rawText !== null
        || output.outputText !== null
        || output.contentText !== null
        || output.text !== null
      )
  }
}

// ---------------------------------------------------------------------------
// ToolHero
// ---------------------------------------------------------------------------

export function ToolHero({
  descriptor,
  state,
  input,
  output,
  errorText,
  toolCallId,
}: {
  descriptor: ToolUiDescriptor
  state: ToolState
  input: ToolPayload
  output: ToolPayload
  errorText?: string
  toolCallId: string
}) {
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
    case 'plan-implementation':
      return <PlanImplementationSummary />
    case 'plan':
      return <PlanSummary input={input} output={output} toolCallId={toolCallId} />
    case 'question':
      return <QuestionSummary output={output} />
    default:
      return (
        <div
          className={cn(
            'rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground',
            isError(state) && 'bg-destructive/5 text-destructive/80',
          )}
        >
          {errorText || descriptor.summary || 'Tool details are available below.'}
        </div>
      )
  }
}

// ---------------------------------------------------------------------------
// Summary components
// ---------------------------------------------------------------------------

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
  const [open, setOpen] = useState(false)
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
    const segments = (file.filePath ?? '').split('/')
    const fileName = segments.at(-1) ?? file.filePath ?? 'file'
    const dirPath = segments.length > 1 ? `${segments.slice(0, -1).join('/')}/` : ''
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              'group flex w-full min-w-0 items-center gap-2 px-2 py-1.5',
              'rounded-md transition-colors duration-100',
              'hover:bg-accent/50 active:bg-accent/70',
              open && 'rounded-b-none bg-accent/30',
            )}
          >
            <FileTextIcon
              className="size-3.5 shrink-0 !text-muted-foreground/50 transition-colors group-hover:!text-muted-foreground/70"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-left font-mono text-[12px] leading-none">
              {dirPath && <span className="text-muted-foreground/45">{dirPath}</span>}
              <span className="text-foreground/75">{fileName}</span>
            </span>
            <ChevronRightIcon
              className={cn(
                'size-3 shrink-0 !text-muted-foreground/40',
                'transition-transform duration-200',
                open && 'rotate-90',
              )}
              aria-hidden
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden rounded-b-md">
          <RawValue value={file.content} />
        </CollapsibleContent>
      </Collapsible>
    )
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

function SearchSummary({ output }: { output: ToolPayload }) {
  const filenames = output.filenames
  const content = output.contentText
  if (content) {
    return <RawValue value={content} />
  }
  return <PathList paths={filenames} emptyText="Search returned no files." />
}

function WebSummary({ output }: { output: ToolPayload }) {
  const links = output.results.flatMap(item =>
    item.content.map(hit => ({
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
            <span className="block truncate font-mono text-[10px] text-muted-foreground">
              {link.url}
            </span>
          </a>
        ))}
      </div>
    )
  }
  return null
}

function SubagentSummary({ output }: { output: ToolPayload }) {
  const status = output.status
  const content = output.contentBlocks
    .map(item => item.text)
    .filter(Boolean)
    .join('\n\n')

  if (!status && !content) {
    return null
  }

  return (
    <div className="grid gap-2">
      {status === 'async_launched' && (
        <Alert className="border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300">
          <ClockIcon className="size-4" aria-hidden />
          <AlertTitle>Background agent launched</AlertTitle>
          <AlertDescription>
            {output.outputFile ?? 'Output will be available when the task completes.'}
          </AlertDescription>
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
      <Progress value={boundedPercent(completed, todos.length)} className="h-1.5" />
      <div className="grid gap-1">
        {todos.map(todo => (
          <div
            key={todo.id ?? todo.content}
            className="flex items-start gap-2 rounded-md bg-muted/30 px-2 py-1.5"
          >
            <CheckCircle2Icon
              className={cn(
                'mt-0.5 size-3.5 shrink-0',
                todo.status === 'completed' ? '!text-emerald-500' : '!text-muted-foreground',
              )}
              aria-hidden
            />
            <span
              className={cn(
                'min-w-0 flex-1 text-xs text-foreground/85',
                todo.status === 'completed'
                && 'text-muted-foreground line-through decoration-muted-foreground/50',
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

function PlanImplementationSummary() {
  return (
    <div className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
      Plan implementation request recorded.
    </div>
  )
}

function PlanSummary({
  input,
  output,
  toolCallId,
}: {
  input: ToolPayload
  output: ToolPayload
  toolCallId: string
}) {
  const text
    = output.planContent
      ?? input.planContent
      ?? output.plan
      ?? input.plan
      ?? output.text
      ?? input.text
      ?? output.rawText
      ?? input.rawText
  const openPlanDocumentTab = useBrowserPanelStore(s => s.openPlanDocumentTab)
  const setBrowserPanelOpen = useLayoutStore(s => s.setBrowserPanelOpen)

  if (!text) {
    return null
  }

  const openPlan = () => {
    openPlanDocumentTab({ toolCallId, text })
    setBrowserPanelOpen(true)
  }

  const handlePreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target?.closest('a, button')) {
      return
    }
    openPlan()
  }

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPlan()
    }
  }

  return (
    <div
      className="group/plan relative overflow-hidden rounded-md border border-border/70 bg-background/85 shadow-xs transition-[border-color,box-shadow] duration-150 hover:border-border hover:shadow-sm"
      data-testid="chat-plan-document"
      role="button"
      tabIndex={0}
      aria-label="Open plan document"
      onClick={handlePreviewClick}
      onKeyDown={handlePreviewKeyDown}
    >
      <div className="flex h-8 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <PanelTopIcon className="size-3.5 shrink-0 !text-muted-foreground/60" aria-hidden="true" />
          <span className="min-w-0 truncate text-xs font-medium text-foreground/80">
            Plan document
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 shrink-0 text-muted-foreground/70 opacity-70 transition-[opacity,scale] duration-150 hover:text-foreground group-hover/plan:opacity-100 active:scale-[0.96]"
          aria-label="Open plan document in panel"
          onClick={openPlan}
        >
          <Maximize2Icon className="size-3" aria-hidden="true" />
        </Button>
      </div>
      <div
        className="streamdown-root max-h-64 overflow-y-auto px-3 py-3 text-xs leading-relaxed"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent, black 18px, black calc(100% - 24px), transparent)',
        }}
      >
        <StaticRender content={text} />
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
