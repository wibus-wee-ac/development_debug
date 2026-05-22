import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { z } from 'zod'

import {
  getUsageCostDailyOptions,
  getUsageCostSummaryOptions,
  getUsageDailyOptions,
  getUsageStatsOptions,
  getUsageSummaryOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { cn } from '~/lib/cn'

import { formatTokens, formatUsd } from './usage-format'
import { UsageHeatmap } from './usage-heatmap'

const DailyUsageSchema = z.object({
  date: z.string(),
  totalTokens: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  count: z.number(),
})

const UsageSummarySchema = z.object({
  totalPromptTokens: z.number(),
  totalCompletionTokens: z.number(),
  totalTokens: z.number(),
  totalTurns: z.number(),
  byAgent: z.array(z.object({
    agentProfileId: z.string(),
    totalTokens: z.number(),
    count: z.number(),
  })),
  byModel: z.array(z.object({
    modelId: z.string(),
    totalTokens: z.number(),
    count: z.number(),
  })),
})

const UsageStatsSchema = z.object({
  currentStreak: z.number(),
  longestStreak: z.number(),
  activeDays: z.number(),
  avgDailyTokens: z.number(),
  peakDay: z.object({
    date: z.string(),
    totalTokens: z.number(),
  }).nullable(),
  todayTokens: z.number(),
})

const CostSummarySchema = z.object({
  totalCostUsd: z.number(),
  totalPromptTokens: z.number(),
  totalCompletionTokens: z.number(),
  totalTokens: z.number(),
  byModel: z.array(z.object({
    modelId: z.string(),
    costUsd: z.number(),
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number(),
    count: z.number(),
  })),
})

const DailyCostSchema = z.object({
  date: z.string(),
  costUsd: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
  stepCount: z.number(),
})

const DailyUsageListSchema = z.array(DailyUsageSchema)
const DailyCostListSchema = z.array(DailyCostSchema)

type DailyUsage = z.infer<typeof DailyUsageSchema>
type UsageSummary = z.infer<typeof UsageSummarySchema>
type UsageStats = z.infer<typeof UsageStatsSchema>
type CostSummary = z.infer<typeof CostSummarySchema>
type DailyCost = z.infer<typeof DailyCostSchema>

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
  const dailyQuery = useQuery({
    ...getUsageDailyOptions({ query: { days: '365' } }),
    select: DailyUsageListSchema.parse,
  })
  const summaryQuery = useQuery({
    ...getUsageSummaryOptions(),
    select: UsageSummarySchema.parse,
  })
  const statsQuery = useQuery({
    ...getUsageStatsOptions(),
    select: UsageStatsSchema.parse,
  })
  const costSummaryQuery = useQuery({
    ...getUsageCostSummaryOptions(),
    select: CostSummarySchema.parse,
  })
  const dailyCostQuery = useQuery({
    ...getUsageCostDailyOptions(),
    select: DailyCostListSchema.parse,
  })

  const usageReady =
    dailyQuery.isSuccess &&
    summaryQuery.isSuccess &&
    statsQuery.isSuccess &&
    costSummaryQuery.isSuccess &&
    dailyCostQuery.isSuccess

  const daily = dailyQuery.data ?? []
  const summary = summaryQuery.data ?? null
  const stats = statsQuery.data ?? null
  const costSummary = costSummaryQuery.data ?? null
  const dailyCost = dailyCostQuery.data ?? []

  const hasData = summary && summary.totalTokens > 0

  return (
    <div
      className="h-full overflow-y-auto"
      data-testid="usage-dashboard"
      data-usage-ready={usageReady ? 'true' : 'false'}
    >
      <div className="mx-auto max-w-4xl px-8 py-10">
        {/* Header row with streak */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground text-balance" data-testid="usage-dashboard-title">Usage</h1>
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
            {costSummary && costSummary.totalCostUsd > 0 && (
              <Pill label="Total Cost" value={formatUsd(costSummary.totalCostUsd)} dataTestId="usage-pill-total-cost" accent />
            )}
            <Pill label="Today" value={formatTokens(stats.todayTokens)} dataTestId="usage-pill-today-tokens" />
            <Pill label="Prompt" value={formatTokens(summary!.totalPromptTokens)} dataTestId="usage-pill-prompt-tokens" />
            <Pill label="Completion" value={formatTokens(summary!.totalCompletionTokens)} dataTestId="usage-pill-completion-tokens" />
            <Pill label="Turns" value={String(summary!.totalTurns)} dataTestId="usage-pill-total-turns" />
            <Pill label="Avg / day" value={formatTokens(stats.avgDailyTokens)} dataTestId="usage-pill-avg-daily-tokens" />
            <Pill label="Active days" value={String(stats.activeDays)} dataTestId="usage-pill-active-days" />
            <Pill label="Best streak" value={`${stats.longestStreak}d`} dataTestId="usage-pill-best-streak" />
            {stats.peakDay && (
              <Pill label="Peak" value={`${formatTokens(stats.peakDay.totalTokens)} on ${stats.peakDay.date.slice(5)}`} dataTestId="usage-pill-peak-day" />
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
              {costSummary && costSummary.totalCostUsd > 0 && (
                <>
                  <p className="text-3xl font-semibold tabular-nums text-foreground" data-testid="usage-total-cost">{formatUsd(costSummary.totalCostUsd)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">estimated cost</p>
                </>
              )}
              <p
                className={cn(
                  'font-semibold tabular-nums text-foreground',
                  costSummary && costSummary.totalCostUsd > 0 ? 'mt-2 text-lg' : 'text-3xl',
                )}
                data-testid="usage-total-tokens"
              >
                {formatTokens(summary!.totalTokens)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">total tokens</p>
            </div>
          </div>
        )}

        {/* Cost sparkline */}
        {dailyCost.length > 1 && (
          <div className="mt-6">
            <p className="text-[11px] text-muted-foreground mb-1.5">Daily cost (last 30 days)</p>
            <CostSparkline data={dailyCost} />
          </div>
        )}

        {/* Heatmap */}
        <div className="mt-8">
          <UsageHeatmap data={daily} />
        </div>

        {/* Breakdown */}
        {hasData && (
          <div className="mt-10 grid grid-cols-2 gap-8">
            {/* By Model — cost */}
            {costSummary && costSummary.byModel.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-3">Cost by Model</p>
                <div className="space-y-2.5">
                  {costSummary.byModel.map(m => (
                    <CostBarRow key={m.modelId} label={m.modelId} costUsd={m.costUsd} tokens={m.totalTokens} max={costSummary.byModel[0].costUsd} />
                  ))}
                </div>
              </div>
            )}
            {/* By Model — tokens (fallback if no cost data) */}
            {(!costSummary || costSummary.byModel.length === 0) && summary!.byModel.length > 0 && (
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
          <div className="mt-20 text-center" data-testid="usage-empty-state">
            <p className="text-sm text-muted-foreground">
              No usage data yet: send a message to start tracking
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Pill({ label, value, dataTestId, accent }: { label: string, value: string, dataTestId?: string, accent?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1',
        accent ? 'border-accent/40 bg-accent/5' : 'border-border/40',
      )}
      data-testid={dataTestId}
    >
      <span className="text-[10px] text-muted-foreground" data-testid={dataTestId ? `${dataTestId}-label` : undefined}>{label}</span>
      <span
        className={cn(
          'text-xs font-medium tabular-nums',
          accent ? 'text-accent-foreground' : 'text-foreground',
        )}
        data-testid={dataTestId ? `${dataTestId}-value` : undefined}
      >
        {value}
      </span>
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

function CostBarRow({ label, costUsd, tokens, max }: { label: string, costUsd: number, tokens: number, max: number }) {
  const pct = max > 0 ? (costUsd / max) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground font-mono truncate max-w-[55%]">{label}</span>
        <span className="text-xs tabular-nums text-foreground">
          {formatUsd(costUsd)}
          <span className="text-muted-foreground ml-1.5">{formatTokens(tokens)}</span>
        </span>
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

/** Tiny SVG sparkline for daily cost */
function CostSparkline({ data }: { data: DailyCost[] }) {
  const last30 = data.slice(-30)
  if (last30.length < 2) {
    return null
  }
  const max = Math.max(...last30.map(d => d.costUsd), 0.001)
  const w = 400
  const h = 40
  const points = last30.map((d, i) => {
    const x = (i / (last30.length - 1)) * w
    const y = h - (d.costUsd / max) * (h - 4) - 2
    return `${x},${y}`
  })
  const pathD = `M${points.join(' L')}`
  const areaD = `${pathD} L${w},${h} L0,${h} Z`

  return (
    <svg width={w} height={h} className="overflow-visible" data-testid="cost-sparkline">
      <defs>
        <linearGradient id="costSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#costSparkFill)" />
      <path d={pathD} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
