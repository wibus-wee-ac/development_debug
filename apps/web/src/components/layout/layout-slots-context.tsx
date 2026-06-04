/* eslint-disable react-refresh/only-export-components */

import type { ReactNode } from 'react'
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface LayoutSlots {
  aside?: ReactNode
  asideSessionId?: string | null
  asideWorkspaceId?: string | null
  panel?: ReactNode
  hasAside?: boolean
  hasPanel?: boolean
  hasBrowserPanel?: boolean
  headerActions?: ReactNode
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

export function LayoutSlotsProvider({
  children,
  activeSlotId,
  validSlotIds,
}: {
  children: ReactNode
  activeSlotId?: string | null
  validSlotIds?: readonly string[]
}) {
  const [state, setState] = useState<RegistrationState>({ map: {}, activeId: null })
  const previousSlotsRef = useRef<LayoutSlots>({})
  const validSlotKey = validSlotIds?.join('\n') ?? null

  const register = useCallback((id: string, newSlots: LayoutSlots) => {
    setState((prev) => {
      const existing = prev.map[id]
      const merged = existing ? { ...existing, ...newSlots } : newSlots
      // Shallow equality: skip update if all keys match
      if (existing && Object.keys(merged).every(k => merged[k as keyof LayoutSlots] === existing[k as keyof LayoutSlots])) {
        return prev
      }
      // Only set activeId on first registration (new id not yet in map)
      const isNew = !(id in prev.map)
      return {
        map: { ...prev.map, [id]: merged },
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

  useEffect(() => {
    if (validSlotKey === null) {
      return
    }
    const validSlotSet = new Set(validSlotKey.split('\n').filter(Boolean))

    setState((prev) => {
      let changed = false
      const nextMap: Record<string, LayoutSlots> = {}
      for (const [id, slots] of Object.entries(prev.map)) {
        if (validSlotSet.has(id)) {
          nextMap[id] = slots
        }
 else {
          changed = true
        }
      }

      const nextActiveId = prev.activeId && validSlotSet.has(prev.activeId) ? prev.activeId : null
      if (!changed && nextActiveId === prev.activeId) {
        return prev
      }

      return {
        map: nextMap,
        activeId: nextActiveId,
      }
    })
  }, [validSlotKey])

  const slots = useMemo(() => {
    if (activeSlotId === undefined) {
      return (state.activeId && state.map[state.activeId]) || {}
    }

    if (activeSlotId === null) {
      return {}
    }

    return state.map[activeSlotId] ?? previousSlotsRef.current
  }, [activeSlotId, state.activeId, state.map])

  useEffect(() => {
    if (slots !== previousSlotsRef.current) {
      previousSlotsRef.current = slots
    }
  }, [slots])

  return (
    <LayoutSlotsContext.Provider value={{ slots, register, unregister, activate }}>
      {children}
    </LayoutSlotsContext.Provider>
  )
}
