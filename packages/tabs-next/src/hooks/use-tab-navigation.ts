// Input: tabs-next context
// Output: programmatic tab navigation helpers
// Position: Compatibility hook over the route-context store

import { useCallback } from 'react'

import { useTabsContext } from '../context'
import { resolveLocation } from '../route-definition'
import type { TabParams } from '../types'

export function useTabNavigation() {
  const { store, registry } = useTabsContext()

  const navigateTo = useCallback((type: string, params?: TabParams) => {
    return store.getState().openTab(type, params)
  }, [store])

  const openInNewTab = useCallback((type: string, params?: TabParams) => {
    return store.getState().createTab(type, params)
  }, [store])

  const navigateInTab = useCallback((type: string, params?: TabParams, options?: { label?: string }) => {
    const state = store.getState()
    const activeTabId = state.activeTabId
    if (!activeTabId) {
      return state.openTab(type, params, options)
    }
    const activeTab = state.tabs.find(tab => tab.id === activeTabId)
    if (activeTab?.pinned) {
      return state.openTab(type, params, options)
    }
    const route = registry[type]
    const location = route ? resolveLocation(route, params ?? {}) : { routeId: type, params: params ?? {}, pathname: `/${type}` }
    state.replaceTabLocation(activeTabId, location, { title: options?.label })
    return activeTabId
  }, [registry, store])

  return { navigateTo, openInNewTab, navigateInTab }
}
