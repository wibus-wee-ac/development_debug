import { useQuery } from '@tanstack/react-query'
import {
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FileTextIcon,
  ListIcon,
  MessageSquareIcon,
  PackageIcon,
  PuzzleIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'

import { cn } from '~/lib/cn'
import { clampPercent, formatTokenCount } from '~/lib/number-format'
import { getChatRuntimeContextUsage, ChatRuntimeContextUsageSection, ChatRuntimeContextUsageItem, ChatRuntimeContextUsage } from '../chat/capabilities/chat-capabilities'

interface ContextUsageReportProps {
  sessionId: string
  sessionTitle: string | null
}

interface ContextUsageAggregate {
  totalTokens: number
  maxTokens: number | null
  percentage: number | null
  remainingTokens: number | null
}

const SECTION_ACCENT: Record<string, { dot: string, bar: string, icon: string, surface: string }> = {
  'system-prompt': {
    dot: 'bg-slate-500',
    bar: 'bg-slate-500',
    icon: 'text-slate-500',
    surface: 'bg-slate-50 dark:bg-slate-900/50',
  },
  'messages': {
    dot: 'bg-orange-500',
    bar: 'bg-orange-500',
    icon: 'text-orange-500',
    surface: 'bg-orange-50 dark:bg-orange-950/40',
  },
  'tools': {
    dot: 'bg-violet-500',
    bar: 'bg-violet-500',
    icon: 'text-violet-500',
    surface: 'bg-violet-50 dark:bg-violet-950/40',
  },
  'tool-results': {
    dot: 'bg-pink-500',
    bar: 'bg-pink-500',
    icon: 'text-pink-500',
    surface: 'bg-pink-50 dark:bg-pink-950/40',
  },
  'memory-files': {
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
    icon: 'text-emerald-500',
    surface: 'bg-emerald-50 dark:bg-emerald-950/40',
  },
  'attachments': {
    dot: 'bg-sky-500',
    bar: 'bg-sky-500',
    icon: 'text-sky-500',
    surface: 'bg-sky-50 dark:bg-sky-950/40',
  },
  'skills': {
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
    icon: 'text-amber-500',
    surface: 'bg-amber-50 dark:bg-amber-950/40',
  },
  'mcp-tools': {
    dot: 'bg-rose-500',
    bar: 'bg-rose-500',
    icon: 'text-rose-500',
    surface: 'bg-rose-50 dark:bg-rose-950/40',
  },
  'plugins': {
    dot: 'bg-cyan-500',
    bar: 'bg-cyan-500',
    icon: 'text-cyan-500',
    surface: 'bg-cyan-50 dark:bg-cyan-950/40',
  },
  'agents': {
    dot: 'bg-blue-500',
    bar: 'bg-blue-500',
    icon: 'text-blue-500',
    surface: 'bg-blue-50 dark:bg-blue-950/40',
  },
  'slash-commands': {
    dot: 'bg-indigo-500',
    bar: 'bg-indigo-500',
    icon: 'text-indigo-500',
    surface: 'bg-indigo-50 dark:bg-indigo-950/40',
  },
  'others': {
    dot: 'bg-teal-500',
    bar: 'bg-teal-500',
    icon: 'text-teal-500',
    surface: 'bg-teal-50 dark:bg-teal-950/40',
  },
}

const SECTION_LABELS: Record<string, string> = {
  'system-prompt': 'System prompt',
  'messages': 'Conversation',
  'tools': 'Tool definitions',
  'tool-results': 'Tool results',
  'memory-files': 'File context',
  'attachments': 'Attachments',
  'skills': 'Skills',
  'mcp-tools': 'MCP',
  'plugins': 'Plugins',
  'agents': 'Subagent definitions',
  'slash-commands': 'Slash commands',
  'others': 'Rules',
}

export function ContextUsageReport({
  sessionId,
  sessionTitle,
}: ContextUsageReportProps) {
  const [expandedSectionKinds, setExpandedSectionKinds] = useState<Set<string>>(() => new Set())
  const { data, isError, isLoading } = useQuery({
    queryKey: ['chat', 'context-window-usage', sessionId],
    queryFn: ({ signal }) => getChatRuntimeContextUsage(sessionId, signal),
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  })

  const usage = data?.usage ?? null
  const aggregate = useMemo(() => readContextAggregate(usage), [usage])
  const sections = useMemo(() => readContextSections(usage), [usage])
  const expandedAll = sections.length > 0
    && sections.every(section => expandedSectionKinds.has(section.kind))

  const toggleSection = (kind: string) => {
    setExpandedSectionKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) {
        next.delete(kind)
      }
      else {
        next.add(kind)
      }
      return next
    })
  }

  const toggleAll = () => {
    setExpandedSectionKinds(() => {
      if (expandedAll) {
        return new Set()
      }
      return new Set(sections.map(section => section.kind))
    })
  }

  if (isLoading || isError || !aggregate || !usage) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-background">
        <div className="text-[13px] text-(--color-neutral-6)">
          {isLoading
            ? 'Loading context usage...'
            : isError
              ? 'Failed to load context usage'
              : 'Context usage unavailable'}
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl px-6 py-10">
          {/* Header */}
          <m.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 40 }}
            className="mb-8"
          >
            <p className="text-[12px] text-(--color-neutral-6)">Context Usage Report</p>
            <h1 className="mt-1 text-[22px] font-semibold text-foreground">
              {sessionTitle || 'Untitled Session'}
            </h1>
          </m.div>

          {/* Summary stats */}
          <m.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 40, delay: 0.04 }}
            className="mb-6 grid grid-cols-3 gap-8"
          >
            <div>
              <div className="text-[12px] text-(--color-neutral-6)">Repository</div>
              <div className="mt-0.5 text-[14px] font-medium text-foreground">
                {usage.runtimeKind || 'Unknown'}
              </div>
            </div>
            <div>
              <div className="text-[12px] text-(--color-neutral-6)">Context size</div>
              <div className="mt-0.5 text-[14px] font-medium text-foreground">
                {aggregate.maxTokens ? formatTokenCount(aggregate.maxTokens) : 'Unknown'}
              </div>
            </div>
            <div>
              <div className="text-[12px] text-(--color-neutral-6)">Tokens used</div>
              <div className="mt-0.5 text-[14px] font-medium text-foreground">
                ~{formatTokenCount(aggregate.totalTokens)}
              </div>
            </div>
          </m.div>

          {/* Description */}
          <m.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 40, delay: 0.06 }}
            className="mb-8 text-[13px] leading-relaxed text-(--color-neutral-6)"
          >
            The context window contains everything your agent sees on a single turn. This includes
            system instructions, any relevant files, the tools it can access, and the conversation
            itself. The agent reads all of this each turn, and it can only hold so much. As the
            context window fills up, the agent has less room to reason, replies can slow down, and
            older details may be dropped to make space.
          </m.p>

          {/* Donut Chart */}
          <m.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 600, damping: 40, delay: 0.08 }}
            className="mb-10 flex items-center justify-center"
          >
            <DonutChart
              percentage={aggregate.percentage ?? 0}
              sections={sections}
              totalTokens={aggregate.totalTokens}
              maxTokens={aggregate.maxTokens}
            />
          </m.div>

          <Separator className="mb-8" />

          {/* Context Explorer */}
          <m.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 40, delay: 0.1 }}
            className="mb-4 flex items-center justify-between"
          >
            <h2 className="text-[18px] font-semibold text-foreground">Context Explorer</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleAll}
              className="text-[12px]"
            >
              {expandedAll ? 'Collapse All' : 'Expand All'}
            </Button>
          </m.div>

          <m.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 40, delay: 0.12 }}
            className="mb-6 text-[13px] text-(--color-neutral-6)"
          >
            The categories below show what's in your agent's context window, sorted by how many
            tokens it's using right now.
          </m.p>

          {/* Sections */}
          <div className="space-y-2">
            <AnimatePresence>
              {sections.map((section, index) => (
                <m.div
                  key={section.kind}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 40, delay: 0.14 + index * 0.03 }}
                >
                  <ContextSectionCard
                    section={section}
                    totalTokens={aggregate.totalTokens}
                    open={expandedSectionKinds.has(section.kind)}
                    onToggle={() => toggleSection(section.kind)}
                  />
                </m.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

function DonutChart({
  percentage,
  sections,
  totalTokens,
  maxTokens,
}: {
  percentage: number
  sections: ChatRuntimeContextUsageSection[]
  totalTokens: number
  maxTokens: number | null
}) {
  const size = 180
  const strokeWidth = 26
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI

  // Each segment's arc = tokenCount / maxTokens * circumference
  // so segments collectively fill exactly the "used" portion of the ring.
  // Fall back to totalTokens denominator if maxTokens is unavailable.
  const denominator = maxTokens ?? totalTokens

  let cumulativeArc = 0
  const arcs = sections.map((section) => {
    const arcLength = denominator > 0
      ? (section.tokenCount / denominator) * circumference
      : 0
    const arc = {
      kind: section.kind,
      arcLength,
      startArc: cumulativeArc,
    }
    cumulativeArc += arcLength
    return arc
  }).filter(arc => arc.arcLength > 1)

  return (
    <div className="relative">
      <svg width={size} height={size} className="-rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-(--color-neutral-3)"
        />

        {/* Colored segments — each starts at its cumulative offset */}
        {arcs.map((arc) => {
          const dash = Math.max(0, arc.arcLength - 1.5)
          // dashoffset = circumference - startArc shifts the dash to begin at startArc
          const dashOffset = circumference - arc.startArc

          return (
            <circle
              key={arc.kind}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              className={getStrokeClass(arc.kind)}
            />
          )
        })}
      </svg>

      {/* Center label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[32px] font-bold tabular-nums text-foreground">
          {Math.round(percentage)}%
        </span>
        <span className="text-[12px] text-(--color-neutral-6)">Full</span>
      </div>
    </div>
  )
}

function ContextSectionCard({
  section,
  totalTokens,
  open,
  onToggle,
}: {
  section: ChatRuntimeContextUsageSection
  totalTokens: number
  open: boolean
  onToggle: () => void
}) {
  const hasItems = section.items.length > 0
  const accent = getSectionAccent(section.kind)
  const Icon = getSectionIcon(section.kind)

  return (
    <Collapsible open={open} onOpenChange={hasItems ? onToggle : undefined}>
      <div className={cn(
        'overflow-hidden rounded-xl transition-colors',
        accent.surface,
      )}
      >
        <CollapsibleTrigger asChild disabled={!hasItems}>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
          >
            {hasItems
              ? open
                ? <ChevronDownIcon className="size-4 shrink-0 text-(--color-neutral-6)" />
                : <ChevronRightIcon className="size-4 shrink-0 text-(--color-neutral-6)" />
              : <span className="size-4 shrink-0" />}

            <Icon className={cn('size-4 shrink-0', accent.icon)} aria-hidden="true" />

            <span className="min-w-0 flex-1">
              <span className="text-[14px] font-medium text-foreground">
                {readSectionLabel(section)}
              </span>
              {section.items.length > 0 && (
                <span className="ml-2 text-[12px] tabular-nums text-(--color-neutral-6)">
                  {section.items.length}
                </span>
              )}
            </span>

            <span className="shrink-0 text-[13px] tabular-nums text-(--color-neutral-6)">
              ~{formatTokenCount(section.tokenCount)} tokens
            </span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-black/5 px-4 py-3 dark:border-white/5">
            <div className="space-y-0.5">
              {section.items.map((item, index) => (
                <ContextItemRow
                  key={`${item.kind}:${item.label}:${index}`}
                  item={item}
                  sectionKind={section.kind}
                />
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function ContextItemRow({
  item,
  sectionKind,
}: {
  item: ChatRuntimeContextUsageItem
  sectionKind: string
}) {
  const [expanded, setExpanded] = useState(false)
  const hasMetadata = item.metadata && Object.keys(item.metadata).length > 0
  const accent = getSectionAccent(sectionKind)

  return (
    <div className="rounded-md">
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-black/3 dark:hover:bg-white/3"
        onClick={() => hasMetadata && setExpanded(!expanded)}
        disabled={!hasMetadata}
      >
        {hasMetadata
          ? expanded
            ? <ChevronDownIcon className="size-3.5 shrink-0 text-(--color-neutral-6)" />
            : <ChevronRightIcon className="size-3.5 shrink-0 text-(--color-neutral-6)" />
          : <span className="size-3.5 shrink-0" />}

        <span className={cn('size-2 shrink-0 rounded-full', accent.dot)} />

        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          {item.label}
        </span>

        <span className="shrink-0 text-[12px] tabular-nums text-(--color-neutral-6)">
          ~{formatTokenCount(item.tokenCount)}
        </span>
      </button>

      {expanded && hasMetadata && (
        <m.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden pl-10 pr-3 pb-2"
        >
          <div className="rounded-md bg-black/3 px-3 py-2 dark:bg-white/3">
            {Object.entries(item.metadata || {}).map(([key, value]) => (
              <div key={key} className="flex gap-2 py-0.5 text-[11px]">
                <span className="shrink-0 font-medium text-(--color-neutral-7)">{key}</span>
                <span className="min-w-0 truncate text-(--color-neutral-6)">{formatMetadataValue(value)}</span>
              </div>
            ))}
          </div>
        </m.div>
      )}
    </div>
  )
}

function readContextAggregate(usage: ChatRuntimeContextUsage | null): ContextUsageAggregate | null {
  if (!usage) {
    return null
  }
  return {
    totalTokens: usage.totalTokens,
    maxTokens: usage.maxTokens,
    percentage: usage.percentage,
    remainingTokens: usage.maxTokens === null ? null : Math.max(0, usage.maxTokens - usage.totalTokens),
  }
}

function readContextSections(usage: ChatRuntimeContextUsage | null): ChatRuntimeContextUsageSection[] {
  return [...(usage?.sections ?? [])]
    .filter(section => section.tokenCount > 0 || section.items.some(item => item.tokenCount > 0))
    .sort((left, right) => right.tokenCount - left.tokenCount)
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `${value.length} items`
  }
  if (typeof value === 'object' && value !== null) {
    return 'object'
  }
  return String(value)
}

function readSectionLabel(section: ChatRuntimeContextUsageSection): string {
  return SECTION_LABELS[section.kind] ?? section.label
}

function getSectionAccent(kind: string) {
  return SECTION_ACCENT[kind] ?? SECTION_ACCENT.others
}

function getStrokeClass(kind: string): string {
  const map: Record<string, string> = {
    'system-prompt': 'stroke-slate-500',
    'messages': 'stroke-orange-500',
    'tools': 'stroke-violet-500',
    'tool-results': 'stroke-pink-500',
    'memory-files': 'stroke-emerald-500',
    'attachments': 'stroke-sky-500',
    'skills': 'stroke-amber-500',
    'mcp-tools': 'stroke-rose-500',
    'plugins': 'stroke-cyan-500',
    'agents': 'stroke-blue-500',
    'slash-commands': 'stroke-indigo-500',
    'others': 'stroke-teal-500',
  }
  return map[kind] ?? 'stroke-slate-400'
}

function getSectionIcon(kind: string) {
  switch (kind) {
    case 'system-prompt':
      return FileTextIcon
    case 'messages':
      return MessageSquareIcon
    case 'tools':
      return WrenchIcon
    case 'tool-results':
      return WrenchIcon
    case 'memory-files':
      return DatabaseIcon
    case 'attachments':
      return DatabaseIcon
    case 'skills':
      return ZapIcon
    case 'mcp-tools':
      return PuzzleIcon
    case 'plugins':
      return PuzzleIcon
    case 'agents':
      return BotIcon
    case 'slash-commands':
      return PackageIcon
    case 'others':
      return ListIcon
    default:
      return ListIcon
  }
}
