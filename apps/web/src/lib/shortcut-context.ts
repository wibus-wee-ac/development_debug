// Input: React
// Output: ShortcutContext + ShortcutContextValue type
// Position: Shared context for shortcut registration between provider and hook

import { createContext } from 'react'

import type { ShortcutDefinition } from './shortcut-utils'

export type ShortcutContextValue = {
  register: (id: string, shortcut: ShortcutDefinition, handler: () => void, enabled?: boolean) => void
  unregister: (id: string) => void
}

export const ShortcutContext = createContext<ShortcutContextValue | null>(null)
