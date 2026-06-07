import { useQuery } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useCallback, useMemo } from 'react'

import { Separator } from '~/components/ui/separator'
import { cn } from '~/lib/cn'
import { clampPercent, formatTokenCount } from '~/lib/number-format'
import { useBrowserPanelStore } from '~/store/browser-panel'

import type {
  ChatRuntimeCompactUiSlotState,
  ChatRuntimeContextUsage,
  ChatRuntimeContextUsageSection,
} from './chat-capabilities'
import { getChatRuntimeContextUsage } from './chat-capabilities'

interface ContextUsageDetailPanelProps {
  sessionId: string | null
  compactState?: ChatRuntimeCompactUiSlotState | null
  onClose: () => void
}

interface ContextWindowAggregate {
  totalTokens: number
  maxTokens: number | null
  percentage: number | null
  source: 'details' | 'compact'
}

const SECTION_ACCENT: Record<string, { dot: string, bar: string }> = {
  'system-prompt': {
    dot: 'bg-(--color-neutral-6)',
    bar: 'bg-(--color-neutral-6)',
  },
  'messages': {
    dot: 'bg-(--color-accent-diff)',
    bar: 'bg-(--color-accent-diff)',
  },
  'tools': {
    dot: 'bg-(--color-accent-session)',
    bar: 'bg-(--color-accent-session)',
  },
  'tool-results': {
    dot: 'bg-(--color-accent-summary)',
    bar: 'bg-(--color-accent-summary)',
  },
  'memory-files': {
    dot: 'bg-(--color-accent-scope)',
    bar: 'bg-(--color-accent-scope)',
  },
  'attachments': {
    dot: 'bg-(--color-accent-global)',
    bar: 'bg-(--color-accent-global)',
  },
  'skills': {
    dot: 'bg-(--color-accent-legacy)',
    bar: 'bg-(--color-accent-legacy)',
  },
  'mcp-tools': {
    dot: 'bg-(--color-accent-summary)',
    bar: 'bg-(--color-accent-summary)',
  },
  'plugins': {
    dot: 'bg-(--color-accent-legacy)',
    bar: 'bg-(--color-accent-legacy)',
  },
  'agents': {
    dot: 'bg-(--color-accent)',
    bar: 'bg-(--color-accent)',
  },
  'slash-commands': {
    dot: 'bg-(--color-info)',
    bar: 'bg-(--color-info)',
  },
  'others': {
    dot: 'bg-(--color-success)',
    bar: 'bg-(--color-success)',
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

export function ContextUsageDetailPanel({
  sessionId,
  compactState,
  onClose,
}: ContextUsageDetailPanelProps) {
  const openContextUsageReportTab = useBrowserPanelStore(
    state => state.openContextUsageReportTab,
  )
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
  const handleOpenReport = useCallback(() => {
    if (!sessionId) {
      return
    }
    openContextUsageReportTab({ sessionId })
    onClose()
  }, [onClose, openContextUsageReportTab, sessionId])

  if (!sessionId) {
    return null
  }

  return (
    <m.div
      initial={{ opacity: 0, scale: 0.96, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 4 }}
      transition={{ type: 'spring', stiffness: 600, damping: 40 }}
      className="w-90 rounded-xl bg-popover ring-1 ring-foreground/8"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="text-[13px] font-medium text-foreground">Context Usage</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleOpenReport}
            className="text-[12px] text-(--color-neutral-6) transition-colors hover:text-foreground"
          >
            View Report
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-(--color-neutral-6) transition-colors hover:text-foreground"
            aria-label="Close"
          >
            <XIcon className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <Separator />

      {/* Body */}
      <div className="px-4 py-3">
        <AnimatePresence mode="wait">
          {aggregate
            ? (
              <m.div
                key="content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {/* Metric row */}
                <div className="flex items-baseline justify-between">
                  <span className="text-[14px] font-semibold tabular-nums text-foreground">
                    {formatUsagePercent(aggregate.percentage)} Full
                  </span>
                  <span className="text-[12px] tabular-nums text-(--color-neutral-6)">
                    ~{formatTokenCount(aggregate.totalTokens)} / {formatTokenCount(aggregate.maxTokens ?? 0)} Tokens
                  </span>
                </div>

                {/* Segmented progress bar */}
                {sections.length > 0 && (
                  <div className="relative h-1 w-full overflow-hidden rounded-sm bg-(--color-neutral-3)">
                    <div className="absolute inset-0 flex gap-px">
                      {sections.map((section) => {
                        const percent = aggregate.totalTokens > 0
                          ? (section.tokenCount / aggregate.totalTokens) * 100
                          : 0
                        if (percent < 0.5) return null
                        const accent = getSectionAccent(section.kind)
                        return (
                          <m.div
                            key={section.kind}
                            className={cn('h-full', accent.bar)}
                            initial={{ width: 0 }}
                            animate={{ width: `${clampPercent(percent)}%` }}
                            transition={{ type: 'spring', stiffness: 500, damping: 35, delay: 0.05 }}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Section list */}
                {sections.length > 0
                  ? (
                    <div className="space-y-px">
                      {sections.map((section, index) => {
                        const accent = getSectionAccent(section.kind)
                        return (
                          <m.div
                            key={section.kind}
                            initial={{ opacity: 0, x: -4 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ type: 'spring', stiffness: 600, damping: 40, delay: index * 0.02 }}
                            className="flex items-center gap-2.5 py-1.75"
                          >
                            <span className={cn('size-2 shrink-0 rounded-xs', accent.dot)} />
                            <span className="min-w-0 flex-1 text-[13px] text-foreground">
                              {readSectionLabel(section)}
                            </span>
                            <span className="shrink-0 text-[13px] tabular-nums text-foreground">
                              {formatTokenCount(section.tokenCount)}
                            </span>
                          </m.div>
                        )
                      })}
                    </div>
                  )
                  : (
                    <FallbackMessage isLoading={isLoading} isError={isError} />
                  )}
              </m.div>
            )
            : (
              <FallbackMessage key="fallback" isLoading={isLoading} isError={isError} />
            )}
        </AnimatePresence>
      </div>
    </m.div>
  )
}

function FallbackMessage({ isLoading, isError }: { isLoading: boolean, isError: boolean }) {
  return (
    <p className="py-2 text-[13px] text-(--color-neutral-6)">
      {isLoading
        ? 'Loading context usage...'
        : isError
          ? 'Failed to load context usage'
          : 'Context usage unavailable'}
    </p>
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
  return value === null ? 'Unknown' : `${clampPercent(value)}%`
}

function readSectionLabel(section: ChatRuntimeContextUsageSection): string {
  return SECTION_LABELS[section.kind] ?? section.label
}

function getSectionAccent(kind: string) {
  return SECTION_ACCENT[kind] ?? SECTION_ACCENT.others
}
