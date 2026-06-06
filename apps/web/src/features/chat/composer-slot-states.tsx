import { useMemo } from 'react'

import type {
  ChatRuntimeGoalUiSlotState,
  ChatRuntimeUiSlot,
  ChatRuntimeUiSlotState,
  ChatRuntimeUsageUiSlotState,
} from './chat-capabilities'
import { GoalSlotState } from './composer-slots/goal-slot-state'
import { ReviewSlotState } from './composer-slots/review-slot-state'
import type {
  ComposerQuickQuestionSlotActions,
  ComposerGoalSlotActions,
  ComposerReviewSlotActions,
  ComposerUsageSlotActions,
} from './composer-slots/types'
import { QuickQuestionSlotState } from './composer-slots/quick-question-slot-state'
import { UsageSlotState } from './composer-slots/usage-slot-state'

export type {
  ComposerQuickQuestionSlotActions,
  ComposerGoalSlotActions,
  ComposerReviewSlotActions,
  ComposerUsageSlotActions,
} from './composer-slots/types'

interface ComposerSlotStatesProps {
  slots: ChatRuntimeUiSlot[]
  states: ChatRuntimeUiSlotState[]
  actions?: ComposerGoalSlotActions
  quickQuestion?: ComposerQuickQuestionSlotActions
  review?: ComposerReviewSlotActions
  usage?: ComposerUsageSlotActions
  className?: string
}

export function ComposerSlotStates({ slots, states, actions, quickQuestion, review, usage, className }: ComposerSlotStatesProps) {
  const composerSlotIds = useMemo(() => new Set(
    slots.filter(slot => slot.surfaces.includes('composerState')).map(slot => slot.id),
  ), [slots])
  const usageState = states.find((state): state is ChatRuntimeUsageUiSlotState => {
    return state.kind === 'usage' && usage?.open === true
  })
  const goalState = states.find((state): state is ChatRuntimeGoalUiSlotState => {
    return state.kind === 'goal' && composerSlotIds.has(state.slotId)
  })

  if (!usageState && !goalState && !quickQuestion?.open && !review?.open) {
    return null
  }

  return (
    <>
      {usageState && <UsageSlotState state={usageState} usage={usage} className={className} />}
      {goalState && <GoalSlotState state={goalState} actions={actions} className={className} />}
      {quickQuestion?.open && <QuickQuestionSlotState quickQuestion={quickQuestion} className={className} />}
      {review?.open && <ReviewSlotState review={review} className={className} />}
    </>
  )
}
