/**
 * Compact composer progress UI derived from provider-owned plan state.
 *
 * Single-row rail matching the goal/plan/usage siblings. Discrete step dots
 * replace the old count badge + linear progress bar — the data is steps, not a
 * continuous percentage, so the dots stay the most faithful representation.
 */
import { CheckCircle2Icon, ListChecksIcon } from 'lucide-react'

import { cn } from '~/lib/cn'

import type {
  ChatRuntimePlanStep,
  ChatRuntimePlanStepStatus,
  ChatRuntimePlanUiSlotState,
} from '../../capabilities/chat-capabilities'
import { ComposerSlotShell } from './composer-slot-shell'

/** Above this step count dots get unreadable; fall back to a `done/total` fraction. */
const PROGRESS_STEP_DOTS_MAX = 10

export function ProgressSlotState({
  state,
  className,
}: {
  state: ChatRuntimePlanUiSlotState
  className?: string
}) {
  return (
    <ComposerSlotShell stateName="progress" testId="progress-slot" className={className}>
      <ProgressSlotContent state={state} />
    </ComposerSlotShell>
  )
}

function ProgressSlotContent({ state }: { state: ChatRuntimePlanUiSlotState }) {
  const progress = readPlanProgress(state)
  if (!progress) {
    return null
  }
  const Icon = progress.complete ? CheckCircle2Icon : ListChecksIcon

  return (
    <div className="flex min-w-0 min-h-6 items-center gap-2">
      <Icon
        className={cn(
          'size-3.5 shrink-0',
          progress.complete
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-primary/75',
        )}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
          {progress.stepLabel}
        </span>
        {progress.currentStep && (
          <>
            <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
              ·
            </span>
            <span className="min-w-0 truncate text-foreground/75">
              {progress.currentStep}
            </span>
          </>
        )}
      </div>
      <ProgressStepDots steps={progress.steps} fraction={progress.fraction} />
    </div>
  )
}

/**
 * Trailing step indicator: one dot per step when the count is readable, else a
 * compact `done/total` fraction. The dots double as both the count and the
 * progress affordance, so no separate bar or badge is needed.
 */
function ProgressStepDots({
  steps,
  fraction,
}: {
  steps: ChatRuntimePlanStep[]
  fraction: { completedCount: number, totalCount: number }
}) {
  if (steps.length > PROGRESS_STEP_DOTS_MAX) {
    return (
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        {fraction.completedCount}
        /
        {fraction.totalCount}
      </span>
    )
  }

  return (
    <div
      className="flex shrink-0 items-center gap-1"
      role="img"
      aria-label={`${fraction.completedCount} of ${fraction.totalCount} steps done`}
    >
      {steps.map((step, index) => (
        // Dots are content-less visuals keyed by position; step text may repeat
        // (e.g. two "Run tests" steps), so position is the only stable identity.
        // eslint-disable-next-line react/no-array-index-key
        <ProgressStepDot key={index} status={step.status} />
      ))}
    </div>
  )
}

function ProgressStepDot({ status }: { status: ChatRuntimePlanStepStatus }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.5 rounded-full transition-colors',
        status === 'completed' && 'bg-emerald-600 dark:bg-emerald-400',
        status === 'inProgress' && 'bg-primary',
        status === 'pending' && 'bg-muted-foreground/30',
      )}
    />
  )
}

function readPlanProgress(state: ChatRuntimePlanUiSlotState) {
  const totalCount = state.steps.length
  if (totalCount === 0) {
    return null
  }

  const inProgressIndex = state.steps.findIndex(step => step.status === 'inProgress')
  const pendingIndex = state.steps.findIndex(step => step.status === 'pending')
  const completedCount = state.steps.filter(step => step.status === 'completed').length
  const complete = completedCount === totalCount
  const currentIndex = inProgressIndex >= 0
    ? inProgressIndex
    : pendingIndex >= 0
      ? pendingIndex
      : Math.max(0, totalCount - 1)
  const currentStep = state.steps[currentIndex]?.step?.trim() || state.currentStep?.trim() || null

  return {
    complete,
    steps: state.steps,
    currentStep,
    stepLabel: `Step ${currentIndex + 1}/${totalCount}`,
    fraction: { completedCount, totalCount },
  }
}
