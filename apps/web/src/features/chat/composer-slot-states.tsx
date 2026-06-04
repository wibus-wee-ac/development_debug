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
  ComposerGoalSlotActions,
  ComposerReviewSlotActions,
} from './composer-slots/types'
import { UsageSlotState } from './composer-slots/usage-slot-state'

export type {
  ComposerGoalSlotActions,
  ComposerReviewSlotActions,
} from './composer-slots/types'

interface ComposerSlotStatesProps {
  slots: ChatRuntimeUiSlot[]
  states: ChatRuntimeUiSlotState[]
  actions?: ComposerGoalSlotActions
  review?: ComposerReviewSlotActions
  className?: string
}

export function ComposerSlotStates({ slots, states, actions, review, className }: ComposerSlotStatesProps) {
  const composerSlotIds = useMemo(() => new Set(
    slots.filter(slot => slot.surfaces.includes('composerState')).map(slot => slot.id),
  ), [slots])
  const usageState = states.find((state): state is ChatRuntimeUsageUiSlotState => {
    return state.kind === 'usage' && composerSlotIds.has(state.slotId)
  })
  const goalState = states.find((state): state is ChatRuntimeGoalUiSlotState => {
    return state.kind === 'goal' && composerSlotIds.has(state.slotId)
  })

  if (!usageState && !goalState && !review?.open) {
    return null
  }

  return (
    <>
      {usageState && <UsageSlotState state={usageState} className={className} />}
      {goalState && <GoalSlotState state={goalState} actions={actions} className={className} />}
      {review?.open && <ReviewSlotState review={review} className={className} />}
    </>
  )
}
