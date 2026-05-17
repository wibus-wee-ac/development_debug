import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, m } from 'motion/react'

import { getSessionAwaitsByIdLiveStatusOptions, getSessionAwaitsOptions } from '~/api-gen/@tanstack/react-query.gen'
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

// ── Icons ──

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={cn('size-3.5', className)}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function CheckRunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3', className)}>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FailRunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3', className)}>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function SpinRunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3 animate-spin', className)}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="10 30" strokeLinecap="round" />
    </svg>
  )
}

function QueuedRunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3', className)}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
    </svg>
  )
}

function RunStatusIcon({ run }: { run: LiveCheckRun }) {
  const icon = (() => {
    if (run.status === 'completed') {
      if (run.conclusion === 'success' || run.conclusion === 'neutral' || run.conclusion === 'skipped') {
        return <CheckRunIcon className="text-green-500" />
      }
      if (run.conclusion === 'cancelled') {
        return <QueuedRunIcon className="text-muted-foreground" />
      }
      return <FailRunIcon className="text-red-500" />
    }
    if (run.status === 'in_progress') {
      return <SpinRunIcon className="text-amber-500" />
    }
    return <QueuedRunIcon className="text-muted-foreground/60" />
  })()

  return (
    <AnimatePresence mode="wait">
      <m.span
        key={`${run.status}-${run.conclusion}`}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="inline-flex"
      >
        {icon}
      </m.span>
    </AnimatePresence>
  )
}

// ── Tree structure ──

const MAX_TREE_DEPTH = 3

interface TreeNode {
  label: string
  run: LiveCheckRun | null
  children: TreeNode[]
}

function buildRunTree(runs: LiveCheckRun[]): TreeNode[] {
  const root: TreeNode[] = []
  const rootIndex = new Map<string, { node: TreeNode, childIndex: Map<string, { node: TreeNode, childIndex: any }> }>()

  for (const run of runs) {
    const segments = run.name.split(' / ').map(s => s.trim())
    const limited = segments.length > MAX_TREE_DEPTH
      ? [...segments.slice(0, MAX_TREE_DEPTH - 1), segments.slice(MAX_TREE_DEPTH - 1).join(' / ')]
      : segments

    let currentLevel = root
    let currentIndex: Map<string, any> = rootIndex
    for (let i = 0; i < limited.length; i++) {
      const segment = limited[i]
      const isLeaf = i === limited.length - 1
      let entry = currentIndex.get(segment)

      if (!entry) {
        const node: TreeNode = { label: segment, run: isLeaf ? run : null, children: [] }
        entry = { node, childIndex: new Map() }
        currentLevel.push(node)
        currentIndex.set(segment, entry)
      }
      else if (isLeaf) {
        entry.node.run = run
      }
      currentLevel = entry.node.children
      currentIndex = entry.childIndex
    }
  }

  return root
}

// ── Tree rendering with rounded connectors ──

// ── SVG Tree connector ──

const TREE_INDENT = 14
const ROW_H = 22
const CORNER_R = 5
const STROKE_W = 1.5
const TRUNK_X = STROKE_W / 2
const BRANCH_END = TREE_INDENT + 5 // extend to dot center

function countRows(node: TreeNode): number {
  let c = 1
  for (const child of node.children) {
    c += countRows(child)
  }
  return c
}

/**
 * Build SVG path for tree connectors.
 * The trunk comes from above (parent), each node gets a rounded branch off it.
 * - All nodes (including first): trunk descends, then a rounded branch curves to the right
 * - Middle nodes: trunk continues past the branch point
 * - Last node: trunk ends at the branch curve
 * - Single node: trunk comes from top, curves to the right (no straight horizontal)
 */
function buildConnectorPath(offsets: number[]): string {
  if (offsets.length === 0) {
    return ''
  }

  const d: string[] = []
  const lastIdx = offsets.length - 1

  // Trunk: vertical line from top (y=0) to just before last node's curve
  const lastMidY = offsets[lastIdx] * ROW_H + ROW_H / 2
  d.push(`M ${TRUNK_X} 0 L ${TRUNK_X} ${lastMidY - CORNER_R}`)
  // Last node: curve out
  d.push(`Q ${TRUNK_X} ${lastMidY} ${TRUNK_X + CORNER_R} ${lastMidY} L ${BRANCH_END} ${lastMidY}`)

  // Branch curves for all nodes except last (they branch off the trunk with a curve)
  for (let i = 0; i < lastIdx; i++) {
    const midY = offsets[i] * ROW_H + ROW_H / 2
    // Small curve from trunk going right, trunk continues below
    d.push(`M ${TRUNK_X} ${midY - CORNER_R} Q ${TRUNK_X} ${midY} ${TRUNK_X + CORNER_R} ${midY} L ${BRANCH_END} ${midY}`)
  }

  return d.join(' ')
}

/** Renders the trunk line + branch connectors for a list of sibling nodes */
function TreeLevel({ nodes }: { nodes: TreeNode[] }) {
  const offsets: number[] = []
  let acc = 0
  for (const node of nodes) {
    offsets.push(acc)
    acc += countRows(node)
  }
  const totalH = acc * ROW_H
  const pathD = buildConnectorPath(offsets)

  return (
    <div className="relative" style={{ paddingLeft: TREE_INDENT }}>
      <svg
        className="absolute left-0 top-0 pointer-events-none overflow-visible"
        width={TREE_INDENT}
        height={totalH}
        aria-hidden
      >
        <path
          d={pathD}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE_W}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-foreground/12"
        />
      </svg>

      {nodes.map((node, i) => (
        <TreeItem key={node.label} node={node} isLast={i === nodes.length - 1} />
      ))}
    </div>
  )
}

function TreeItem({ node, isLast: _isLast }: { node: TreeNode, isLast: boolean }) {
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div className="flex items-center gap-1.5 min-w-0" style={{ height: ROW_H }}>
        {node.run && <RunStatusIcon run={node.run} />}
        {!node.run && hasChildren && (
          <span className="size-2 rounded-full bg-foreground/40 shrink-0" />
        )}
        <span className={cn(
          'truncate text-[11px]',
          node.run ? 'text-foreground/80' : 'text-muted-foreground font-medium',
        )}
        >
          {node.label}
        </span>
        {node.run?.required && (
          <span className="shrink-0 text-[9px] text-muted-foreground/40 border border-border rounded px-0.5">req</span>
        )}
      </div>

      {hasChildren && (
        <div style={{ marginLeft: 3 }}>
          <TreeLevel nodes={node.children} />
        </div>
      )}
    </div>
  )
}

// ── Card ──

function SourceCard({ awaitRow }: { awaitRow: AwaitRow }) {
  const { data: rawData } = useLiveCIStatus(awaitRow.source === 'github-ci' ? awaitRow.id : null)
  const data = rawData as (LiveCIStatus | { supported: false }) | undefined

  if (!data || !data.supported) {
    return (
      <div className="rounded-md border border-border p-3">
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
      <div className="rounded-md border border-border p-3">
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <GitHubIcon />
          <span>GitHub token not available</span>
        </div>
      </div>
    )
  }

  const tree = buildRunTree(ci.runs)

  return (
    <div className="rounded-md border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <GitHubIcon className="shrink-0 text-foreground/70" />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-medium text-foreground/90 truncate block">
            {ci.prNumber && (
<span className="text-muted-foreground/60">
#
{ci.prNumber}
</span>
)}
            {ci.prNumber && ' '}
            {ci.prTitle ?? `${ci.owner}/${ci.repo}`}
          </span>
        </div>
      </div>

      {/* Tree runs — connector originates from header icon position */}
      {tree.length > 0 && (
        <div className="px-3 pb-2">
          <div className="ml-1.25">
            <TreeLevel nodes={tree} />
          </div>
        </div>
      )}

      {ci.runs.length === 0 && (
        <div className="px-3 pb-2 text-[11px] text-muted-foreground">
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
        <p className="text-[11px] text-muted-foreground">No session selected</p>
      </div>
    )
  }

  const activeAwaits = awaits.filter(a => a.status === 'pending')
  const pastAwaits = awaits.filter(a => a.status !== 'pending')

  if (awaits.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[11px] text-muted-foreground">No awaits</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-3 gap-y-3">
      {activeAwaits.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] text-muted-foreground/50">Active</span>
          {activeAwaits.map(a => (
            <SourceCard key={a.id} awaitRow={a} />
          ))}
        </div>
      )}
      {pastAwaits.length > 0 && (
        <div className="space-y-2">
          {pastAwaits.map(a => (
            <SourceCard key={a.id} awaitRow={a} />
          ))}
        </div>
      )}
    </div>
  )
}
