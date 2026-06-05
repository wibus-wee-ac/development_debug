import { use, useEffect } from 'react'

import type { LayoutSlots } from './layout-slots-context'
import { LayoutSlotRegistrationContext, LayoutSlotsContext } from './layout-slots-context'

export { type LayoutSlots } from './layout-slots-context'

export function useLayoutSlotsCtx() {
  return use(LayoutSlotsContext)
}

export function useLayoutSlotRegistrationCtx() {
  return use(LayoutSlotRegistrationContext)
}

/**
 * Register layout slots (asideSessionId, asideWorkspaceId, panel, hasAside, hasPanel,
 * hasBrowserPanel, title, workspace, gitBranch)
 * for a tab content component. Retained tab frames keep registration effects
 * mounted while inactive, so slot lifetime is pruned by LayoutSlotsProvider
 * validSlotIds instead of this hook's cleanup.
 *
 * Prefer passing a stable `slots` reference (e.g. produced by useMemo) so the
 * effect only re-fires when slot content actually changes.
 */
export function useRegisterLayoutSlots(id: string, slots: LayoutSlots) {
  const { register } = useLayoutSlotRegistrationCtx()

  useEffect(() => {
    register(id, slots)
  }, [id, slots, register])
}
