// Input: performance.memory (renderer), /health endpoint (server), getPerfSnapshots
// Output: Resources popover — CPU/memory overview in macOS Activity Monitor style
// Position: AppHeader right side trigger

import { CpuIcon, RefreshCwIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Progress } from '~/components/ui/progress'
import { getServerUrl } from '~/lib/electron'
import { getPerfSnapshots } from '~/lib/perf-monitor'

const SERVER_BASE = getServerUrl()

interface ServerHealth {
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
    external: number
  }
  uptime: number
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
  timestamp: number
}

function toMB(bytes: number, decimals = 0): string {
  const mb = bytes / 1024 / 1024
  return decimals > 0 ? mb.toFixed(decimals) : Math.round(mb).toString()
}

function formatMemoryLabel(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${Math.round(mb)} MB`
}

function MemoryBar({ used, total, className }: { used: number; total: number; className?: string }) {
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
  indent = 0,
  dimLabel = false,
}: {
  label: string
  memory: string
  indent?: number
  dimLabel?: boolean
}) {
  return (
    <div
      className="flex items-center gap-2 py-[3px]"
      style={{ paddingLeft: indent * 12 }}
    >
      {indent > 0 && (
        <span className="text-muted-foreground/40 shrink-0 select-none">•</span>
      )}
      <span className={dimLabel ? 'text-muted-foreground flex-1 truncate text-[11px]' : 'flex-1 truncate text-[11px]'}>
        {label}
      </span>
      <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
        {memory}
      </span>
    </div>
  )
}

function useResourceSnapshot() {
  const [snap, setSnap] = useState<ResourceSnapshot | null>(null)
  const [loading, setLoading] = useState(false)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    try {
      const [healthRes] = await Promise.allSettled([
        fetch(`${SERVER_BASE}/health`).then(r => r.json() as Promise<ServerHealth>),
      ])

      const perfSnaps = getPerfSnapshots()
      const latest = perfSnaps[perfSnaps.length - 1]

      // /health returns memory already in MB
      const server = healthRes.status === 'fulfilled' ? healthRes.value : null
      const mbToBytes = (mb: number) => mb * 1024 * 1024

      setSnap({
        rendererHeapUsed: latest?.heapUsed ?? 0,
        rendererHeapTotal: latest?.heapTotal ?? 0,
        rendererHeapLimit: latest?.heapLimit ?? 0,
        serverRss: server ? mbToBytes(server.memory.rss) : 0,
        serverHeapUsed: server ? mbToBytes(server.memory.heapUsed) : 0,
        serverHeapTotal: server ? mbToBytes(server.memory.heapTotal) : 0,
        serverExternal: server ? mbToBytes(server.memory.external) : 0,
        serverUptime: server?.uptime ?? 0,
        timestamp: Date.now(),
      })
    }
    finally {
      setLoading(false)
    }
  }, [])

  return { snap, loading, refresh: fetch_ }
}

export function ResourcesPopover() {
  const { snap, loading, refresh } = useResourceSnapshot()
  const [open, setOpen] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (open) {
      void refresh()
      intervalRef.current = setInterval(() => void refresh(), 3000)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [open, refresh])

  const totalRendererMB = snap ? Number(toMB(snap.rendererHeapUsed)) : 0
  const totalServerMB = snap ? Number(toMB(snap.serverRss)) : 0
  const totalMB = totalRendererMB + totalServerMB

  const triggerLabel = snap
    ? formatMemoryLabel(totalMB)
    : '— MB'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 gap-1 px-1.5 text-[11px] text-muted-foreground font-normal tabular-nums hover:text-foreground"
          title="Resources"
        >
          <CpuIcon />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-80 p-0 gap-0"
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
            title="Refresh"
          >
            <RefreshCwIcon className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>

        {/* Summary stat row */}
        <div className="grid grid-cols-2 gap-px border-y border-border bg-border mx-0">
          <div className="bg-popover px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Memory</div>
            <div className="text-base font-semibold tabular-nums leading-none">
              {formatMemoryLabel(totalMB)}
            </div>
          </div>
          <div className="bg-popover px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Uptime</div>
            <div className="text-base font-semibold tabular-nums leading-none">
              {snap ? formatUptime(snap.serverUptime) : '—'}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {snap && (
          <div className="px-3 pt-2 pb-1">
            <MemoryBar
              used={snap.rendererHeapUsed + snap.serverRss}
              total={snap.rendererHeapLimit || (snap.rendererHeapUsed + snap.serverRss) * 4}
            />
          </div>
        )}

        {/* Process breakdown */}
        <div className="px-3 py-2 space-y-0.5">
          {/* Renderer */}
          <div className="flex items-center gap-2 py-[3px]">
            <span className="flex-1 text-[11px] font-medium">Renderer</span>
            <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
              {snap ? formatMemoryLabel(Number(toMB(snap.rendererHeapUsed))) : '—'}
            </span>
          </div>
          {snap && snap.rendererHeapUsed > 0 && (
            <>
              <SectionRow
                label="Heap Used"
                memory={`${toMB(snap.rendererHeapUsed, 1)} MB`}
                indent={1}
                dimLabel
              />
              <SectionRow
                label="Heap Total"
                memory={`${toMB(snap.rendererHeapTotal, 1)} MB`}
                indent={1}
                dimLabel
              />
            </>
          )}

          {/* Divider */}
          <div className="border-t border-border my-1.5" />

          {/* Server */}
          <div className="flex items-center gap-2 py-[3px]">
            <span className="flex-1 text-[11px] font-medium">Server</span>
            <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
              {snap ? formatMemoryLabel(Number(toMB(snap.serverRss))) : '—'}
            </span>
          </div>
          {snap && snap.serverRss > 0 && (
            <>
              <SectionRow
                label="Heap Used"
                memory={`${toMB(snap.serverHeapUsed, 1)} MB`}
                indent={1}
                dimLabel
              />
              <SectionRow
                label="Heap Total"
                memory={`${toMB(snap.serverHeapTotal, 1)} MB`}
                indent={1}
                dimLabel
              />
              <SectionRow
                label="External"
                memory={`${toMB(snap.serverExternal, 1)} MB`}
                indent={1}
                dimLabel
              />
            </>
          )}
        </div>

        {snap && (
          <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground/60 tabular-nums">
            Updated {new Date(snap.timestamp).toLocaleTimeString('en-US', { hour12: false })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
