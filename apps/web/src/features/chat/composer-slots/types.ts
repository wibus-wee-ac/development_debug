/**
 * Shared composer slot contracts owned by the chat feature.
 *
 * These types keep the composer slot dispatcher thin while individual slot
 * renderers own their own UI details.
 */
import type { ChatRuntimeGoalUiSlotState } from '../chat-capabilities'

export interface ComposerGoalSlotActions {
  busy?: boolean
  onEdit?: (state: ChatRuntimeGoalUiSlotState) => void
  onPause?: (state: ChatRuntimeGoalUiSlotState) => void
  onResume?: (state: ChatRuntimeGoalUiSlotState) => void
  onClear?: (state: ChatRuntimeGoalUiSlotState) => void
}

export interface ComposerReviewSlotActions {
  open: boolean
  workspaceId?: string | null
  onDismiss: () => void
  onSubmitPrompt: (prompt: string) => void
  resolveMergeBase: (baseBranch: string) => Promise<string | null>
}
