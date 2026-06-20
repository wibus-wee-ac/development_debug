import { useMutation, useQuery } from '@tanstack/react-query'
import {
  WarningLine as AlertTriangleIcon,
  CoinLine as CoinsIcon,
  Dashboard2Line as GaugeIcon,
  Refresh1Line as RefreshCwIcon,
  Stopwatch2Line as TimerResetIcon
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import {
  getProviderTargetsByProviderTargetIdCodexAccountDiagnosticsOptions,
  postProviderTargetsByProviderTargetIdCodexRateLimitResetCreditConsumeMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetProviderTargetsByProviderTargetIdCodexAccountDiagnosticsResponse } from '~/api-gen/types.gen'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'
import { clampPercent } from '~/lib/number-format'

type CodexAccountDiagnostics = GetProviderTargetsByProviderTargetIdCodexAccountDiagnosticsResponse
type RateLimitSnapshot = NonNullable<CodexAccountDiagnostics['rateLimits']>
type RateLimitWindow = NonNullable<RateLimitSnapshot['primary']>

export function CodexAccountDiagnosticsPanel({ providerTargetId }: { providerTargetId: string }) {
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetAttemptKey, setResetAttemptKey] = useState<string | null>(null)
  const diagnosticsQuery = useQuery({
    ...getProviderTargetsByProviderTargetIdCodexAccountDiagnosticsOptions({
      path: { providerTargetId },
    }),
    enabled: false,
  })
  const resetCredit = useMutation({
    ...postProviderTargetsByProviderTargetIdCodexRateLimitResetCreditConsumeMutation(),
    onSuccess: (result) => {
      setResetAttemptKey(null)
      toastManager.add({
        type: result.outcome === 'reset' ? 'success' : 'info',
        title: formatResetOutcome(result.outcome),
      })
      void diagnosticsQuery.refetch()
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: 'Reset failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    },
  })
  const diagnostics = diagnosticsQuery.data ?? null
  const canUseResetCredit = isResetCreditAvailable(diagnostics)

  const refresh = () => {
    void diagnosticsQuery.refetch()
  }

  const openResetDialog = () => {
    setResetAttemptKey(current => current ?? crypto.randomUUID())
    setResetDialogOpen(true)
  }

  const consumeResetCredit = () => {
    const idempotencyKey = resetAttemptKey ?? crypto.randomUUID()
    setResetAttemptKey(idempotencyKey)
    resetCredit.mutate({
      path: { providerTargetId },
      body: { idempotencyKey },
    })
    setResetDialogOpen(false)
  }

  return (
    <>
      <Separator className="bg-foreground/6" />
      <section className="mt-4 rounded-lg border border-foreground/8 bg-muted/20 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GaugeIcon className="size-3.5 !text-muted-foreground" />
              <h5 className="text-[13px] font-medium text-foreground">Account diagnostics</h5>
              {diagnostics?.account?.planType && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium">
                  {diagnostics.account.planType}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {formatRefreshState(diagnostics, diagnosticsQuery.isFetching)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {canUseResetCredit && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={openResetDialog}
                disabled={resetCredit.isPending}
              >
                {resetCredit.isPending ? <Spinner className="size-3" /> : <TimerResetIcon className="size-3" />}
                Use reset credit
              </Button>
            )}
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={refresh}
              disabled={diagnosticsQuery.isFetching}
            >
              {diagnosticsQuery.isFetching ? <Spinner className="size-3" /> : <RefreshCwIcon className="size-3" />}
              Refresh
            </Button>
          </div>
        </div>

        <DiagnosticsBody
          diagnostics={diagnostics}
          loading={diagnosticsQuery.isFetching}
          error={diagnosticsQuery.error}
        />
      </section>

      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TimerResetIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>Use reset credit?</AlertDialogTitle>
            <AlertDialogDescription>
              This action consumes one ChatGPT account reset credit for this Codex provider target.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm" onClick={() => setResetAttemptKey(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction size="sm" onClick={consumeResetCredit}>
              Use credit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function DiagnosticsBody({
  diagnostics,
  loading,
  error,
}: {
  diagnostics: CodexAccountDiagnostics | null
  loading: boolean
  error: Error | null
}) {
  if (error) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md bg-destructive/6 px-2.5 py-2 text-[12px] text-destructive">
        <AlertTriangleIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{error.message}</span>
      </div>
    )
  }

  if (!diagnostics) {
    return (
      <div className="mt-3 rounded-md bg-background/70 px-2.5 py-2 text-[12px] text-muted-foreground ring-1 ring-foreground/6">
        Not refreshed
      </div>
    )
  }

  if (!diagnostics.supported) {
    return (
      <div className="mt-3 rounded-md bg-background/70 px-2.5 py-2 text-[12px] text-muted-foreground ring-1 ring-foreground/6">
        {diagnostics.unavailableReason}
      </div>
    )
  }

  return (
    <div className={cn('mt-3 grid gap-3', loading ? 'opacity-70' : '')}>
      {diagnostics.rateLimits && <RateLimitPanel rateLimits={diagnostics.rateLimits} />}
      <div className="grid gap-2 md:grid-cols-2">
        <MetricGroup
          icon={<CoinsIcon className="size-3.5" />}
          title="Credits"
          metrics={[
            ['Balance', diagnostics.rateLimits?.credits?.balance ?? 'n/a'],
            ['Reset credits', formatCounter(diagnostics.rateLimitResetCredits?.availableCount ?? null)],
            ['Status', diagnostics.rateLimits?.rateLimitReachedType ?? 'available'],
          ]}
        />
        <MetricGroup
          icon={<GaugeIcon className="size-3.5" />}
          title="Token usage"
          metrics={[
            ['Lifetime', formatCounter(diagnostics.tokenUsage?.summary.lifetimeTokens ?? null)],
            ['Peak day', formatCounter(diagnostics.tokenUsage?.summary.peakDailyTokens ?? null)],
            ['Current streak', formatDays(diagnostics.tokenUsage?.summary.currentStreakDays ?? null)],
          ]}
        />
      </div>
      {diagnostics.tokenUsage && diagnostics.tokenUsage.dailyUsageBuckets.length > 0 && (
        <DailyUsageRows buckets={diagnostics.tokenUsage.dailyUsageBuckets.slice(-7)} />
      )}
    </div>
  )
}

function RateLimitPanel({ rateLimits }: { rateLimits: RateLimitSnapshot }) {
  const rows = [
    rateLimits.primary ? { label: 'Primary', window: rateLimits.primary } : null,
    rateLimits.secondary ? { label: 'Secondary', window: rateLimits.secondary } : null,
  ].filter((row): row is { label: string, window: RateLimitWindow } => row !== null)

  return (
    <div className="rounded-md bg-background/70 p-2.5 ring-1 ring-foreground/6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-foreground">
            {rateLimits.limitName ?? rateLimits.limitId ?? 'Rate limit'}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {rateLimits.planType ?? 'Account'}
          </div>
        </div>
        {rateLimits.rateLimitReachedType && (
          <Badge variant="destructive" className="h-5 px-1.5 text-[10px] font-medium">
            Limited
          </Badge>
        )}
      </div>
      <div className="mt-2.5 grid gap-2">
        {rows.map(({ label, window }) => (
          <RateLimitWindowRow key={label} label={label} window={window} />
        ))}
      </div>
    </div>
  )
}

function RateLimitWindowRow({ label, window }: { label: string, window: RateLimitWindow }) {
  const usedPercent = clampPercent(window.usedPercent)
  const remainingPercent = clampPercent(100 - usedPercent)

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums text-foreground">{Math.round(remainingPercent)}% left</span>
      </div>
      <Progress value={remainingPercent} className="h-1 bg-muted/70" />
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{formatWindowDuration(window.windowDurationMins)}</span>
        <span>{formatResetLabel(window.resetsAt)}</span>
      </div>
    </div>
  )
}

function MetricGroup({
  icon,
  title,
  metrics,
}: {
  icon: ReactNode
  title: string
  metrics: Array<[string, string]>
}) {
  return (
    <div className="rounded-md bg-background/70 p-2.5 ring-1 ring-foreground/6">
      <div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <dl className="mt-2 grid gap-1.5">
        {metrics.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-[11.5px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate font-mono tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function DailyUsageRows({
  buckets,
}: {
  buckets: NonNullable<CodexAccountDiagnostics['tokenUsage']>['dailyUsageBuckets']
}) {
  const maxTokens = buckets.reduce((max, bucket) => Math.max(max, Number(bucket.tokens)), 0)

  return (
    <div className="rounded-md bg-background/70 p-2.5 ring-1 ring-foreground/6">
      <div className="text-[12px] font-medium text-foreground">Daily tokens</div>
      <div className="mt-2 grid gap-1.5">
        {buckets.map(bucket => (
          <div key={bucket.startDate} className="grid grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 text-[11px]">
            <span className="truncate text-muted-foreground">{bucket.startDate}</span>
            <Progress value={maxTokens > 0 ? (Number(bucket.tokens) / maxTokens) * 100 : 0} className="h-1 bg-muted/70" />
            <span className="truncate text-right font-mono tabular-nums text-foreground">{formatCounter(bucket.tokens)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function isResetCreditAvailable(diagnostics: CodexAccountDiagnostics | null): boolean {
  return diagnostics?.supported === true
    && diagnostics.rateLimitResetCredits?.availableCount !== undefined
    && diagnostics.rateLimitResetCredits.availableCount !== '0'
}

function formatRefreshState(diagnostics: CodexAccountDiagnostics | null, loading: boolean): string {
  if (loading) {
    return 'Refreshing'
  }
  if (!diagnostics?.refreshedAt) {
    return 'Idle'
  }
  return `Updated ${new Date(diagnostics.refreshedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function formatCounter(value: string | null): string {
  if (!value) {
    return 'n/a'
  }
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatDays(value: string | null): string {
  return value ? `${formatCounter(value)}d` : 'n/a'
}

function formatWindowDuration(durationMins: number | null): string {
  if (durationMins === null || durationMins <= 0) {
    return 'window n/a'
  }
  if (durationMins === 10_080) {
    return 'weekly'
  }
  if (durationMins === 43_200 || durationMins === 43_800 || durationMins === 44_640) {
    return 'monthly'
  }
  if (durationMins % 1_440 === 0) {
    return `${durationMins / 1_440}d`
  }
  if (durationMins % 60 === 0) {
    return `${durationMins / 60}h`
  }
  return `${durationMins}m`
}

function formatResetLabel(resetsAt: number | null): string {
  if (resetsAt === null) {
    return 'reset n/a'
  }
  const deltaSeconds = resetsAt - Math.floor(Date.now() / 1_000)
  if (deltaSeconds <= 0) {
    return 'reset pending'
  }
  if (deltaSeconds < 3_600) {
    return `${Math.ceil(deltaSeconds / 60)}m`
  }
  if (deltaSeconds < 86_400) {
    return `${Math.ceil(deltaSeconds / 3_600)}h`
  }
  return `${Math.ceil(deltaSeconds / 86_400)}d`
}

function formatResetOutcome(outcome: 'reset' | 'nothingToReset' | 'noCredit' | 'alreadyRedeemed'): string {
  switch (outcome) {
    case 'reset':
      return 'Limit reset'
    case 'nothingToReset':
      return 'Nothing to reset'
    case 'noCredit':
      return 'No reset credit'
    case 'alreadyRedeemed':
      return 'Already redeemed'
  }
}
