// Input: tabs-next modules
// Output: @cradle/tabs-next public API
// Position: Package entry point

export type { TabBarProps } from './components/tab-bar'
export { TabBar } from './components/tab-bar'
export type { TabRendererProps } from './components/tab-renderer'
export { chooseMountedTabIds, TabRenderer } from './components/tab-renderer'
export { TabsContext, useTabsContext } from './context'
export type { DebugApi, DebugMetrics, DebugSnapshot, DebugState } from './debug'
export { DEBUG_CHANNEL_NAME, DEBUG_COMMAND_CHANNEL_NAME, DEBUG_STORAGE_KEY } from './debug'
export { useTabNavigation } from './hooks/use-tab-navigation'
export { TabsProvider } from './provider'
export { createTabLocation, defineTab } from './route-definition'
export type { TabStoreState } from './store'
export { createTabStore, selectCurrentLocation } from './store'
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
