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
  title?: ReactNode
  workspace?: ReactNode
  gitBranch?: ReactNode
}

interface RegistrationState {
  map: Record<string, LayoutSlots>
  activeId: string | null
}

export interface LayoutSlotsContextValue {
  slots: LayoutSlots
  register: (id: string, slots: LayoutSlots) => void
  unregister: (id: string) => void
}

export const LayoutSlotsContext = createContext<LayoutSlotsContextValue>({
  slots: {},
  register: () => { },
  unregister: () => { },
})

export function LayoutSlotsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RegistrationState>({ map: {}, activeId: null })

  const register = useCallback((id: string, newSlots: LayoutSlots) => {
    setState((prev) => {
      // Bail out if both the active id and the slots reference are unchanged
      if (prev.activeId === id && prev.map[id] === newSlots) {
        return prev
      }
      return { map: { ...prev.map, [id]: newSlots }, activeId: id }
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

  const slots = (state.activeId && state.map[state.activeId]) || {}

  return (
    <LayoutSlotsContext.Provider value={{ slots, register, unregister }}>
      {children}
    </LayoutSlotsContext.Provider>
  )
}
