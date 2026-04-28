// Input: all public modules
// Output: @cradle/tabs public API
// Position: Package entry point — barrel export

// Type helpers
export type { TabDefinition } from './define-tab'
export { defineTab } from './define-tab'

// Store
export type { TabInstance, TabRegistry, TabStoreState } from './store'
export { createTabStore } from './store'

// Context & Provider
export type { TabsContextValue } from './context'
export { TabsContext, useTabsContext } from './context'
export { TabsProvider } from './provider'

// Components
export type { TabBarProps } from './components/tab-bar'
export { TabBar } from './components/tab-bar'
export type { TabRendererProps } from './components/tab-renderer'
export { TabRenderer } from './components/tab-renderer'

// Hooks
export { useTabNavigation } from './hooks/use-tab-navigation'

// URL sync
export type { UrlSyncOptions } from './url-sync'
export { createUrlSync } from './url-sync'
