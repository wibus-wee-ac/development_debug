import { useQuery } from '@tanstack/react-query'
import {
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FileTextIcon,
  GaugeIcon,
  MessageSquareIcon,
  PackageIcon,
  PuzzleIcon,
  WrenchIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'
import { clampPercent, formatTokenCount } from '~/lib/number-format'

import type {
  ChatRuntimeCompactUiSlotState,
  ChatRuntimeContextUsage,
  ChatRuntimeContextUsageSection,
} from './chat-capabilities'
import { getChatRuntimeContextUsage } from './chat-capabilities'

interface ContextWindowViewerProps {
  sessionId: string | null
  compactState?: ChatRuntimeCompactUiSlotState | null
  className?: string
}

interface ContextWindowAggregate {
  totalTokens: number
  maxTokens: number | null
  percentage: number | null
  source: 'details' | 'compact'
}

const SECTION_TONE_CLASS_NAMES: Record<string, string> = {
  'system-prompt': 'bg-[var(--color-accent-session)]',
  'messages': 'bg-[var(--color-accent)]',
  'tools': 'bg-[var(--color-accent-diff)]',
  'tool-results': 'bg-[var(--color-accent-summary)]',
  'memory-files': 'bg-[var(--color-accent-scope)]',
  'attachments': 'bg-[var(--color-accent-global)]',
  'skills': 'bg-[var(--color-accent-agent)]',
  'mcp-tools': 'bg-[var(--color-warning)]',
  'plugins': 'bg-[var(--color-accent-legacy)]',
  'agents': 'bg-[var(--color-success)]',
  'others': 'bg-muted-foreground',
}

const SECTION_LABELS: Record<string, string> = {
  'system-prompt': 'System prompt',
  'messages': 'Messages',
  'tools': 'Tool calls',
  'tool-results': 'Tool results',
  'memory-files': 'File context',
  'attachments': 'Attachments',
  'skills': 'Skills',
  'mcp-tools': 'MCP tools',
  'plugins': 'Plugins',
  'agents': 'Agents',
  'others': 'Other context',
}

export function ContextWindowViewer({
  sessionId,
  compactState,
  className,
}: ContextWindowViewerProps) {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['chat', 'context-window-usage', sessionId ?? 'no-session'],
    queryFn: ({ signal }) => getChatRuntimeContextUsage(sessionId!, signal),
    enabled: Boolean(sessionId),
    staleTime: 5_000,
    refetchInterval: compactState?.isCompactRelevant ? 5_000 : false,
    retry: false,
  })
  const usage = data?.usage ?? null
  const aggregate = useMemo(() => readContextAggregate(usage, compactState), [compactState, usage])
  const sections = useMemo(() => readContextSections(usage), [usage])

  if (!sessionId) {
    return null
  }

  return (
    <section className={cn('space-y-2', className)} data-testid="context-window-viewer">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <GaugeIcon className="size-3.5" aria-hidden="true" />
          <span>Context window</span>
        </div>
        {aggregate && (
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {formatUsagePercent(aggregate.percentage)}
          </span>
        )}
      </div>

      <div className="space-y-2 rounded-md bg-muted/35 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
        {aggregate
          ? (
            <>
              <ContextWindowSummary aggregate={aggregate} />
              {sections.length > 0
                ? <ContextSectionList sections={sections} totalTokens={aggregate.totalTokens} />
                : <ContextAggregateFallback compactState={compactState ?? null} />
              }
            </>
          )
          : (
            <p className="rounded bg-background/45 px-2 py-1.5 text-[11px] text-muted-foreground">
              {isLoading ? 'Loading context usage...' : isError ? 'Context usage failed to load' : 'Context usage is unavailable for this runtime'}
            </p>
          )}
      </div>
    </section>
  )
}

function ContextWindowSummary({ aggregate }: { aggregate: ContextWindowAggregate }) {
  const progressValue = aggregate.percentage === null ? 0 : clampPercent(aggregate.percentage)
  const remainingTokens = aggregate.maxTokens === null
    ? null
    : Math.max(0, aggregate.maxTokens - aggregate.totalTokens)

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold tabular-nums text-foreground">
            {formatTokenCount(aggregate.totalTokens)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {aggregate.source === 'details' ? 'Provider breakdown' : 'Runtime aggregate'}
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-[11px] tabular-nums text-foreground">
            {aggregate.maxTokens === null ? 'Unknown limit' : `${formatTokenCount(aggregate.totalTokens)} / ${formatTokenCount(aggregate.maxTokens)}`}
          </div>
          <div className="text-[10px] tabular-nums text-muted-foreground">
            {remainingTokens === null ? 'Remaining unknown' : `${formatTokenCount(remainingTokens)} remaining`}
          </div>
        </div>
      </div>
      <Progress value={progressValue} className="h-1.5 bg-background/60" />
    </div>
  )
}

function ContextSectionList({
  sections,
  totalTokens,
}: {
  sections: ChatRuntimeContextUsageSection[]
  totalTokens: number
}) {
  return (
    <div className="space-y-1.5">
      {sections.map(section => (
        <ContextSectionRow key={section.kind} section={section} totalTokens={totalTokens} />
      ))}
    </div>
  )
}

function ContextSectionRow({
  section,
  totalTokens,
}: {
  section: ChatRuntimeContextUsageSection
  totalTokens: number
}) {
  const [open, setOpen] = useState(false)
  const percent = totalTokens > 0 ? clampPercent((section.tokenCount / totalTokens) * 100) : 0
  const Icon = readSectionIcon(section.kind)
  const hasItems = section.items.length > 0

  return (
    <div className="rounded bg-background/45">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left"
        onClick={() => hasItems && setOpen(value => !value)}
        disabled={!hasItems}
      >
        <span className={cn('size-2 shrink-0 rounded-full', readSectionToneClassName(section.kind))} />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
          {readSectionLabel(section)}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {formatTokenCount(section.tokenCount)}
        </span>
        <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
          {percent}%
        </span>
        {hasItems
          ? open
            ? <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            : <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          : <span className="size-3 shrink-0" />}
      </button>
      {open && hasItems && (
        <div className="space-y-1 border-t border-border/50 px-2 py-1.5">
          {section.items.slice(0, 12).map((item, index) => (
            <div key={`${item.kind}:${item.label}:${index}`} className="flex min-w-0 items-center gap-2 text-[10px]">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.label}</span>
              <span className="shrink-0 tabular-nums text-foreground">{formatTokenCount(item.tokenCount)}</span>
            </div>
          ))}
          {section.items.length > 12 && (
            <div className="text-[10px] text-muted-foreground">
              {section.items.length - 12} more items
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ContextAggregateFallback({ compactState }: { compactState: ChatRuntimeCompactUiSlotState | null }) {
  if (!compactState) {
    return null
  }
  const rows = [
    { label: 'Input', value: compactState.total.inputTokens },
    { label: 'Cached input', value: compactState.total.cachedInputTokens },
    { label: 'Output', value: compactState.total.outputTokens },
    { label: 'Reasoning', value: compactState.total.reasoningOutputTokens },
  ].filter(row => row.value > 0)

  if (rows.length === 0) {
    return (
      <p className="rounded bg-background/45 px-2 py-1.5 text-[11px] text-muted-foreground">
        Detailed usage is unavailable for this runtime
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      {rows.map(row => (
        <div key={row.label} className="flex min-w-0 items-center gap-2 rounded bg-background/45 px-2 py-1.5 text-[11px]">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.label}</span>
          <span className="shrink-0 tabular-nums text-foreground">{formatTokenCount(row.value)}</span>
        </div>
      ))}
    </div>
  )
}

function readContextAggregate(
  usage: ChatRuntimeContextUsage | null,
  compactState: ChatRuntimeCompactUiSlotState | null | undefined,
): ContextWindowAggregate | null {
  if (usage) {
    return {
      totalTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
      percentage: usage.percentage,
      source: 'details',
    }
  }
  if (!compactState || compactState.total.totalTokens <= 0) {
    return null
  }
  return {
    totalTokens: compactState.total.totalTokens,
    maxTokens: compactState.modelContextWindow,
    percentage: compactState.usagePercent,
    source: 'compact',
  }
}

function readContextSections(usage: ChatRuntimeContextUsage | null): ChatRuntimeContextUsageSection[] {
  return [...(usage?.sections ?? [])]
    .filter(section => section.tokenCount > 0 || section.items.some(item => item.tokenCount > 0))
    .sort((left, right) => right.tokenCount - left.tokenCount)
}

function formatUsagePercent(value: number | null): string {
  return value === null ? 'unknown' : `${clampPercent(value)}%`
}

function readSectionLabel(section: ChatRuntimeContextUsageSection): string {
  return SECTION_LABELS[section.kind] ?? section.label
}

function readSectionToneClassName(kind: string): string {
  return SECTION_TONE_CLASS_NAMES[kind] ?? SECTION_TONE_CLASS_NAMES.others
}

function readSectionIcon(kind: string) {
  switch (kind) {
    case 'system-prompt':
      return FileTextIcon
    case 'messages':
      return MessageSquareIcon
    case 'tools':
    case 'tool-results':
    case 'mcp-tools':
      return WrenchIcon
    case 'memory-files':
    case 'attachments':
      return DatabaseIcon
    case 'skills':
      return PackageIcon
    case 'plugins':
      return PuzzleIcon
    case 'agents':
      return BotIcon
    default:
      return GaugeIcon
  }
}
