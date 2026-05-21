import type { ReactNode } from 'react'
import type { StoreApi, UseBoundStore } from 'zustand'

import { TabsContext } from './context'
import type { TabStoreState } from './store'
import type { TabRegistry } from './types'

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
