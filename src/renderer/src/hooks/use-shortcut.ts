// Input: ShortcutContext, ShortcutDefinition
// Output: useShortcut hook for registering keyboard shortcuts
// Position: Hook for components to register shortcuts with ShortcutProvider

import { ShortcutContext } from '@renderer/lib/shortcut-context'
import type { ShortcutDefinition } from '@renderer/lib/shortcut-utils'
import { useContext, useEffect, useRef } from 'react'

/**
 * Register a keyboard shortcut. Automatically unregisters on unmount.
 *
 * @param id Unique identifier for this shortcut
 * @param shortcut Key combination definition
 * @param handler Callback to invoke when the shortcut is triggered
 * @param enabled Whether the shortcut is currently active (default: true)
 */
export function useShortcut(
  id: string,
  shortcut: ShortcutDefinition,
  handler: () => void,
  enabled = true,
): void {
  const context = useContext(ShortcutContext)
  if (!context) {
    throw new Error('useShortcut must be used within <ShortcutProvider>')
  }

  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  })

  const { register, unregister } = context

  useEffect(() => {
    register(id, shortcut, () => handlerRef.current(), enabled)
    return () => unregister(id)
  }, [register, unregister, id, shortcut, enabled])
}
