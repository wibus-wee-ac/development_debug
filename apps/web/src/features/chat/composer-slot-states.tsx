// Output: Composer-adjacent rendering for provider-owned primary chat state.
// Input: Runtime UI slot state projected by the active chat provider.
// Position: Chat feature presentation layer above the composer input.

import { CheckCircle2Icon, CirclePauseIcon, CircleSlashIcon, GaugeIcon, TargetIcon } from 'lucide-react'

import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'

import type { ChatRuntimeGoalUiSlotState, ChatRuntimeUiSlot, ChatRuntimeUiSlotState } from './chat-capabilities'

interface ComposerSlotStatesProps {
  slots: ChatRuntimeUiSlot[]
  states: ChatRuntimeUiSlotState[]
  className?: string
}

const GOAL_STATUS_LABELS: Record<ChatRuntimeGoalUiSlotState['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  blocked: 'Blocked',
  usageLimited: 'Usage limited',
  budgetLimited: 'Budget limited',
  complete: 'Complete',
}

export function ComposerSlotStates({ slots, states, className }: ComposerSlotStatesProps) {
  const composerSlotIds = new Set(
    slots
      .filter(slot => slot.surfaces.includes('composerState'))
      .map(slot => slot.id),
  )
  const goalState = states.find((state): state is ChatRuntimeGoalUiSlotState => {
    return state.kind === 'goal' && composerSlotIds.has(state.slotId)
  })

  if (!goalState) {
    return null
  }

  return (
    <div className={cn('mb-2', className)}>
      <GoalSlotState state={goalState} />
    </div>
  )
}

function GoalSlotState({ state }: { state: ChatRuntimeGoalUiSlotState }) {
  const budgetPercent = readGoalBudgetPercent(state)
  return (
    <div
      className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border border-border/70 bg-popover/95 px-3 py-2 text-sm text-popover-foreground shadow-sm backdrop-blur"
      data-chat-runtime-slot-state="goal"
    >
      <TargetIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">Goal</span>
          <span className="min-w-0 truncate text-xs font-medium text-foreground">
            {state.objective}
          </span>
        </div>
        {budgetPercent !== null && (
          <div className="mt-1 flex items-center gap-2">
            <Progress value={budgetPercent} className="h-1 flex-1" />
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {state.tokensUsed}
              /
              {state.tokenBudget}
            </span>
          </div>
        )}
      </div>
      <div className={cn(
        'flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium',
        readGoalStatusClassName(state.status),
      )}
      >
        {renderGoalStatusIcon(state.status)}
        <span>{GOAL_STATUS_LABELS[state.status]}</span>
      </div>
    </div>
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
      return <CheckCircle2Icon className="size-3" aria-hidden="true" />
    case 'paused':
      return <CirclePauseIcon className="size-3" aria-hidden="true" />
    case 'blocked':
    case 'usageLimited':
    case 'budgetLimited':
      return <CircleSlashIcon className="size-3" aria-hidden="true" />
    case 'active':
    default:
      return <GaugeIcon className="size-3" aria-hidden="true" />
  }
}

function readGoalStatusClassName(status: ChatRuntimeGoalUiSlotState['status']): string {
  switch (status) {
    case 'complete':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case 'blocked':
    case 'usageLimited':
    case 'budgetLimited':
      return 'border-destructive/25 bg-destructive/10 text-destructive'
    case 'paused':
      return 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400'
    case 'active':
    default:
      return 'border-primary/25 bg-primary/10 text-primary'
  }
}
