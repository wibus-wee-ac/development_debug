/**
 * Runtime usage composer slot UI.
 *
 * Codex supplies ChatGPT account rate-limit windows through the provider-owned
 * usage slot state; this renderer keeps that account state near the composer.
 */
import {
  AlertTriangleIcon,
  CoinsIcon,
  GaugeIcon,
  XIcon,
} from 'lucide-react'

import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'
import { clampPercent } from '~/lib/number-format'

import type { ChatRuntimeUsageUiSlotState } from '../../capabilities/chat-capabilities'
import { ComposerSlotIconAction, ComposerSlotShell } from './composer-slot-shell'
import type { ComposerUsageSlotActions } from './types'

export function UsageSlotState({
  state,
  usage,
  className,
}: {
  state: ChatRuntimeUsageUiSlotState
  usage?: ComposerUsageSlotActions
  className?: string
}) {
  const usedPercent = state.usedPercent === null ? null : clampPercent(state.usedPercent)
  const secondaryUsedPercent = state.secondaryUsedPercent === null ? null : clampPercent(state.secondaryUsedPercent)
  const primaryWindowLabel = formatWindowDuration(state.primaryWindowDurationMins)
  const secondaryWindowLabel = formatWindowDuration(state.secondaryWindowDurationMins)
  const resetLabel = formatResetLabel(state.primaryResetsAt)
  const toneClassName = readUsageToneClassName(state)
  const Icon = state.rateLimitReachedType ? AlertTriangleIcon : GaugeIcon

  return (
    <ComposerSlotShell stateName="usage" className={className}>
      <div className="flex min-h-6 min-w-0 items-center gap-2">
        <Icon className={cn('size-3.5 shrink-0', toneClassName)} aria-hidden="true" />
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-medium text-foreground/75">
              {state.rateLimitReachedType ? 'Usage limited' : 'Usage'}
            </span>
            <span className="min-w-0 truncate text-foreground/80">
              {formatPrimaryUsageLabel(usedPercent, primaryWindowLabel, state.limitName)}
            </span>
            {resetLabel && (
              <>
                <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
                  ·
                </span>
                <span className="shrink-0 text-muted-foreground">{resetLabel}</span>
              </>
            )}
          </div>
          {usedPercent !== null && (
            <div className="flex items-center gap-2">
              <Progress value={usedPercent} className="h-0.5 flex-1 bg-muted/60" />
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                {Math.round(usedPercent)}
                %
              </span>
            </div>
          )}
        </div>
        <div className="ml-auto hidden shrink-0 items-center gap-2 text-[10px] text-muted-foreground sm:flex">
          {secondaryUsedPercent !== null && (
            <span className="font-mono tabular-nums">
              {secondaryWindowLabel ? `${secondaryWindowLabel} ` : 'secondary '}
              {Math.round(secondaryUsedPercent)}
              %
            </span>
          )}
          {state.creditsBalance && (
            <span className="inline-flex items-center gap-1 font-mono tabular-nums">
              <CoinsIcon className="size-3" aria-hidden="true" />
              {state.creditsBalance}
            </span>
          )}
        </div>
        {usage?.open && (
          <ComposerSlotIconAction label="Close usage" onClick={usage.onDismiss}>
            <XIcon className="size-3.5" aria-hidden="true" />
          </ComposerSlotIconAction>
        )}
      </div>
    </ComposerSlotShell>
  )
}

function formatPrimaryUsageLabel(
  usedPercent: number | null,
  windowLabel: string | null,
  limitName: string | null,
): string {
  if (usedPercent === null) {
    return limitName ?? 'rate limit unavailable'
  }

  const roundedPercent = Math.round(usedPercent)
  if (windowLabel) {
    return `${windowLabel} ${roundedPercent}% used`
  }
  if (limitName) {
    return `${limitName} ${roundedPercent}% used`
  }
  return `${roundedPercent}% used`
}

function formatWindowDuration(durationMins: number | null): string | null {
  if (durationMins === null || durationMins <= 0) {
    return null
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

function formatResetLabel(resetsAt: number | null): string | null {
  if (resetsAt === null) {
    return null
  }

  const deltaSeconds = resetsAt - Math.floor(Date.now() / 1_000)
  if (deltaSeconds <= 0) {
    return 'reset pending'
  }
  if (deltaSeconds < 3_600) {
    return `resets in ${Math.ceil(deltaSeconds / 60)}m`
  }
  if (deltaSeconds < 86_400) {
    return `resets in ${Math.ceil(deltaSeconds / 3_600)}h`
  }
  return `resets in ${Math.ceil(deltaSeconds / 86_400)}d`
}

function readUsageToneClassName(state: ChatRuntimeUsageUiSlotState): string {
  if (state.rateLimitReachedType) {
    return 'text-destructive'
  }
  if (state.usedPercent !== null && state.usedPercent >= 90) {
    return 'text-amber-600 dark:text-amber-400'
  }
  return 'text-muted-foreground'
}
