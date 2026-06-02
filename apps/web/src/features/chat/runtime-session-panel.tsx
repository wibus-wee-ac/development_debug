// Output: Runtime status panel for the selected chat session.
// Input: Session metadata, visible chat status, run display metadata, and tool entities.
// Position: Chat feature panel rendered inside the app right aside.

import { useQuery } from '@tanstack/react-query'
import { ActivityIcon, CheckCircle2Icon, CircleIcon, EyeIcon, ListChecksIcon, LoaderCircleIcon, TimerIcon, WrenchIcon } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'
import type { RuntimeKind } from '~/lib/types'
import { chatSelectors, useChatStore } from '~/store/chat'

import type { ChatRuntimePlanUiSlotState, ChatRuntimeUiSlotState } from './chat-capabilities'
import { getChatRuntimeUiSlotStates, runtimeUiSlotStatesQueryKey } from './chat-capabilities'
import { readChatAttentionSnapshot, subscribeChatAttentionSnapshots } from './chat-context'
import type { ChatTodoItem, SessionTodoSnapshot } from './chat-todo-projection'
import type { ChatToolEntity } from './chat-tool-entities'
import type { RuntimeSessionStatusKind } from './runtime-session-status-command'
import type { ToolState } from './tool-ui-classifier'
import { describeToolCall, formatToolName } from './tool-ui-classifier'
import { useRuntimeSessionStatus } from './use-runtime-session-status'
import { useSessionTodos } from './use-session-todos'

interface RuntimeSessionPanelProps {
  sessionId: string | null
  runtimeKind?: RuntimeKind | null
  providerTargetId?: string | null
}

const TOOL_STATE_LABELS: Record<ToolState, string> = {
  'input-streaming': 'Input',
  'input-available': 'Ready',
  'approval-requested': 'Approval',
  'approval-responded': 'Approved',
  'output-available': 'Done',
  'output-error': 'Error',
  'output-denied': 'Denied',
}

const EMPTY_TOOLS: ChatToolEntity[] = []

type ProgressTaskStatus = 'pending' | 'inProgress' | 'completed'

interface ProgressTaskItem {
  id: string
  label: string
  status: ProgressTaskStatus
  order: number
}

export function RuntimeSessionPanel({
  sessionId,
  runtimeKind,
  providerTargetId,
}: RuntimeSessionPanelProps) {
  const visibleStatus = useChatStore(sessionId ? chatSelectors.visibleStatus(sessionId) : () => 'idle' as const)
  const { data: runtimeStatus } = useRuntimeSessionStatus(sessionId)
  const attentionSnapshot = useSyncExternalStore(
    subscribeChatAttentionSnapshots,
    () => readChatAttentionSnapshot(sessionId),
    () => null,
  )
  const { data: runtimeUiSlotStates, isLoading: runtimeUiSlotStatesLoading } = useQuery({
    queryKey: runtimeUiSlotStatesQueryKey(sessionId, runtimeKind),
    queryFn: ({ signal }) => getChatRuntimeUiSlotStates(sessionId!, signal),
    enabled: !!sessionId,
    staleTime: 2_000,
    refetchInterval: query => statusShouldPoll(runtimeStatus?.status)
      || shouldPollRuntimeSlotStates(query.state.data?.states ?? [])
      ? 2_000
      : false,
    retry: false,
  })
  const todoSnapshot = useSessionTodos(sessionId)
  const lastAssistantId = useChatStore(
    sessionId ? chatSelectors.lastAssistantId(sessionId) : () => undefined,
  )
  const tools = useChatStore(
    useShallow(sessionId ? chatSelectors.sessionToolEntities(sessionId) : () => EMPTY_TOOLS),
  )
  const runMeta = useChatStore(
    lastAssistantId
      ? chatSelectors.runDisplayMeta(lastAssistantId)
      : () => undefined,
  )
  const toolCounts = countToolStates(tools)
  const recentTools = tools.slice(-6).reverse()
  const status = runtimeStatus?.status ?? visibleStatus
  const displayedRun = runtimeStatus?.activeRun ?? runtimeStatus?.latestRun ?? null
  const planState = runtimeUiSlotStates?.states.find(isRuntimePlanState) ?? null
  const progressItems = buildProgressItems(planState, todoSnapshot)

  if (!sessionId) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center">
        <p className="text-[11px] text-muted-foreground">No session selected</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-3">
      <ProgressPanel items={progressItems} planState={planState} loading={runtimeUiSlotStatesLoading} />

      {
        import.meta.env.DEV && (
          <>
            <div className="border-t" />

            <div className='mx-auto bg-muted text-[10px] px-2 py-0.5 rounded-full border border-border -mb-1'>
              Dev Sections
            </div>

            <section className="space-y-2">
              <PanelHeading icon={EyeIcon} label="Attention" />
              {attentionSnapshot
                ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="Visible" value={formatAttentionRange(attentionSnapshot)} />
                    <Metric label="Scroll" value={formatScrollRatio(attentionSnapshot.scrollRatio)} />
                    <Metric label="Focus" value={attentionSnapshot.focusedArea ?? 'none'} />
                    <Metric label="Freshness" value={formatSnapshotFreshness(attentionSnapshot.updatedAt)} />
                  </div>
                )
                : (
                  <p className="rounded-md bg-muted/30 p-2 text-[11px] text-muted-foreground">
                    No chat attention snapshot for this session
                  </p>
                )}
            </section>

            <div className="border-t" />

            <section className="space-y-2">
              <PanelHeading icon={ActivityIcon} label="Session" />
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Runtime status" value={formatStatus(status)} tone={status} />
                <Metric label="UI status" value={formatStatus(visibleStatus)} tone={visibleStatus} />
                <Metric label="Runtime" value={runtimeStatus?.runtimeKind ?? runtimeKind ?? 'unknown'} />
                <Metric label="Mode" value={formatMode(runtimeStatus?.permissionMode)} />
                <Metric label="Provider" value={runtimeStatus?.providerTargetId ?? providerTargetId ?? 'default'} className="col-span-2" />
              </div>
            </section>

            <section className="space-y-2">
              <PanelHeading icon={TimerIcon} label="Run" />
              <div className="space-y-1.5 rounded-md bg-muted/40 p-2">
                <KeyValue label="Run ID" value={displayedRun?.runId ?? runMeta?.runId ?? 'none'} />
                <KeyValue label="Run status" value={displayedRun?.status ?? 'none'} />
                <KeyValue label="Provider session" value={runtimeStatus?.providerSessionId ?? displayedRun?.providerSessionId ?? 'none'} />
                <KeyValue label="Model" value={runtimeStatus?.modelId ?? displayedRun?.modelId ?? 'none'} />
                <KeyValue label="First event" value={formatElapsed(runMeta?.requestStartedAtMs, runMeta?.firstEventAtMs)} />
                <KeyValue label="First content" value={formatElapsed(runMeta?.requestStartedAtMs, runMeta?.firstContentAtMs)} />
                <KeyValue label="Total" value={formatElapsed(runMeta?.requestStartedAtMs, runMeta?.completedAtMs)} />
                <KeyValue label="Queue" value={`${runtimeStatus?.queue.running ?? 0} running / ${runtimeStatus?.queue.pending ?? 0} pending`} />
              </div>
            </section>

            <section className="space-y-2">
              <PanelHeading icon={WrenchIcon} label="Tool calls" />
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Total" value={String(tools.length)} />
                <Metric label="Running" value={String(toolCounts.running)} />
                <Metric label="Failed" value={String(toolCounts.failed)} tone={toolCounts.failed > 0 ? 'error' : 'idle'} />
              </div>
              <div className="space-y-1.5">
                {recentTools.length === 0 && (
                  <p className="rounded-md bg-muted/30 p-2 text-[11px] text-muted-foreground">
                    No tool calls for this session
                  </p>
                )}
                {recentTools.map((tool) => {
                  const descriptor = describeToolCall({
                    type: 'dynamic-tool',
                    toolCallId: tool.toolCallId,
                    toolName: tool.toolName,
                    state: tool.state,
                    input: tool.input,
                    output: tool.output,
                    errorText: tool.errorText,
                    argumentsText: tool.argumentsText,
                  })
                  return (
                    <div key={tool.toolCallId} className="rounded-md bg-muted/40 px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <CircleIcon className={cn(
                          'size-2.5 shrink-0 fill-current',
                          tool.state === 'output-error' ? 'text-destructive' : 'text-muted-foreground',
                        )}
                        />
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                          {descriptor.title || formatToolName(tool.toolName)}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {TOOL_STATE_LABELS[tool.state]}
                        </span>
                      </div>
                      {descriptor.target && (
                        <p className="mt-0.5 truncate pl-4 text-[10px] text-muted-foreground">
                          {descriptor.target}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )
      }

    </div>
  )
}

function PanelHeading({ icon: Icon, label }: { icon: typeof ActivityIcon, label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

function ProgressPanel({
  items,
  planState,
  loading,
}: {
  items: ProgressTaskItem[]
  planState: ChatRuntimePlanUiSlotState | null
  loading: boolean
}) {
  const completed = items.filter(item => item.status === 'completed').length
  const activeItem = items.find(item => item.status === 'inProgress')
    ?? items.find(item => item.status === 'pending')
    ?? items.at(-1)
    ?? null
  const summary = items.length > 0
    ? `${completed}/${items.length} complete`
    : loading
      ? 'Loading'
      : 'No tracked tasks'

  return (
    <section className="space-y-2">
      <PanelHeading icon={ListChecksIcon} label="Progress" />
      <div className="space-y-2 rounded-md bg-muted/35 px-1 py-2 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        {/* <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/85">
            {activeItem?.label ?? planState?.explanation ?? 'Session task state'}
          </span>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {summary}
          </span>
        </div> */}
        {/* <Progress value={safePercent(completed, items.length)} className="h-1.5 bg-muted/70" /> */}
        {items.length > 0
          ? (
            <div className="space-y-1">
              {items.map(item => (
                <ProgressTaskRow key={item.id} item={item} />
              ))}
            </div>
          )
          : (
            <p className="rounded bg-background/45 px-2 py-1.5 text-[11px] text-muted-foreground">
              {loading ? 'Loading session progress...' : 'No Plan or TODO state for this session'}
            </p>
          )}
      </div>
    </section>
  )
}

function ProgressTaskRow({ item }: { item: ProgressTaskItem }) {
  const Icon = item.status === 'completed'
    ? CheckCircle2Icon
    : item.status === 'inProgress'
      ? LoaderCircleIcon
      : CircleIcon

  return (
    <div className="flex min-w-0 items-start gap-2 rounded bg-background/45 px-2 py-1.5">
      <Icon className={cn(
        'mt-0.5 size-3.5 shrink-0',
        item.status === 'completed' && 'text-emerald-500',
        item.status === 'inProgress' && 'animate-spin text-primary',
        item.status === 'pending' && 'text-muted-foreground',
      )}
      />
      <span className={cn(
        'min-w-0 flex-1 text-[11px] leading-4 text-foreground/85',
        item.status === 'completed' && 'text-muted-foreground line-through decoration-muted-foreground/50',
      )}
      >
        {item.label}
      </span>
    </div>
  )
}

function Metric({
  label,
  value,
  tone = 'idle',
  className,
}: {
  label: string
  value: string
  tone?: RuntimeSessionStatusKind | 'error'
  className?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-md bg-muted/40 p-2', className)}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-0.5 truncate text-[11px] font-medium',
        tone === 'streaming' && 'text-primary',
        tone === 'pending' && 'text-primary',
        tone === 'cancelling' && 'text-amber-600 dark:text-amber-400',
        tone === 'error' && 'text-destructive',
        tone === 'idle' && 'text-foreground',
      )}
      >
        {value}
      </p>
    </div>
  )
}

function KeyValue({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-foreground">
        {value}
      </span>
    </div>
  )
}

function isRuntimePlanState(state: ChatRuntimeUiSlotState): state is ChatRuntimePlanUiSlotState {
  return state.kind === 'plan'
}

function buildProgressItems(
  planState: ChatRuntimePlanUiSlotState | null,
  todoSnapshot: SessionTodoSnapshot | null,
): ProgressTaskItem[] {
  const itemByKey = new Map<string, ProgressTaskItem>()

  planState?.steps.forEach((step, index) => {
    mergeProgressItem(itemByKey, {
      id: `plan:${index}:${step.step}`,
      label: step.step,
      status: step.status,
      order: index,
    })
  })

  todoSnapshot?.todos.forEach((todo, index) => {
    mergeProgressItem(itemByKey, {
      id: `todo:${todo.id ?? index}:${todo.content}`,
      label: todo.content,
      status: mapTodoProgressStatus(todo),
      order: (planState?.steps.length ?? 0) + index,
    })
  })

  return Array.from(itemByKey.values()).sort((left, right) => left.order - right.order)
}

function mergeProgressItem(itemByKey: Map<string, ProgressTaskItem>, item: ProgressTaskItem): void {
  const key = normalizeProgressLabel(item.label)
  const existing = itemByKey.get(key)
  if (!existing) {
    itemByKey.set(key, item)
    return
  }

  itemByKey.set(key, {
    ...existing,
    id: existing.id,
    status: readDominantProgressStatus(existing.status, item.status),
    order: Math.min(existing.order, item.order),
  })
}

function normalizeProgressLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

function mapTodoProgressStatus(todo: ChatTodoItem): ProgressTaskStatus {
  switch (todo.status) {
    case 'completed':
      return 'completed'
    case 'processing':
      return 'inProgress'
    case 'todo':
    default:
      return 'pending'
  }
}

function readDominantProgressStatus(left: ProgressTaskStatus, right: ProgressTaskStatus): ProgressTaskStatus {
  if (left === 'inProgress' || right === 'inProgress') {
    return 'inProgress'
  }
  if (left === 'completed' || right === 'completed') {
    return 'completed'
  }
  return 'pending'
}

function countToolStates(tools: Array<{ state: ToolState }>): { running: number, failed: number } {
  return tools.reduce((counts, tool) => {
    if (tool.state === 'output-error' || tool.state === 'output-denied') {
      return { ...counts, failed: counts.failed + 1 }
    }
    if (tool.state !== 'output-available') {
      return { ...counts, running: counts.running + 1 }
    }
    return counts
  }, { running: 0, failed: 0 })
}

function formatStatus(status: RuntimeSessionStatusKind | 'error'): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatMode(mode: string | null | undefined): string {
  if (!mode) {
    return 'bypassPermissions'
  }
  return mode
}

function formatElapsed(startedAt: number | null | undefined, endedAt: number | null | undefined): string {
  if (!startedAt || !endedAt) {
    return 'none'
  }
  const ms = Math.max(0, endedAt - startedAt)
  if (ms < 1_000) {
    return `${ms} ms`
  }
  return `${(ms / 1_000).toFixed(1)} s`
}

function formatAttentionRange(snapshot: NonNullable<ReturnType<typeof readChatAttentionSnapshot>>): string {
  if (snapshot.firstVisibleIndex === null || snapshot.lastVisibleIndex === null) {
    return `${snapshot.messageCount} messages`
  }
  return `${snapshot.firstVisibleIndex + 1}-${snapshot.lastVisibleIndex + 1}/${snapshot.messageCount}`
}

function formatScrollRatio(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

function formatSnapshotFreshness(updatedAt: number): string {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1_000))
  if (ageSeconds < 5) {
    return 'live'
  }
  if (ageSeconds < 60) {
    return `${ageSeconds}s ago`
  }
  return `${Math.floor(ageSeconds / 60)}m ago`
}

function safePercent(value: number, total: number): number {
  return total <= 0 ? 0 : Math.round((value / total) * 100)
}

function statusShouldPoll(status: RuntimeSessionStatusKind | undefined): boolean {
  return status === 'streaming' || status === 'pending' || status === 'cancelling'
}

function shouldPollRuntimeSlotStates(states: ChatRuntimeUiSlotState[]): boolean {
  return states.some((state) => {
    if (state.kind === 'plan') {
      return state.inProgressCount > 0
    }
    if (state.kind === 'status') {
      return state.status === 'active'
    }
    if (state.kind === 'toolActivity') {
      return typeof state.activeCount === 'number' && state.activeCount > 0
    }
    if (state.kind === 'mcp') {
      return Boolean(state.recentProgress)
    }
    if (state.kind === 'crew') {
      return typeof state.activeCount === 'number' && state.activeCount > 0
    }
    return false
  })
}
