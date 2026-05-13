import { useQuery } from '@tanstack/react-query'
import { GitPullRequestIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

import { getSessionAwaitsOptions, getSessionAwaitsByIdLiveStatusOptions } from '~/api-gen/@tanstack/react-query.gen'
import type { GetSessionAwaitsResponse } from '~/api-gen/types.gen'
import { cn } from '~/lib/cn'

// ── Types ──

type AwaitRow = GetSessionAwaitsResponse[number]

interface LiveCheckRun {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
  required: boolean
}

interface LiveCIStatus {
  supported: true
  owner: string
  repo: string
  prNumber: number | null
  prTitle: string | null
  ref: string
  runs: LiveCheckRun[]
  allCompleted: boolean
  allPassed: boolean
  hasToken: boolean
}

// ── Hooks ──

function useSessionAwaits(sessionId: string | null) {
  return useQuery({
    ...getSessionAwaitsOptions({ query: { sessionId: sessionId! } }),
    enabled: !!sessionId,
    refetchInterval: 15_000,
  })
}

function useLiveCIStatus(awaitId: string | null) {
  return useQuery({
    ...getSessionAwaitsByIdLiveStatusOptions({ path: { id: awaitId! } }),
    enabled: !!awaitId,
    refetchInterval: 20_000,
  })
}

// ── Status Icons (animated with Motion) ──

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3.5', className)}>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3.5', className)}>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function SpinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3.5 animate-spin', className)}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="10 30" strokeLinecap="round" />
    </svg>
  )
}

function QueuedIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3.5', className)}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
    </svg>
  )
}

function CancelledIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3.5', className)}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M5.5 8h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function RunStatusIcon({ run }: { run: LiveCheckRun }) {
  const getIcon = () => {
    if (run.status === 'completed') {
      if (run.conclusion === 'success' || run.conclusion === 'neutral' || run.conclusion === 'skipped') {
        return <CheckIcon className="text-green-500" />
      }
      if (run.conclusion === 'cancelled') {
        return <CancelledIcon className="text-muted-foreground" />
      }
      return <FailIcon className="text-red-500" />
    }
    if (run.status === 'in_progress') {
      return <SpinIcon className="text-amber-500" />
    }
    return <QueuedIcon className="text-muted-foreground/60" />
  }

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={`${run.status}-${run.conclusion}`}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="inline-flex"
      >
        {getIcon()}
      </motion.span>
    </AnimatePresence>
  )
}

// ── CI Run Item ──

function CIRunItem({ run, isLast }: { run: LiveCheckRun, isLast: boolean }) {
  return (
    <div className="relative flex items-start gap-2 pl-3">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-3.25 top-4.5 -bottom-0.5 w-px bg-border/50" />
      )}
      <div className="relative z-10 mt-0.75 shrink-0">
        <RunStatusIcon run={run} />
      </div>
      <div className="flex flex-1 items-center gap-1.5 min-w-0 py-0.5">
        <span className="truncate text-[11px] text-foreground/80">{run.name}</span>
        {run.required && (
          <span className="shrink-0 text-[9px] text-muted-foreground/60 border border-border/40 rounded px-1">required</span>
        )}
      </div>
    </div>
  )
}

// ── PR Card ──

function PRCard({ awaitRow }: { awaitRow: AwaitRow }) {
  const { data: rawData } = useLiveCIStatus(awaitRow.source === 'github-ci' ? awaitRow.id : null)
  const data = rawData as (LiveCIStatus | { supported: false }) | undefined

  if (!data || !data.supported) {
    return (
      <div className="rounded-md border border-border/30 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="capitalize">{awaitRow.source}</span>
          <span>·</span>
          <span>{(awaitRow.reason as string) ?? 'Waiting...'}</span>
        </div>
      </div>
    )
  }

  const ci = data as LiveCIStatus

  if (!ci.hasToken) {
    return (
      <div className="rounded-md border border-border/30 p-3">
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <GitPullRequestIcon className="size-3.5" />
          <span>GitHub token not available — cannot fetch CI status</span>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border/30 overflow-hidden">
      {/* PR Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20">
        <GitPullRequestIcon className="size-3.5 shrink-0 text-green-500" />
        <span className="text-[11px] font-medium text-foreground/90 truncate">
          {ci.prNumber && <span className="text-muted-foreground">#{ci.prNumber}</span>}
          {' '}
          {ci.prTitle ?? `${ci.owner}/${ci.repo}`}
        </span>
      </div>

      {/* Check runs */}
      {ci.runs.length > 0 && (
        <div className="px-2 py-2 space-y-0.5">
          {ci.runs.map((run, i) => (
            <CIRunItem key={run.name} run={run} isLast={i === ci.runs.length - 1} />
          ))}
        </div>
      )}

      {ci.runs.length === 0 && (
        <div className="px-3 py-2 text-[11px] text-muted-foreground">
          No checks found yet
        </div>
      )}
    </div>
  )
}

// ── Main Panel ──

interface AwaitPanelProps {
  sessionId: string | null
}

export function AwaitPanel({ sessionId }: AwaitPanelProps) {
  const { data: awaits = [] } = useSessionAwaits(sessionId)

  if (!sessionId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[11px] text-muted-foreground">未选择会话</p>
      </div>
    )
  }

  const activeAwaits = awaits.filter(a => a.status === 'pending')
  const pastAwaits = awaits.filter(a => a.status !== 'pending')

  if (awaits.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[11px] text-muted-foreground">暂无等待项</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-3 py-3 space-y-3">
      {activeAwaits.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] text-muted-foreground/60">进行中</span>
          {activeAwaits.map(a => (
            <PRCard key={a.id} awaitRow={a} />
          ))}
        </div>
      )}
      {pastAwaits.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] text-muted-foreground/60">已完成</span>
          {pastAwaits.map(a => (
            <PRCard key={a.id} awaitRow={a} />
          ))}
        </div>
      )}
    </div>
  )
}
