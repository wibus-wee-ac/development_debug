import * as React from 'react'

import { ShortcutContext } from './shortcut-context'
import type { ShortcutDefinition, ShortcutEntry } from './shortcut-utils'
import { matchesShortcut } from './shortcut-utils'

export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const entriesRef = React.useRef<Map<string, ShortcutEntry>>(new Map())

  const register = (id: string, shortcut: ShortcutDefinition, handler: () => void, enabled = true) => {
      entriesRef.current.set(id, { id, shortcut, handler, enabled })
    }

  const unregister = (id: string) => {
    entriesRef.current.delete(id)
  }

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Skip if focus is in an input-like element
      const target = event.target as HTMLElement | null
      if (
        target
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.isContentEditable)
      ) {
        return
      }

      for (const entry of entriesRef.current.values()) {
        if (!entry.enabled) {
          continue
        }
        if (matchesShortcut(event, entry.shortcut)) {
          event.preventDefault()
          entry.handler()
          return
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const value = ({ register, unregister })

  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  )
}
