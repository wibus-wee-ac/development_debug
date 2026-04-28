// Input: TabsContext, TabStoreState, TabRegistry, React
// Output: TabsProvider component
// Position: Root provider wrapping the tab system

import type { ReactNode } from 'react'
import type { StoreApi, UseBoundStore } from 'zustand'

import { TabsContext } from './context'
import type { TabRegistry, TabStoreState } from './store'

export function TabsProvider({
  store,
  registry,
  children,
}: {
  store: UseBoundStore<StoreApi<TabStoreState>>
  registry: TabRegistry
  children: ReactNode
}) {
  return (
    <TabsContext value={{ store, registry }}>
      {children}
    </TabsContext>
  )
}
