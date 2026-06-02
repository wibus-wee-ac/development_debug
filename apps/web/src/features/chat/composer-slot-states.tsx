// Output: Composer-adjacent rendering for provider-owned primary chat state.
// Input: Runtime UI slot state projected by the active chat provider.
// Position: Chat feature presentation layer above the composer input.

import {
  CheckCircle2Icon,
  CirclePauseIcon,
  CircleSlashIcon,
  GaugeIcon,
  PencilIcon,
  TargetIcon,
  Trash2Icon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { Progress } from '~/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import type {
  ChatRuntimeGoalUiSlotState,
  ChatRuntimeUiSlot,
  ChatRuntimeUiSlotState,
} from './chat-capabilities'

interface ComposerSlotStatesProps {
  slots: ChatRuntimeUiSlot[]
  states: ChatRuntimeUiSlotState[]
  actions?: ComposerGoalSlotActions
  className?: string
}

export interface ComposerGoalSlotActions {
  busy?: boolean
  onEdit?: (state: ChatRuntimeGoalUiSlotState) => void
  onPause?: (state: ChatRuntimeGoalUiSlotState) => void
  onResume?: (state: ChatRuntimeGoalUiSlotState) => void
  onClear?: (state: ChatRuntimeGoalUiSlotState) => void
}

export function ComposerSlotStates({ slots, states, actions, className }: ComposerSlotStatesProps) {
  const composerSlotIds = new Set(
    slots.filter(slot => slot.surfaces.includes('composerState')).map(slot => slot.id),
  )
  const goalState = states.find((state): state is ChatRuntimeGoalUiSlotState => {
    return state.kind === 'goal' && composerSlotIds.has(state.slotId)
  })

  if (!goalState) {
    return null
  }

  return <GoalSlotState state={goalState} actions={actions} className={className} />
}

function GoalSlotState({
  state,
  actions,
  className,
}: {
  state: ChatRuntimeGoalUiSlotState
  actions?: ComposerGoalSlotActions
  className?: string
}) {
  const budgetPercent = readGoalBudgetPercent(state)
  const statusToneClassName = readGoalStatusToneClassName(state.status)
  const displayedTimeUsedSeconds = useDisplayedGoalTimeUsedSeconds(state)
  const elapsedLabel = formatGoalElapsedTime(displayedTimeUsedSeconds)
  const goalStatusAction = readGoalStatusAction(state.status)

  return (
    <div
      className={cn(
        'pointer-events-auto relative z-0 mx-2 -mb-px max-w-full overflow-hidden rounded-t-lg rounded-b-none bg-background/95 px-3 py-1.5 text-xs text-muted-foreground',
        'border border-border border-b-0 shadow-[0_-8px_24px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-150',
        'dark:shadow-[0_-8px_24px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]',
        className,
      )}
      data-chat-runtime-slot-state="goal"
    >
      <div className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
      <div className="flex h-6 min-w-0 items-center gap-2">
        <TargetIcon className={cn('size-3.5 shrink-0', statusToneClassName)} aria-hidden="true" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="shrink-0 font-medium text-foreground/75">
            {readGoalStatusHeading(state.status)}
          </span>
          <span className="min-w-0 truncate text-foreground/80">{state.objective}</span>
          <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
            ·
          </span>
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
            {elapsedLabel}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <GoalIconAction
            label="Edit goal"
            disabled={!actions?.onEdit || actions.busy}
            onClick={() => actions?.onEdit?.(state)}
          >
            <PencilIcon className="size-3.5" aria-hidden="true" />
          </GoalIconAction>
          {goalStatusAction && (
            <GoalIconAction
              label={goalStatusAction.label}
              disabled={actions?.busy || (goalStatusAction.kind === 'resume' ? !actions?.onResume : !actions?.onPause)}
              onClick={() => {
                if (goalStatusAction.kind === 'resume') {
                  actions?.onResume?.(state)
                  return
                }
                actions?.onPause?.(state)
              }}
            >
              {renderGoalStatusIcon(state.status)}
            </GoalIconAction>
          )}
          <GoalIconAction
            label="Clear goal"
            disabled={!actions?.onClear || actions.busy}
            onClick={() => actions?.onClear?.(state)}
          >
            <Trash2Icon className="size-3.5" aria-hidden="true" />
          </GoalIconAction>
        </div>
      </div>
      {budgetPercent !== null && (
        <div className="flex items-center gap-2 pl-5">
          <Progress value={budgetPercent} className="h-0.5 flex-1 bg-muted/60" />
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {state.tokensUsed}
            /
            {state.tokenBudget}
          </span>
        </div>
      )}
    </div>
  )
}

function useDisplayedGoalTimeUsedSeconds(state: ChatRuntimeGoalUiSlotState): number {
  const isActive = state.status === 'active'
  const nowSeconds = useGoalDisplayNowSeconds(isActive)
  const baseTimeUsedSeconds = Math.max(0, Math.floor(state.timeUsedSeconds))

  if (!isActive) {
    return baseTimeUsedSeconds
  }

  return baseTimeUsedSeconds + Math.max(0, nowSeconds - Math.floor(state.updatedAt))
}

function useGoalDisplayNowSeconds(active: boolean): number {
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1_000))

  useEffect(() => {
    if (!active) {
      return
    }

    const intervalId = window.setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1_000))
    }, 1_000)

    return () => window.clearInterval(intervalId)
  }, [active])

  return nowSeconds
}

function GoalIconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="flex size-5 items-center justify-center rounded-sm text-muted-foreground/75 transition-[background-color,color,opacity,transform] hover:bg-muted hover:text-foreground active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function readGoalBudgetPercent(state: ChatRuntimeGoalUiSlotState): number | null {
  if (state.tokenBudget === null || state.tokenBudget <= 0) {
    return null
  }
  return Math.min(100, Math.max(0, Math.round((state.tokensUsed / state.tokenBudget) * 100)))
}

function renderGoalStatusIcon(status: ChatRuntimeGoalUiSlotState['status']) {
  switch (status) {
    case 'complete':
      return <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
    case 'paused':
      return <GaugeIcon className="size-3.5" aria-hidden="true" />
    case 'blocked':
    case 'usageLimited':
    case 'budgetLimited':
      return <CircleSlashIcon className="size-3.5" aria-hidden="true" />
    case 'active':
    default:
      return <CirclePauseIcon className="size-3.5" aria-hidden="true" />
  }
}

function readGoalStatusAction(status: ChatRuntimeGoalUiSlotState['status']): { kind: 'pause' | 'resume', label: string } | null {
  switch (status) {
    case 'active':
      return { kind: 'pause', label: 'Pause goal' }
    case 'paused':
      return { kind: 'resume', label: 'Resume goal' }
    case 'blocked':
    case 'budgetLimited':
    case 'complete':
    case 'usageLimited':
    default:
      return null
  }
}

function readGoalStatusHeading(status: ChatRuntimeGoalUiSlotState['status']): string {
  switch (status) {
    case 'complete':
      return 'Completed goal'
    case 'paused':
      return 'Paused goal'
    case 'blocked':
      return 'Blocked goal'
    case 'usageLimited':
      return 'Usage-limited goal'
    case 'budgetLimited':
      return 'Budget-limited goal'
    case 'active':
    default:
      return 'Active goal'
  }
}

function readGoalStatusToneClassName(status: ChatRuntimeGoalUiSlotState['status']): string {
  switch (status) {
    case 'complete':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'blocked':
    case 'usageLimited':
    case 'budgetLimited':
      return 'text-destructive'
    case 'paused':
      return 'text-amber-600 dark:text-amber-400'
    case 'active':
    default:
      return 'text-muted-foreground'
  }
}

function formatGoalElapsedTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainingSeconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${remainingSeconds}s`
}
