import { use, useEffect } from 'react'

import type { LayoutSlots } from './layout-slots-context'
import { LayoutSlotsContext } from './layout-slots-context'

export { type LayoutSlots } from './layout-slots-context'

export function useLayoutSlotsCtx() {
  return use(LayoutSlotsContext)
}

/**
 * Register layout slots (asideSessionId, asideWorkspaceId, panel, hasAside, hasPanel,
 * hasBrowserPanel, title, workspace, gitBranch)
 * for a tab content component. Hidden React Activity trees clean up effects, so
 * slot lifetime is pruned by LayoutSlotsProvider validSlotIds instead of this
 * hook's cleanup.
 *
 * IMPORTANT: The `slots` argument MUST be a stable reference (e.g. produced by useMemo)
 * so that the effect only re-fires when slot content actually changes.
 * Passing an inline object literal will cause an infinite update loop.
 */
export function useRegisterLayoutSlots(id: string, slots: LayoutSlots) {
  const { register } = useLayoutSlotsCtx()

  useEffect(() => {
    register(id, slots)
  }, [id, slots, register])
}
