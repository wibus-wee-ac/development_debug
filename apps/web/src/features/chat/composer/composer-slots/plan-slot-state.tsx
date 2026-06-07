/**
 * Codex plan composer slot UI.
 *
 * The provider owns the plan state. This rail only offers composer-level
 * follow-up actions and local dismissal for the current plan snapshot.
 */
import { CheckIcon, ListChecksIcon, PencilIcon, XIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'

import type { ChatRuntimePlanUiSlotState } from '../../capabilities/chat-capabilities'
import { ComposerSlotIconAction, ComposerSlotShell } from './composer-slot-shell'
import type { ComposerPlanSlotActions } from './types'

export function PlanSlotState({
  state,
  actions,
  className,
}: {
  state: ChatRuntimePlanUiSlotState
  actions?: ComposerPlanSlotActions
  className?: string
}) {
  const planKey = `${state.threadId}:${state.turnId ?? 'turn'}:${state.updatedAt}`
  const [dismissedPlanKey, setDismissedPlanKey] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<'implement' | 'refine' | null>(null)
  const summary = useMemo(() => readPlanSummary(state), [state])
  const disabled = actions?.disabled || actions?.busy || pendingAction !== null

  if (dismissedPlanKey === planKey) {
    return null
  }

  return (
    <ComposerSlotShell stateName="plan" testId="plan-slot" className={className}>
      <div className="flex min-h-7 min-w-0 items-center gap-2">
        <ListChecksIcon className="size-3.5 shrink-0 text-primary/75" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="shrink-0 font-medium text-foreground/80">Plan ready</span>
          {summary && (
            <>
              <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
                ·
              </span>
              <span className="min-w-0 truncate text-foreground/75">{summary}</span>
            </>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="xs"
            disabled={disabled || !actions?.onImplement}
            onClick={() => {
              void runPlanAction('implement', state, actions?.onImplement, setPendingAction, () => setDismissedPlanKey(planKey))
            }}
            className="h-6 gap-1 px-2"
          >
            <CheckIcon className="size-3" aria-hidden="true" />
            <span>Implement plan</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled || !actions?.onRefine}
            onClick={() => {
              void runPlanAction('refine', state, actions?.onRefine, setPendingAction, () => setDismissedPlanKey(planKey))
            }}
            className="h-6 gap-1 px-2"
          >
            <PencilIcon className="size-3" aria-hidden="true" />
            <span>Refine plan</span>
          </Button>
          <ComposerSlotIconAction
            label="Dismiss plan"
            disabled={pendingAction !== null}
            onClick={() => setDismissedPlanKey(planKey)}
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </ComposerSlotIconAction>
        </div>
      </div>
    </ComposerSlotShell>
  )
}

async function runPlanAction(
  action: 'implement' | 'refine',
  state: ChatRuntimePlanUiSlotState,
  handler: ComposerPlanSlotActions['onImplement'] | ComposerPlanSlotActions['onRefine'] | undefined,
  setPendingAction: (action: 'implement' | 'refine' | null) => void,
  onHandled: () => void,
) {
  if (!handler) {
    return
  }

  setPendingAction(action)
  try {
    const result = await handler(state)
    if (result !== false) {
      onHandled()
    }
  }
  catch (error) {
    console.error('[PlanSlotState] action failed:', error)
  }
  finally {
    setPendingAction(null)
  }
}

function readPlanSummary(state: ChatRuntimePlanUiSlotState): string | null {
  const explanation = state.explanation?.trim()
  if (explanation) {
    return explanation
  }

  const step = state.currentStep ?? state.steps[0]?.step ?? null
  if (step?.trim()) {
    return step.trim()
  }

  const totalCount = state.pendingCount + state.inProgressCount + state.completedCount
  return totalCount > 0 ? `${totalCount} steps` : null
}
