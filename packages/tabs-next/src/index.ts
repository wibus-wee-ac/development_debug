// Input: tabs-next modules
// Output: @cradle/tabs-next public API
// Position: Package entry point

export { defineTab, createTabLocation } from './route-definition'
export { createTabStore, selectCurrentLocation } from './store'
export { TabsContext, useTabsContext } from './context'
export { TabsProvider } from './provider'
export { useTabNavigation } from './hooks/use-tab-navigation'
export { TabBar } from './components/tab-bar'
export { TabRenderer, chooseMountedTabIds } from './components/tab-renderer'

export type {
  NavigateTabOptions,
  OpenTabOptions,
  PersistedTabsNextState,
  RestoreTabsInput,
  TabContextState,
  TabHistoryEntry,
  TabInstance,
  TabKeepAlivePolicy,
  TabLocation,
  TabParams,
  TabRegistry,
  TabRenderPolicy,
  TabRouteCapabilities,
  TabRouteDefinition,
} from './types'

export type { TabStoreState } from './store'
export type { TabBarProps } from './components/tab-bar'
export type { TabRendererProps } from './components/tab-renderer'
