import { createContext, use } from 'react'
import type { StoreApi, UseBoundStore } from 'zustand'

import type { TabStoreState } from './store'
import type { TabRegistry } from './types'

export interface TabsContextValue {
  store: UseBoundStore<StoreApi<TabStoreState>>
  registry: TabRegistry
}

export const TabsContext = createContext<TabsContextValue | null>(null)

export function useTabsContext(): TabsContextValue {
  const context = use(TabsContext)
  if (!context) {
    throw new Error('useTabsContext must be used within a <TabsProvider>')
  }
  return context
}
