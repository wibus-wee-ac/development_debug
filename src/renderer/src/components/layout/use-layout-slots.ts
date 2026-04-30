// Input: LayoutSlotsContext from layout-slots-context
// Output: useLayoutSlotsCtx + useRegisterLayoutSlots + useActivateLayoutSlot hooks
// Position: Shared hook layer; consumed by tab content components and AppLayout

import { useContext, useEffect } from 'react'

import type { LayoutSlots } from './layout-slots-context'
import { LayoutSlotsContext } from './layout-slots-context'

export { type LayoutSlots } from './layout-slots-context'

export function useLayoutSlotsCtx() {
  return useContext(LayoutSlotsContext)
}

/**
 * Register layout slots (aside, panel, hasAside, hasPanel, title, workspace, gitBranch)
 * for a tab content component. Automatically clears on unmount.
 *
 * IMPORTANT: The `slots` argument MUST be a stable reference (e.g. produced by useMemo)
 * so that the effect only re-fires when slot content actually changes.
 * Passing an inline object literal will cause an infinite update loop.
 */
export function useRegisterLayoutSlots(id: string, slots: LayoutSlots) {
  const { register, unregister } = useLayoutSlotsCtx()

  useEffect(() => {
    register(id, slots)
    return () => unregister(id)
  }, [id, slots, register, unregister])
}

/**
 * Activate a specific slot id as the currently displayed layout.
 * Call this when the tab associated with `id` becomes the active tab.
 */
export function useActivateLayoutSlot(id: string | null) {
  const { activate } = useLayoutSlotsCtx()

  useEffect(() => {
    if (id) {
      activate(id)
    }
  }, [id, activate])
}
