// Input: React, store types, TabRegistry
// Output: TabsContext, TabsProvider, useTabsContext
// Position: Context provider allowing components to access the tab store and registry

import { createContext, useContext } from 'react'
import type { StoreApi, UseBoundStore } from 'zustand'

import type { TabRegistry, TabStoreState } from './store'

export interface TabsContextValue {
  store: UseBoundStore<StoreApi<TabStoreState>>
  registry: TabRegistry
}

export const TabsContext = createContext<TabsContextValue | null>(null)

export function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext)
  if (!ctx) {
    throw new Error('useTabsContext must be used within a <TabsProvider>')
  }
  return ctx
}
