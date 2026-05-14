/* eslint-disable react-refresh/only-export-components */
// Input: React context, useState, useCallback
// Output: LayoutSlotsProvider component and LayoutSlotsContext for per-tab layout slot injection
// Position: Context layer between app.tsx and AppLayout; allows tab content to inject aside/panel into the parent layout

import type { ReactNode } from 'react'
import { createContext, useCallback, useState } from 'react'

export interface LayoutSlots {
  aside?: ReactNode
  panel?: ReactNode
  hasAside?: boolean
  hasPanel?: boolean
}

interface RegistrationState {
  map: Record<string, LayoutSlots>
  activeId: string | null
}

export interface LayoutSlotsContextValue {
  slots: LayoutSlots
  register: (id: string, slots: LayoutSlots) => void
  unregister: (id: string) => void
  activate: (id: string) => void
}

export const LayoutSlotsContext = createContext<LayoutSlotsContextValue>({
  slots: {},
  register: () => { },
  unregister: () => { },
  activate: () => { },
})

export function LayoutSlotsProvider({ children, activeSlotId }: { children: ReactNode, activeSlotId?: string | null }) {
  const [state, setState] = useState<RegistrationState>({ map: {}, activeId: null })

  // Sync active slot from prop during render (avoids useEffect chain)
  if (activeSlotId && state.activeId !== activeSlotId && activeSlotId in state.map) {
    setState(prev => prev.activeId === activeSlotId ? prev : { ...prev, activeId: activeSlotId })
  }

  const register = useCallback((id: string, newSlots: LayoutSlots) => {
    setState((prev) => {
      if (prev.activeId === id && prev.map[id] === newSlots) {
        return prev
      }
      // Only set activeId on first registration (new id not yet in map)
      const isNew = !(id in prev.map)
      return {
        map: { ...prev.map, [id]: newSlots },
        activeId: isNew ? id : prev.activeId,
      }
    })
  }, [])

  const unregister = useCallback((id: string) => {
    setState((prev) => {
      if (!(id in prev.map)) {
        return prev
      }
      const { [id]: _removed, ...rest } = prev.map
      const nextActiveId
        = prev.activeId === id ? (Object.keys(rest).at(-1) ?? null) : prev.activeId
      return { map: rest, activeId: nextActiveId }
    })
  }, [])

  const activate = useCallback((id: string) => {
    setState((prev) => {
      if (prev.activeId === id) {
        return prev
      }
      // Only activate if the id is registered
      if (!(id in prev.map)) {
        return prev
      }
      return { ...prev, activeId: id }
    })
  }, [])

  const slots = (state.activeId && state.map[state.activeId]) || {}

  return (
    <LayoutSlotsContext.Provider value={{ slots, register, unregister, activate }}>
      {children}
    </LayoutSlotsContext.Provider>
  )
}
