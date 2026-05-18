// Input: performance.memory (renderer), /health endpoint, PTY resource endpoint
// Output: Resources popover — live memory overview with renderer/server/TUI/panel breakdown
// Position: AppHeader right side trigger

import type { ReactNode } from 'react'
import {
  CpuIcon,
  MemoryStickIcon,
  MonitorIcon,
  PanelBottomIcon,
  RefreshCwIcon,
  ServerIcon,
  SquareTerminalIcon
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'

const SERVER_BASE = getServerUrl()
const REFRESH_INTERVAL_MS = 3000

interface ServerHealth {
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
    external: number
  }
  uptime: number
}

interface PtyResourceItem {
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
  descendantCount: number | null
}

interface PtyResources {
  terminals: PtyResourceItem[]
  totals: {
    cliTuiRssMB: number
    bottomPanelRssMB: number
  }
  timestamp: number
}

interface ResourceSnapshot {
  rendererHeapUsed: number
  rendererHeapTotal: number
  rendererHeapLimit: number
  serverRss: number
  serverHeapUsed: number
  serverHeapTotal: number
  serverExternal: number
  serverUptime: number
  cliTuiRss: number
  bottomPanelRss: number
  terminals: PtyResourceItem[]
  timestamp: number
}

function toMB(bytes: number, decimals = 0): string {
  const mb = bytes / 1024 / 1024
  return decimals > 0 ? mb.toFixed(decimals) : Math.round(mb).toString()
}

function formatMemoryLabel(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`
  }
  return `${Math.round(mb)} MB`
}

function readRendererMemory() {
  if (typeof performance === 'undefined' || !('memory' in performance)) {
    return {
      heapUsed: 0,
      heapTotal: 0,
      heapLimit: 0
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
    heapLimit: memory.jsHeapSizeLimit ?? 0
  }
}

function MemoryBar({
  used,
  total,
  className
}: {
  used: number
  total: number
  className?: string
}) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  return (
    <div className={className}>
      <Progress value={pct} className="h-0.5" />
    </div>
  )
}

function SectionRow({
  label,
  memory,
  dimLabel = false,
  detail,
  branch
}: {
  label: string
  memory: string
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
      <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{memory}</span>
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
  children
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

function useResourceSnapshot() {
  const [snap, setSnap] = useState<ResourceSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoading(true)
    try {
      const [healthRes, ptyRes] = await Promise.allSettled([
        fetch(`${SERVER_BASE}/health`).then((r) => r.json() as Promise<ServerHealth>),
        fetch(`${SERVER_BASE}/terminal-sessions/resources`).then(
          (r) => r.json() as Promise<PtyResources>
        )
      ])

      if (requestId !== requestRef.current) {
        return
      }

      // /health returns memory already in MB
      const server = healthRes.status === 'fulfilled' ? healthRes.value : null
      const pty = ptyRes.status === 'fulfilled' ? ptyRes.value : null
      const renderer = readRendererMemory()
      const mbToBytes = (mb: number) => mb * 1024 * 1024

      setSnap({
        rendererHeapUsed: renderer.heapUsed,
        rendererHeapTotal: renderer.heapTotal,
        rendererHeapLimit: renderer.heapLimit,
        serverRss: server ? mbToBytes(server.memory.rss) : 0,
        serverHeapUsed: server ? mbToBytes(server.memory.heapUsed) : 0,
        serverHeapTotal: server ? mbToBytes(server.memory.heapTotal) : 0,
        serverExternal: server ? mbToBytes(server.memory.external) : 0,
        serverUptime: server?.uptime ?? 0,
        cliTuiRss: pty ? mbToBytes(pty.totals.cliTuiRssMB) : 0,
        bottomPanelRss: pty ? mbToBytes(pty.totals.bottomPanelRssMB) : 0,
        terminals: pty?.terminals ?? [],
        timestamp: Date.now()
      })
    } finally {
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

  return { snap, loading, refresh }
}

export function ResourcesPopover() {
  const { snap, loading, refresh } = useResourceSnapshot()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) {
      void refresh()
    }
  }, [open, refresh])

  const totalRendererMB = snap ? Number(toMB(snap.rendererHeapUsed)) : 0
  const totalServerMB = snap ? Number(toMB(snap.serverRss)) : 0
  const totalCliTuiMB = snap ? Number(toMB(snap.cliTuiRss)) : 0
  const totalBottomPanelMB = snap ? Number(toMB(snap.bottomPanelRss)) : 0
  const totalMB = totalRendererMB + totalServerMB + totalCliTuiMB + totalBottomPanelMB
  const cliTuiTerminals = snap?.terminals.filter((item) => item.role === 'cli-tui') ?? []
  const bottomPanelTerminals = snap?.terminals.filter((item) => item.role === 'bottom-panel') ?? []

  const triggerLabel = snap ? formatMemoryLabel(totalMB) : '— MB'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 gap-1 px-1.5 text-[11px] text-muted-foreground font-normal tabular-nums hover:text-foreground active:scale-[0.96] transition-transform"
          title="Resources"
        >
          <CpuIcon />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-0 gap-0">
        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-sm font-medium">Resources</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => void refresh()}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCwIcon className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>

        {/* Summary stat row */}
        <div className="grid grid-cols-2 gap-px border-y border-border bg-border mx-0">
          <div className="bg-popover px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Memory
            </div>
            <div className="flex items-center gap-1.5 text-base font-semibold tabular-nums leading-none">
              <MemoryStickIcon className="size-4 text-muted-foreground" />
              {formatMemoryLabel(totalMB)}
            </div>
          </div>
          <div className="bg-popover px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Uptime
            </div>
            <div className="text-base font-semibold tabular-nums leading-none">
              {snap ? formatUptime(snap.serverUptime) : '—'}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {snap && (
          <div className="px-3 pt-2 pb-1">
            <MemoryBar
              used={snap.rendererHeapUsed + snap.serverRss + snap.cliTuiRss + snap.bottomPanelRss}
              total={Math.max(
                snap.rendererHeapLimit,
                (snap.rendererHeapUsed + snap.serverRss + snap.cliTuiRss + snap.bottomPanelRss) * 2
              )}
            />
          </div>
        )}

        {/* Process breakdown */}
        <div className="px-3 py-2">
          <ResourceGroup
            icon={<MonitorIcon className="size-3.5" />}
            label="Renderer"
            value={snap ? formatMemoryLabel(Number(toMB(snap.rendererHeapUsed))) : '—'}
          >
            {snap && snap.rendererHeapUsed > 0 && (
              <>
                <SectionRow
                  label="Heap Used"
                  memory={`${toMB(snap.rendererHeapUsed, 1)} MB`}
                  dimLabel
                  branch="middle"
                />
                <SectionRow
                  label="Heap Total"
                  memory={`${toMB(snap.rendererHeapTotal, 1)} MB`}
                  dimLabel
                  branch="last"
                />
              </>
            )}
          </ResourceGroup>

          {/* Divider */}
          <div className="border-t border-border my-1.5" />

          <ResourceGroup
            icon={<ServerIcon className="size-3.5" />}
            label="Server"
            value={snap ? formatMemoryLabel(Number(toMB(snap.serverRss))) : '—'}
          >
            {snap && snap.serverRss > 0 && (
              <>
                <SectionRow
                  label="Heap Used"
                  memory={`${toMB(snap.serverHeapUsed, 1)} MB`}
                  dimLabel
                  branch="middle"
                />
                <SectionRow
                  label="Heap Total"
                  memory={`${toMB(snap.serverHeapTotal, 1)} MB`}
                  dimLabel
                  branch="middle"
                />
                <SectionRow
                  label="External"
                  memory={`${toMB(snap.serverExternal, 1)} MB`}
                  dimLabel
                  branch="last"
                />
              </>
            )}
          </ResourceGroup>

          <div className="border-t border-border my-1.5" />

          <ResourceGroup
            icon={<SquareTerminalIcon className="size-3.5" />}
            label="CLI TUI"
            value={snap ? formatMemoryLabel(Number(toMB(snap.cliTuiRss))) : '—'}
          >
            {cliTuiTerminals.length > 0 ? (
              cliTuiTerminals.map((item, index) => (
                <SectionRow
                  key={item.id}
                  label={basename(item.executable)}
                  detail={`pid ${item.pid}`}
                  memory={item.rssMB === null ? '—' : formatMemoryLabel(item.rssMB)}
                  dimLabel
                  branch={index === cliTuiTerminals.length - 1 ? 'last' : 'middle'}
                />
              ))
            ) : (
              <SectionRow label="No running TUI sessions" memory="0 MB" dimLabel branch="last" />
            )}
          </ResourceGroup>

          <div className="border-t border-border my-1.5" />

          <ResourceGroup
            icon={<PanelBottomIcon className="size-3.5" />}
            label="Bottom Panel"
            value={snap ? formatMemoryLabel(Number(toMB(snap.bottomPanelRss))) : '—'}
          >
            {bottomPanelTerminals.length > 0 ? (
              bottomPanelTerminals.map((item, index) => (
                <SectionRow
                  key={item.id}
                  label={basename(item.executable)}
                  detail={`pid ${item.pid}`}
                  memory={item.rssMB === null ? '—' : formatMemoryLabel(item.rssMB)}
                  dimLabel
                  branch={index === bottomPanelTerminals.length - 1 ? 'last' : 'middle'}
                />
              ))
            ) : (
              <SectionRow label="No running panel terminals" memory="0 MB" dimLabel branch="last" />
            )}
          </ResourceGroup>
        </div>

        {snap && (
          <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground/60 tabular-nums">
            <span
              className={cn('inline-flex items-center gap-1', loading && 'text-muted-foreground')}
            >
              <RefreshCwIcon className={cn('size-3', loading && 'animate-spin')} />
              Live
            </span>
            <span>
              Updated {new Date(snap.timestamp).toLocaleTimeString('en-US', { hour12: false })}
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) {
    return `${h}h ${m}m`
  }
  return `${m}m`
}

function basename(path: string): string {
  return path.split('/').pop() || path
}
