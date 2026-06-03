import {
  ActivityIcon,
  CircleAlertIcon,
  CpuIcon,
  MemoryStickIcon,
  MonitorIcon,
  PanelBottomIcon,
  RefreshCwIcon,
  ServerIcon,
  SquareTerminalIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'
import {
  bytesToMegabytes,
  formatCpuPercent,
  formatMegabytes,
  formatResourceUsage,
  formatUptimeSeconds,
} from '~/lib/number-format'

const SERVER_BASE = getServerUrl()
const REFRESH_INTERVAL_MS = 3000
const PATH_SEGMENT_SEPARATOR_PATTERN = /[\\/]/

const ServerHealthSchema = z.object({
  memory: z.object({
    heapUsed: z.number(),
    heapTotal: z.number(),
    rss: z.number(),
    external: z.number(),
  }),
  cpu: z.object({
    percent: z.number().nullable(),
    userMicros: z.number(),
    systemMicros: z.number(),
  }).optional(),
  uptime: z.number(),
}).passthrough()

const PtyResourceItemSchema = z.object({
  id: z.string(),
  role: z.enum(['cli-tui', 'bottom-panel']),
  pid: z.number(),
  executable: z.string(),
  cwd: z.string(),
  running: z.boolean(),
  startedAt: z.number(),
  cols: z.number(),
  rows: z.number(),
  rssMB: z.number().nullable(),
  cpuPercent: z.number().nullable().default(null),
  descendantCount: z.number().nullable(),
})

const PtyResourcesSchema = z.object({
  terminals: z.array(PtyResourceItemSchema),
  totals: z.object({
    cliTuiRssMB: z.number(),
    bottomPanelRssMB: z.number(),
    cliTuiCpuPercent: z.number().default(0),
    bottomPanelCpuPercent: z.number().default(0),
  }),
  timestamp: z.number(),
})

const ChronicleResourcesSchema = z.object({
  running: z.boolean(),
  pid: z.number().nullable(),
  rssMB: z.number().nullable(),
  cpuPercent: z.number().nullable().default(null),
})

export interface ServerHealth {
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
    external: number
  }
  cpu?: {
    percent: number | null
    userMicros: number
    systemMicros: number
  }
  uptime: number
}

export interface PtyResourceItem {
  id: string
  role: 'cli-tui' | 'bottom-panel'
  pid: number
  executable: string
  cwd: string
  running: boolean
  startedAt: number
  cols: number
  rows: number
  rssMB: number | null
  cpuPercent: number | null
  descendantCount: number | null
}

export interface PtyResources {
  terminals: PtyResourceItem[]
  totals: {
    cliTuiRssMB: number
    bottomPanelRssMB: number
    cliTuiCpuPercent: number
    bottomPanelCpuPercent: number
  }
  timestamp: number
}

interface ChronicleResources {
  running: boolean
  pid: number | null
  rssMB: number | null
  cpuPercent: number | null
}

interface RendererMemory {
  heapUsed: number
  heapTotal: number
  heapLimit: number
}

export interface ResourceSnapshot {
  rendererHeapUsed: number
  rendererHeapTotal: number
  rendererHeapLimit: number
  serverRss: number
  serverHeapUsed: number
  serverHeapTotal: number
  serverExternal: number
  serverCpuPercent: number | null
  serverUptime: number
  cliTuiRss: number
  cliTuiCpuPercent: number
  bottomPanelRss: number
  bottomPanelCpuPercent: number
  chronicleRunning: boolean
  chroniclePid: number | null
  chronicleRss: number
  chronicleCpuPercent: number | null
  terminals: PtyResourceItem[]
  timestamp: number
  updatedAtLabel: string
  warnings: string[]
}

interface ResourceSnapshotInput {
  renderer: RendererMemory
  server: ServerHealth | null
  pty: PtyResources | null
  chronicle: ChronicleResources | null
  timestamp: number
}

function readRendererMemory(): RendererMemory {
  if (typeof performance === 'undefined' || !('memory' in performance)) {
    return {
      heapUsed: 0,
      heapTotal: 0,
      heapLimit: 0,
    }
  }

  const memory = performance.memory as {
    usedJSHeapSize?: number
    totalJSHeapSize?: number
    jsHeapSizeLimit?: number
  }

  return {
    heapUsed: memory.usedJSHeapSize ?? 0,
    heapTotal: memory.totalJSHeapSize ?? 0,
    heapLimit: memory.jsHeapSizeLimit ?? 0,
  }
}

function formatTimestampLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour12: false })
}

function createResourceSnapshot({
  renderer,
  server,
  pty,
  chronicle,
  timestamp,
}: ResourceSnapshotInput): ResourceSnapshot {
  const mbToBytes = (mb: number) => mb * 1024 * 1024
  const warnings: string[] = []

  if (!server) {
    warnings.push('Server metrics unavailable')
  }
  if (!pty) {
    warnings.push('Terminal resource metrics unavailable')
  }

  return {
    rendererHeapUsed: renderer.heapUsed,
    rendererHeapTotal: renderer.heapTotal,
    rendererHeapLimit: renderer.heapLimit,
    serverRss: server ? mbToBytes(server.memory.rss) : 0,
    serverHeapUsed: server ? mbToBytes(server.memory.heapUsed) : 0,
    serverHeapTotal: server ? mbToBytes(server.memory.heapTotal) : 0,
    serverExternal: server ? mbToBytes(server.memory.external) : 0,
    serverCpuPercent: server?.cpu?.percent ?? null,
    serverUptime: server?.uptime ?? 0,
    cliTuiRss: pty ? mbToBytes(pty.totals.cliTuiRssMB) : 0,
    cliTuiCpuPercent: pty?.totals.cliTuiCpuPercent ?? 0,
    bottomPanelRss: pty ? mbToBytes(pty.totals.bottomPanelRssMB) : 0,
    bottomPanelCpuPercent: pty?.totals.bottomPanelCpuPercent ?? 0,
    chronicleRunning: chronicle?.running ?? false,
    chroniclePid: chronicle?.pid ?? null,
    chronicleRss: chronicle?.rssMB ? mbToBytes(chronicle.rssMB) : 0,
    chronicleCpuPercent: chronicle?.cpuPercent ?? null,
    terminals: pty?.terminals ?? [],
    timestamp,
    updatedAtLabel: formatTimestampLabel(timestamp),
    warnings,
  }
}

function MemoryBar({
  used,
  total,
  className,
}: {
  used: number
  total: number
  className?: string
}) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  return (
    <div className={className}>
      <Progress value={pct} className="h-2" />
    </div>
  )
}

function SectionRow({
  label,
  value,
  dimLabel = false,
  detail,
  branch,
}: {
  label: string
  value: string
  dimLabel?: boolean
  detail?: string
  branch?: 'middle' | 'last'
}) {
  return (
    <div className={cn('relative flex items-center gap-2 py-[3px]', branch && 'pl-6')}>
      {branch && <BranchConnector terminal={branch === 'last'} />}
      <span
        className={
          dimLabel
            ? 'text-muted-foreground flex-1 truncate text-[11px]'
            : 'flex-1 truncate text-[11px]'
        }
      >
        {label}
      </span>
      {detail && (
        <span className="max-w-24 shrink truncate text-[10px] text-muted-foreground/60">
          {detail}
        </span>
      )}
      <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{value}</span>
    </div>
  )
}

function BranchConnector({ terminal }: { terminal: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="absolute left-1 top-0 h-full w-4 text-border"
      fill="none"
      preserveAspectRatio="none"
      viewBox="0 0 16 24"
    >
      <path
        d={terminal ? 'M4 0 V12 Q4 16 8 16 H15' : 'M4 0 V24 M4 12 Q4 16 8 16 H15'}
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function ResourceGroup({
  icon,
  label,
  value,
  children,
}: {
  icon: ReactNode
  label: string
  value: string
  children?: ReactNode
}) {
  return (
    <div className="py-1">
      <div className="flex items-center gap-2 py-[3px]">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="flex-1 truncate text-[11px] font-medium">{label}</span>
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{value}</span>
      </div>
      {children}
    </div>
  )
}

async function requestResourceJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  return response.json()
}

function useResourceSnapshot() {
  const [snap, setSnap] = useState<ResourceSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [resourcesReady, setResourcesReady] = useState(false)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoading(true)
    try {
      const [healthRes, ptyRes, chronicleRes] = await Promise.allSettled([
        requestResourceJson(`${SERVER_BASE}/health`).then(data => ServerHealthSchema.parse(data) satisfies ServerHealth),
        requestResourceJson(`${SERVER_BASE}/terminal-sessions/resources`).then(data => PtyResourcesSchema.parse(data) satisfies PtyResources),
        requestResourceJson(`${SERVER_BASE}/chronicle/daemon/resources`).then(data => ChronicleResourcesSchema.parse(data) satisfies ChronicleResources),
      ])

      if (requestId === requestRef.current) {
        const server = healthRes.status === 'fulfilled' ? healthRes.value : null
        const pty = ptyRes.status === 'fulfilled' ? ptyRes.value : null
        const chronicle = chronicleRes.status === 'fulfilled' ? chronicleRes.value : null
        const renderer = readRendererMemory()
        const allResourcesReady = healthRes.status === 'fulfilled'
          && ptyRes.status === 'fulfilled'
          && chronicleRes.status === 'fulfilled'

        setSnap(createResourceSnapshot({
          renderer,
          server,
          pty,
          chronicle,
          timestamp: Date.now(),
        }))
        setResourcesReady(allResourcesReady)
      }
    }
    finally {
      if (requestId === requestRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
    const intervalId = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [refresh])

  return { snap, loading, refresh, resourcesReady }
}

export function ResourcesPopover() {
  const { snap, loading, refresh, resourcesReady } = useResourceSnapshot()
  const [open, setOpen] = useState(false)

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
  }, [])

  useEffect(() => {
    if (open) {
      void refresh()
    }
  }, [open, refresh])

  const totalRendererMB = snap ? bytesToMegabytes(snap.rendererHeapUsed) : 0
  const totalServerMB = snap ? bytesToMegabytes(snap.serverRss) : 0
  const totalCliTuiMB = snap ? bytesToMegabytes(snap.cliTuiRss) : 0
  const totalBottomPanelMB = snap ? bytesToMegabytes(snap.bottomPanelRss) : 0
  const totalChronicleMB = snap ? bytesToMegabytes(snap.chronicleRss) : 0
  const totalMB = totalRendererMB + totalServerMB + totalCliTuiMB + totalBottomPanelMB + totalChronicleMB
  const totalCpuPercent = snap
    ? Math.round((
      (snap.serverCpuPercent ?? 0)
      + snap.cliTuiCpuPercent
      + snap.bottomPanelCpuPercent
      + (snap.chronicleCpuPercent ?? 0)
    ) * 100) / 100
    : null
  const cliTuiTerminals = snap?.terminals.filter(item => item.role === 'cli-tui') ?? []
  const bottomPanelTerminals = snap?.terminals.filter(item => item.role === 'bottom-panel') ?? []

  const triggerLabel = snap ? formatResourceUsage(totalMB, totalCpuPercent) : '— MB / —'
  const footerStatusLabel = snap
    ? `Uptime ${formatUptimeSeconds(snap.serverUptime)} · Updated ${snap.updatedAtLabel}`
    : ''

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 gap-1 px-1.5 text-[11px] text-muted-foreground font-normal tabular-nums hover:text-foreground active:scale-[0.96] transition-transform"
          aria-label={`Resources: ${triggerLabel}`}
          title="Resources"
        >
          <CpuIcon aria-hidden="true" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-xl p-0 gap-0"
        data-testid="resources-popover"
        data-resources-ready={resourcesReady ? 'true' : 'false'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-sm font-medium">Resources</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh resources"
            title="Refresh"
          >
            <RefreshCwIcon className={cn(loading && 'animate-spin')} aria-hidden="true" />
          </Button>
        </div>

        {/* Summary stat row */}
        <div className="grid grid-cols-2 gap-px mx-1 bg-border">
          <div className="bg-popover px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Memory
            </div>
            <div className="flex items-center gap-1.5 text-base font-semibold tabular-nums leading-none">
              <MemoryStickIcon className="size-4 text-muted-foreground" />
              {formatMegabytes(totalMB)}
            </div>
          </div>
          <div className="bg-popover px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              CPU
            </div>
            <div className="flex items-center gap-1.5 text-base font-semibold tabular-nums leading-none">
              <CpuIcon className="size-4 text-muted-foreground" />
              {formatCpuPercent(totalCpuPercent)}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {snap && (
          <div className="px-3 pt-2 pb-1">
            <MemoryBar
              used={snap.rendererHeapUsed + snap.serverRss + snap.cliTuiRss + snap.bottomPanelRss + snap.chronicleRss}
              total={Math.max(
                snap.rendererHeapLimit,
                (snap.rendererHeapUsed + snap.serverRss + snap.cliTuiRss + snap.bottomPanelRss + snap.chronicleRss) * 2,
              )}
            />
          </div>
        )}

        {/* Process breakdown */}
        <div className="px-3 py-2 flex flex-row gap-2 w-full">
          {snap && snap.warnings.length > 0 && (
            <div
              role="status"
              data-testid="resources-warning"
              className="mb-2 flex items-start gap-2 rounded-md bg-warning/8 px-2 py-1.5 text-[11px] leading-snug text-warning"
            >
              <CircleAlertIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span>{snap.warnings.join('. ')}</span>
            </div>
          )}

          <div className="flex-1">
            <ResourceGroup
              icon={<MonitorIcon className="size-3.5" />}
              label="Renderer"
              value={snap ? formatResourceUsage(bytesToMegabytes(snap.rendererHeapUsed), null) : '—'}
            >
              {snap && snap.rendererHeapUsed > 0 && (
                <>
                  <SectionRow
                    label="Heap Used"
                    value={formatMegabytes(bytesToMegabytes(snap.rendererHeapUsed), 1)}
                    dimLabel
                    branch="middle"
                  />
                  <SectionRow
                    label="Heap Total"
                    value={formatMegabytes(bytesToMegabytes(snap.rendererHeapTotal), 1)}
                    dimLabel
                    branch="middle"
                  />
                  <SectionRow
                    label="CPU"
                    value={formatCpuPercent(null)}
                    dimLabel
                    branch="last"
                  />
                </>
              )}
            </ResourceGroup>

            <div className="border-t border-border my-1.5" />

            <ResourceGroup
              icon={<ServerIcon className="size-3.5" />}
              label="Server"
              value={snap ? formatResourceUsage(bytesToMegabytes(snap.serverRss), snap.serverCpuPercent) : '—'}
            >
              {snap && snap.serverRss > 0 && (
                <>
                  <SectionRow
                    label="Heap Used"
                    value={formatMegabytes(bytesToMegabytes(snap.serverHeapUsed), 1)}
                    dimLabel
                    branch="middle"
                  />
                  <SectionRow
                    label="Heap Total"
                    value={formatMegabytes(bytesToMegabytes(snap.serverHeapTotal), 1)}
                    dimLabel
                    branch="middle"
                  />
                  <SectionRow
                    label="External"
                    value={formatMegabytes(bytesToMegabytes(snap.serverExternal), 1)}
                    dimLabel
                    branch="middle"
                  />
                  <SectionRow
                    label="CPU"
                    value={formatCpuPercent(snap.serverCpuPercent)}
                    dimLabel
                    branch="last"
                  />
                </>
              )}
            </ResourceGroup>
          </div>

          <div className="border-l border-border my-1.5" />

          <div className="flex-1">
            <ResourceGroup
              icon={<ActivityIcon className="size-3.5" />}
              label="Chronicle"
              value={snap?.chronicleRunning
                ? formatResourceUsage(bytesToMegabytes(snap.chronicleRss), snap.chronicleCpuPercent)
                : 'Off'}
            >
              {snap?.chronicleRunning
? (
                <SectionRow
                  label="cradle-chronicle"
                  detail={snap.chroniclePid ? `pid ${snap.chroniclePid}` : undefined}
                  value={`${snap.chronicleRss > 0 ? formatMegabytes(bytesToMegabytes(snap.chronicleRss), 1) : '—'} / ${formatCpuPercent(snap.chronicleCpuPercent)}`}
                  dimLabel
                  branch="last"
                />
              )
: (
                <SectionRow label="Not running" value="0 MB / 0%" dimLabel branch="last" />
              )}
            </ResourceGroup>

            <div className="border-t border-border my-1.5" />

            <ResourceGroup
              icon={<SquareTerminalIcon className="size-3.5" />}
              label="CLI TUI"
              value={snap ? formatResourceUsage(bytesToMegabytes(snap.cliTuiRss), snap.cliTuiCpuPercent) : '—'}
            >
              {cliTuiTerminals.length > 0
? (
                cliTuiTerminals.map((item, index) => (
                  <SectionRow
                    key={item.id}
                    label={basename(item.executable)}
                    detail={`pid ${item.pid}`}
                    value={`${item.rssMB === null ? '—' : formatMegabytes(item.rssMB)} / ${formatCpuPercent(item.cpuPercent)}`}
                    dimLabel
                    branch={index === cliTuiTerminals.length - 1 ? 'last' : 'middle'}
                  />
                ))
              )
: (
                <SectionRow label="No running TUI sessions" value="0 MB / 0%" dimLabel branch="last" />
              )}
            </ResourceGroup>

            <div className="border-t border-border my-1.5" />

            <ResourceGroup
              icon={<PanelBottomIcon className="size-3.5" />}
              label="Bottom Panel"
              value={snap ? formatResourceUsage(bytesToMegabytes(snap.bottomPanelRss), snap.bottomPanelCpuPercent) : '—'}
            >
              {bottomPanelTerminals.length > 0
? (
                bottomPanelTerminals.map((item, index) => (
                  <SectionRow
                    key={item.id}
                    label={basename(item.executable)}
                    detail={`pid ${item.pid}`}
                    value={`${item.rssMB === null ? '—' : formatMegabytes(item.rssMB)} / ${formatCpuPercent(item.cpuPercent)}`}
                    dimLabel
                    branch={index === bottomPanelTerminals.length - 1 ? 'last' : 'middle'}
                  />
                ))
              )
: (
                <SectionRow label="No running panel terminals" value="0 MB / 0%" dimLabel branch="last" />
              )}
            </ResourceGroup>
          </div>
        </div>

        {snap && (
          <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground/60 tabular-nums">
            <span
              className={cn('inline-flex items-center gap-1', loading && 'text-muted-foreground')}
            >
              <RefreshCwIcon className={cn('size-3', loading && 'animate-spin')} aria-hidden="true" />
              Live
            </span>
            <span>{footerStatusLabel}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function basename(path: string): string {
  return path.split(PATH_SEGMENT_SEPARATOR_PATTERN).pop() || path
}
