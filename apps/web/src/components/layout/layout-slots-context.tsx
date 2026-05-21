/* eslint-disable react-refresh/only-export-components */

import type { ReactNode } from 'react'
import { createContext, useCallback, useMemo, useState } from 'react'

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

  const slots = useMemo(() => {
    if (activeSlotId === undefined) {
      return (state.activeId && state.map[state.activeId]) || {}
    }

    if (activeSlotId === null) {
      return {}
    }

    return state.map[activeSlotId] ?? {}
  }, [activeSlotId, state.activeId, state.map])

  return (
    <LayoutSlotsContext.Provider value={{ slots, register, unregister, activate }}>
      {children}
    </LayoutSlotsContext.Provider>
  )
}
