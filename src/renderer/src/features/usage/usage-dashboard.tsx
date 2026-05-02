// Input: ipc.usage.getDailyUsage, ipc.usage.getUsageSummary, ipc.usage.getUsageStats
// Output: UsageDashboard — token usage overview with heatmap, sparkline, streaks
// Position: Feature page component for /usage route

import { ipc } from '@renderer/lib/ipc'
import { useEffect, useState } from 'react'

import { UsageHeatmap } from './usage-heatmap'

interface DailyUsage {
  date: string
  totalTokens: number
  promptTokens: number
  completionTokens: number
  count: number
}

interface UsageSummary {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalTurns: number
  byAgent: Array<{ agentProfileId: string, totalTokens: number, count: number }>
  byModel: Array<{ modelId: string, totalTokens: number, count: number }>
}

interface UsageStats {
  currentStreak: number
  longestStreak: number
  activeDays: number
  avgDailyTokens: number
  peakDay: { date: string, totalTokens: number } | null
  todayTokens: number
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`
  }
  return n.toString()
}

/** Tiny SVG sparkline for the last 30 days */
function Sparkline({ data }: { data: DailyUsage[] }) {
  const last30 = data.slice(-30)
  if (last30.length < 2) {
    return null
  }
  const max = Math.max(...last30.map(d => d.totalTokens), 1)
  const w = 180
  const h = 40
  const points = last30.map((d, i) => {
    const x = (i / (last30.length - 1)) * w
    const y = h - (d.totalTokens / max) * (h - 4) - 2
    return `${x},${y}`
  })
  const pathD = `M${points.join(' L')}`
  // Area fill
  const areaD = `${pathD} L${w},${h} L0,${h} Z`

  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#sparkFill)" />
      <path d={pathD} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function UsageDashboard() {
  const [daily, setDaily] = useState<DailyUsage[]>([])
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [stats, setStats] = useState<UsageStats | null>(null)

  useEffect(() => {
    Promise.all([
      ipc?.usage.getDailyUsage({ days: 365 }),
      ipc?.usage.getUsageSummary(),
      ipc?.usage.getUsageStats(),
    ]).then(([d, s, st]) => {
      if (d) {
        setDaily(d as DailyUsage[])
      }
      if (s) {
        setSummary(s as UsageSummary)
      }
      if (st) {
        setStats(st as UsageStats)
      }
    }).catch((err) => {
      console.error('[UsageDashboard] fetch failed:', err)
    })
  }, [])

  const hasData = summary && summary.totalTokens > 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-10">
        {/* Header row with streak */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Usage</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Token consumption over the past year</p>
          </div>
          {stats && stats.currentStreak > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-foreground">
              <span className="font-semibold tabular-nums">{stats.currentStreak}</span>
              <span className="text-muted-foreground text-xs">day streak</span>
            </div>
          )}
        </div>

        {/* Stat pills row */}
        {stats && hasData && (
          <div className="mt-6 flex flex-wrap gap-3">
            <Pill label="Today" value={formatTokens(stats.todayTokens)} />
            <Pill label="Avg / day" value={formatTokens(stats.avgDailyTokens)} />
            <Pill label="Active days" value={String(stats.activeDays)} />
            <Pill label="Best streak" value={`${stats.longestStreak}d`} />
            {stats.peakDay && (
              <Pill label="Peak" value={`${formatTokens(stats.peakDay.totalTokens)} on ${stats.peakDay.date.slice(5)}`} />
            )}
          </div>
        )}

        {/* Sparkline + Totals row */}
        {hasData && (
          <div className="mt-8 flex items-end gap-8">
            <div className="flex-1">
              <p className="text-[11px] text-muted-foreground mb-1.5">Last 30 days</p>
              <Sparkline data={daily} />
            </div>
            <div className="text-right">
              <p className="text-3xl font-semibold tabular-nums text-foreground">{formatTokens(summary!.totalTokens)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">total tokens</p>
            </div>
          </div>
        )}

        {/* Heatmap */}
        <div className="mt-8">
          <UsageHeatmap data={daily} />
        </div>

        {/* Breakdown */}
        {hasData && (
          <div className="mt-10 grid grid-cols-2 gap-8">
            {/* By Model */}
            {summary!.byModel.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-3">By Model</p>
                <div className="space-y-2.5">
                  {summary!.byModel.map(m => (
                    <BarRow key={m.modelId} label={m.modelId} value={m.totalTokens} max={summary!.byModel[0].totalTokens} />
                  ))}
                </div>
              </div>
            )}
            {/* By Agent */}
            {summary!.byAgent.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-3">By Agent</p>
                <div className="space-y-2.5">
                  {summary!.byAgent.map(a => (
                    <BarRow key={a.agentProfileId} label={a.agentProfileId} value={a.totalTokens} max={summary!.byAgent[0].totalTokens} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {summary && summary.totalTokens === 0 && (
          <div className="mt-20 text-center">
            <p className="text-sm text-muted-foreground">
              No usage data yet — send a message to start tracking
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Pill({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border/40 px-3 py-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-xs font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function BarRow({ label, value, max }: { label: string, value: number, max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground font-mono truncate max-w-[70%]">{label}</span>
        <span className="text-xs tabular-nums text-foreground">{formatTokens(value)}</span>
      </div>
      <div className="h-1 w-full rounded-full bg-foreground/5">
        <div
          className="h-full rounded-full bg-accent/60"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
