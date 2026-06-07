import { AnimatePresence } from 'motion/react'
import { useMemo } from 'react'

import type {
  ChatRuntimeGoalUiSlotState,
  ChatRuntimePlanUiSlotState,
  ChatRuntimeUiSlot,
  ChatRuntimeUiSlotState,
  ChatRuntimeUsageUiSlotState,
} from '../capabilities/chat-capabilities'
import { GoalSlotState } from './composer-slots/goal-slot-state'
import { PlanSlotState } from './composer-slots/plan-slot-state'
import { QuickQuestionSlotState } from './composer-slots/quick-question-slot-state'
import { ReviewSlotState } from './composer-slots/review-slot-state'
import type {
  ComposerGoalSlotActions,
  ComposerPlanSlotActions,
  ComposerQuickQuestionSlotActions,
  ComposerReviewSlotActions,
  ComposerUsageSlotActions,
} from './composer-slots/types'
import { UsageSlotState } from './composer-slots/usage-slot-state'

export type {
  ComposerGoalSlotActions,
  ComposerPlanSlotActions,
  ComposerQuickQuestionSlotActions,
  ComposerReviewSlotActions,
  ComposerUsageSlotActions,
} from './composer-slots/types'

interface ComposerSlotStatesProps {
  slots: ChatRuntimeUiSlot[]
  states: ChatRuntimeUiSlotState[]
  actions?: ComposerGoalSlotActions
  plan?: ComposerPlanSlotActions
  quickQuestion?: ComposerQuickQuestionSlotActions
  review?: ComposerReviewSlotActions
  usage?: ComposerUsageSlotActions
  className?: string
}

export function ComposerSlotStates({ slots, states, actions, plan, quickQuestion, review, usage, className }: ComposerSlotStatesProps) {
  const composerSlotIds = useMemo(() => new Set(
    slots.filter(slot => slot.surfaces.includes('composerState')).map(slot => slot.id),
  ), [slots])
  const usageState = states.find((state): state is ChatRuntimeUsageUiSlotState => {
    return state.kind === 'usage' && usage?.open === true
  })
  const goalState = states.find((state): state is ChatRuntimeGoalUiSlotState => {
    return state.kind === 'goal' && composerSlotIds.has(state.slotId)
  })
  const planState = states.find((state): state is ChatRuntimePlanUiSlotState => {
    return state.kind === 'plan' && composerSlotIds.has(state.slotId)
  })

  return (
    <AnimatePresence initial={false}>
      {usageState && <UsageSlotState key="usage" state={usageState} usage={usage} className={className} />}
      {goalState && <GoalSlotState key="goal" state={goalState} actions={actions} className={className} />}
      {planState && <PlanSlotState key="plan" state={planState} actions={plan} className={className} />}
      {quickQuestion?.open && <QuickQuestionSlotState key="quick-question" quickQuestion={quickQuestion} className={className} />}
      {review?.open && <ReviewSlotState key="review" review={review} className={className} />}
    </AnimatePresence>
  )
}
